import type {
  CalibrationBin,
  DetectionModel,
  DetectionSignal,
  FindingModel,
} from '@tangible/types';
import { baseFor } from './confidence.js';

/**
 * The rules, refitted on what reviewers actually said.
 *
 * Every confidence score in this engine has been a sum of hand-authored
 * weights: a base for the finding, plus a number for each signal, written down
 * with a sentence explaining it. That was the right way to ship — a weight with
 * an argument attached can be disagreed with, and nobody can disagree with a
 * coefficient — but it was never meant to be permanent. Two things had to exist
 * before it could stop being the whole story, and now both do: labels, because
 * the review queue stamps every decision with the signals that were showing
 * when it was made; and signals worth learning about, because external evidence
 * finally produces some that a register cannot.
 *
 * This file turns the first into coefficients over the second. Four decisions
 * shape it, and each is a decision about honesty rather than about accuracy:
 *
 *   **The prior is the hand rule, not zero.** A ridge that pulls toward zero
 *   says the best guess about an unmeasured signal is that it means nothing.
 *   That is false — somebody thought about it and wrote a sentence. So the fit
 *   is anchored to the authored weight, and a signal seen four times comes back
 *   almost exactly where it started. The labels earn their movement.
 *
 *   **It works in log-odds.** The additive rule had to be clamped because
 *   probabilities do not add, and the clamp is where its arithmetic quietly
 *   stopped meaning anything: three strong signals on a 0.72 base saturate, and
 *   the fourth is free. Log-odds add, so the model has no clamp and no ceiling
 *   effect, and the authored weights are translated into it rather than
 *   reinterpreted — `logit(base + w) − logit(base)` is the same claim the rule
 *   was making, said in the units the fit uses.
 *
 *   **Adoption is per finding and earned out of fold.** A model scores rows
 *   only if, on that finding's own labels, held out of its own fit, it beats
 *   the hand rule it would replace. Findings have wildly different label
 *   counts — a register throws off hundreds of ghost rows and four freeport
 *   ones — so one switch for the whole engine would either hold everything
 *   back for the rarest finding or push a four-label fit onto the queue.
 *
 *   **Nothing is silently better.** Both losses are reported, adopted or not,
 *   along with the reliability of the model's own claims. A model that wins by
 *   0.001 is visible as one that wins by 0.001.
 *
 * What this is not: it does not decide *which rows to flag*. The detectors
 * still do that, on rules a person authored and a person can read. Only the
 * confidence attached to a flagged row is fitted here. Recall is not learnable
 * from this dataset and pretending otherwise is the mistake that would matter —
 * a row nobody flagged produces no decision, so no quantity of labels can say
 * what was missed.
 */

/** One reviewer's answer, paired with the signals that were showing. */
export interface ModelLabel {
  findingKey: string;
  signals: readonly DetectionSignal[];
  /** Accepted. A rejection is `false`; an abstention never reaches here. */
  correct: boolean;
}

/**
 * What an authored weight is worth against the labels, counted in labels.
 *
 * Twenty: enough that a first season of a rare finding cannot swing a
 * coefficient, few enough that a finding worked hard for two seasons is
 * described mostly by its own evidence. It also buys a bound worth stating: a
 * signal seen n times can move its coefficient by at most n / (PRIOR_OBSERVATIONS
 * × 0.25) log-odds however flatly the labels contradict it, because at the
 * optimum the ridge has to balance a gradient no larger than n. It is the same shape of judgement as
 * the acceptance learner's prior strength, and for the same reason — the
 * alternative is a fit that lurches with the fifth label.
 */
export const PRIOR_OBSERVATIONS = 20;

/** Below this many judged labels for a finding, nothing is fitted at all. */
export const MIN_LABELS = 40;

/**
 * And below this many of the minority answer, nothing is adopted.
 *
 * Forty labels that are all accepts describe a queue nobody rejected, not a
 * signal that predicts anything. A fit on them is a constant wearing
 * coefficients, and it would beat the hand rule out of fold while knowing
 * strictly less.
 */
export const MIN_MINORITY = 8;

/** Held-out folds. Five keeps 80% of a thin dataset in every fit. */
const FOLDS = 5;

/**
 * How much better than the hand rule counts as better.
 *
 * A margin rather than a strict comparison, because out-of-fold log loss on a
 * few dozen labels is noisy enough that a coin-flip win is a coin flip. Two
 * percent of the baseline is small enough to adopt a real improvement in the
 * first season it appears and large enough not to adopt noise.
 */
const MARGIN = 0.02;

const clampP = (p: number) => Math.min(0.98, Math.max(0.02, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * The additive rule, reproduced exactly.
 *
 * Duplicated from `confidenceFor` rather than called, because that function
 * returns a whole `RowConfidence` and this needs the bare number under it —
 * and because the baseline the model has to beat must stay the rule as it was,
 * even after `confidenceFor` learns to consult a model.
 */
export function ruleScore(findingKey: string, signals: readonly DetectionSignal[]): number {
  const raw = signals.reduce((total, s) => total + s.weight, baseFor(findingKey));
  return Math.min(0.97, Math.max(0.03, raw));
}

/* -------------------------------------------------------------------------- */
/*  Fitting                                                                   */
/* -------------------------------------------------------------------------- */

interface Design {
  codes: string[];
  labelOf: Map<string, string>;
  /** Rows as presence vectors over `codes`, plus the answer. */
  rows: { x: number[]; y: number }[];
  priors: number[];
  priorIntercept: number;
  observations: number[];
  accepted: number[];
}

/**
 * The feature space, which is simply "the signals that actually appeared".
 *
 * Deliberately not a fixed list. Every signal this engine can produce carries a
 * code, including the ones external evidence produces, so a source connected
 * next season starts appearing here the first time a reviewer answers a row it
 * touched — with no change to this file and no coefficient invented for a
 * signal nobody has seen. A code seen fewer than twice is dropped: one
 * observation cannot move a coefficient off its prior, and carrying it only
 * widens the matrix.
 */
function design(labels: readonly ModelLabel[], findingKey: string): Design {
  const counts = new Map<string, number>();
  const accepted = new Map<string, number>();
  const weights = new Map<string, number[]>();
  const names = new Map<string, string>();
  for (const label of labels) {
    const seen = new Set<string>();
    for (const s of label.signals) {
      if (seen.has(s.code)) continue;
      seen.add(s.code);
      counts.set(s.code, (counts.get(s.code) ?? 0) + 1);
      if (label.correct) accepted.set(s.code, (accepted.get(s.code) ?? 0) + 1);
      const bucket = weights.get(s.code) ?? [];
      bucket.push(s.weight);
      weights.set(s.code, bucket);
      if (!names.has(s.code)) names.set(s.code, s.label);
    }
  }

  const codes = [...counts.keys()].filter((code) => (counts.get(code) ?? 0) >= 2).sort();
  const base = baseFor(findingKey);
  const priorIntercept = logit(base);

  // The authored weight, translated. A weight of +0.16 on a 0.28 base was a
  // claim about probability; what the fit needs is the same claim about odds,
  // which is where the base rate enters. Averaged across the label set because
  // some signals scale their weight with the strength of a match.
  const priors = codes.map((code) => {
    const bucket = weights.get(code) ?? [];
    const mean = bucket.reduce((sum, w) => sum + w, 0) / Math.max(1, bucket.length);
    return logit(base + mean) - priorIntercept;
  });

  const index = new Map(codes.map((code, i) => [code, i]));
  const rows = labels.map((label) => {
    const x = new Array<number>(codes.length).fill(0);
    for (const s of label.signals) {
      const i = index.get(s.code);
      if (i !== undefined) x[i] = 1;
    }
    return { x, y: label.correct ? 1 : 0 };
  });

  return {
    codes,
    labelOf: names,
    rows,
    priors,
    priorIntercept,
    observations: codes.map((code) => counts.get(code) ?? 0),
    accepted: codes.map((code) => accepted.get(code) ?? 0),
  };
}

/**
 * Penalized logistic regression by Newton's method.
 *
 * Newton rather than gradient descent because the design is tiny — a dozen
 * signals at most — so a full Hessian solve is cheap and converges in a handful
 * of iterations rather than thousands, which matters when this runs inside an
 * analysis request. The ridge term is what keeps the Hessian invertible, so the
 * regularization that makes the model honest also makes it solvable; a finding
 * where every accepted row carries the same signal would otherwise separate
 * perfectly and send a coefficient to infinity.
 */
function fit(
  rows: readonly { x: number[]; y: number }[],
  priors: readonly number[],
  priorIntercept: number,
): number[] {
  const n = priors.length + 1;
  const prior = [priorIntercept, ...priors];
  // Chosen so the penalty carries the Fisher information of PRIOR_OBSERVATIONS
  // coin-flip labels: at p = 0.5 each observation contributes 0.25 to the
  // Hessian, and the ridge contributes 2λ.
  const lambda = (PRIOR_OBSERVATIONS * 0.25) / 2;
  const beta = [...prior];

  for (let iteration = 0; iteration < 25; iteration += 1) {
    const grad = new Array<number>(n).fill(0);
    const hess = Array.from({ length: n }, () => new Array<number>(n).fill(0));

    for (const row of rows) {
      const x = [1, ...row.x];
      let z = 0;
      for (let j = 0; j < n; j += 1) z += beta[j]! * x[j]!;
      const p = sigmoid(z);
      const w = Math.max(1e-6, p * (1 - p));
      for (let j = 0; j < n; j += 1) {
        if (x[j] === 0) continue;
        grad[j] = grad[j]! + (p - row.y) * x[j]!;
        for (let k = 0; k < n; k += 1) {
          if (x[k] === 0) continue;
          hess[j]![k] = hess[j]![k]! + w * x[j]! * x[k]!;
        }
      }
    }
    for (let j = 0; j < n; j += 1) {
      grad[j] = grad[j]! + 2 * lambda * (beta[j]! - prior[j]!);
      hess[j]![j] = hess[j]![j]! + 2 * lambda;
    }

    const step = solve(hess, grad);
    if (step === null) break;
    let moved = 0;
    for (let j = 0; j < n; j += 1) {
      beta[j] = beta[j]! - step[j]!;
      moved = Math.max(moved, Math.abs(step[j]!));
    }
    if (moved < 1e-8) break;
  }
  return beta;
}

/** Gaussian elimination with partial pivoting. Null where the system is singular. */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(a[pivot]![col]!) < 1e-12) return null;
    const swap = a[col]!;
    a[col] = a[pivot]!;
    a[pivot] = swap;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r]![col]! / a[col]![col]!;
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) a[r]![c] = a[r]![c]! - factor * a[col]![c]!;
    }
  }
  return a.map((row, i) => row[n]! / row[i]!);
}

function scoreRow(beta: readonly number[], x: readonly number[]): number {
  let z = beta[0] ?? 0;
  for (let i = 0; i < x.length; i += 1) z += (beta[i + 1] ?? 0) * x[i]!;
  return sigmoid(z);
}

const logLoss = (p: number, y: number) => {
  const q = clampP(p);
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};

/**
 * Ten bins of claimed-against-observed, on predictions the fit never saw.
 *
 * The same shape the quality dashboard already prints for the hand rule, so the
 * two are read side by side rather than in two vocabularies.
 */
function reliabilityOf(points: readonly { p: number; y: number }[]): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < 10; i += 1) {
    const lower = i / 10;
    const upper = (i + 1) / 10;
    const inBin = points.filter(
      (point) => point.p >= lower && (point.p < upper || (i === 9 && point.p <= 1)),
    );
    const correct = inBin.filter((point) => point.y === 1).length;
    bins.push({
      lower,
      upper,
      judged: inBin.length,
      correct,
      expected:
        inBin.length === 0 ? null : inBin.reduce((sum, point) => sum + point.p, 0) / inBin.length,
      observed: inBin.length === 0 ? null : correct / inBin.length,
    });
  }
  return bins;
}

/* -------------------------------------------------------------------------- */
/*  The whole model                                                           */
/* -------------------------------------------------------------------------- */

export interface FittedCoefficients {
  intercept: number;
  byCode: Map<string, number>;
}

export interface DetectionModelFit {
  /** What the dashboard prints. Plain data, and safe to serialize. */
  view: DetectionModel;
  /** What scoring needs. Not serialized — rebuilt from labels each time. */
  coefficients: Map<string, FittedCoefficients>;
}

export function fitDetectionModel(
  labels: readonly ModelLabel[],
  generatedAt: string,
): DetectionModelFit {
  const byFinding = new Map<string, ModelLabel[]>();
  for (const label of labels) {
    const bucket = byFinding.get(label.findingKey) ?? [];
    bucket.push(label);
    byFinding.set(label.findingKey, bucket);
  }

  const findings: FindingModel[] = [];
  const coefficients = new Map<string, FittedCoefficients>();

  for (const [findingKey, bucket] of [...byFinding.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const finding = fitOne(findingKey, bucket);
    findings.push(finding);
    if (finding.adopted) {
      coefficients.set(findingKey, {
        intercept: finding.intercept,
        byCode: new Map(finding.features.map((feature) => [feature.code, feature.fitted])),
      });
    }
  }

  return {
    view: {
      findings,
      adopted: findings.filter((finding) => finding.adopted).map((finding) => finding.findingKey),
      labels: labels.length,
      generatedAt,
    },
    coefficients,
  };
}

function fitOne(findingKey: string, labels: readonly ModelLabel[]): FindingModel {
  const accepted = labels.filter((label) => label.correct).length;
  const minority = Math.min(accepted, labels.length - accepted);
  const built = design(labels, findingKey);
  const beta = fit(built.rows, built.priors, built.priorIntercept);

  const features = built.codes.map((code, i) => ({
    code,
    label: built.labelOf.get(code) ?? code,
    prior: round(built.priors[i]!),
    fitted: round(beta[i + 1]!),
    observations: built.observations[i]!,
    accepted: built.accepted[i]!,
  }));

  const shell = {
    findingKey,
    labels: labels.length,
    accepted,
    intercept: round(beta[0]!),
    priorIntercept: round(built.priorIntercept),
    features,
    reliability: [] as CalibrationBin[],
  };

  if (labels.length < MIN_LABELS) {
    return {
      ...shell,
      adopted: false,
      fittedLoss: null,
      baselineLoss: null,
      reason: `${labels.length} of the ${MIN_LABELS} decisions it takes before this finding is fitted at all. The authored weights are scoring these rows.`,
    };
  }
  if (minority < MIN_MINORITY) {
    return {
      ...shell,
      adopted: false,
      fittedLoss: null,
      baselineLoss: null,
      reason: `Reviewers answered ${accepted} of ${labels.length} the same way, leaving ${minority} of the other. A fit on that is a constant, so the authored weights stand.`,
    };
  }

  // Out of fold, deterministically. The labels arrive newest first, so taking
  // every fifth spreads seasons and engagements across folds rather than
  // holding out one client's whole register.
  const out: { p: number; y: number; rule: number }[] = [];
  for (let fold = 0; fold < FOLDS; fold += 1) {
    const train: ModelLabel[] = [];
    const test: number[] = [];
    labels.forEach((label, i) => {
      if (i % FOLDS === fold) test.push(i);
      else train.push(label);
    });
    if (train.length === 0 || test.length === 0) continue;
    const trained = design(train, findingKey);
    const foldBeta = fit(trained.rows, trained.priors, trained.priorIntercept);
    const index = new Map(trained.codes.map((code, i) => [code, i]));
    for (const i of test) {
      const label = labels[i]!;
      const x = new Array<number>(trained.codes.length).fill(0);
      for (const s of label.signals) {
        const at = index.get(s.code);
        if (at !== undefined) x[at] = 1;
      }
      out.push({
        p: scoreRow(foldBeta, x),
        y: label.correct ? 1 : 0,
        rule: ruleScore(findingKey, label.signals),
      });
    }
  }

  const fittedLoss = mean(out.map((point) => logLoss(point.p, point.y)));
  const baselineLoss = mean(out.map((point) => logLoss(point.rule, point.y)));
  const beats =
    fittedLoss !== null && baselineLoss !== null && fittedLoss < baselineLoss * (1 - MARGIN);

  return {
    ...shell,
    reliability: reliabilityOf(out),
    adopted: beats,
    fittedLoss: fittedLoss === null ? null : round(fittedLoss),
    baselineLoss: baselineLoss === null ? null : round(baselineLoss),
    reason: beats
      ? `Fitted on ${labels.length} decisions and better than the authored weights on decisions it was not fitted on (${round(fittedLoss!)} against ${round(baselineLoss!)}, lower is better). These rows are scored by the model.`
      : `Fitted on ${labels.length} decisions and no better than the authored weights out of fold (${fittedLoss === null ? 'not measurable' : round(fittedLoss)} against ${baselineLoss === null ? 'not measurable' : round(baselineLoss)}, lower is better). The weights stand.`,
  };
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

/**
 * The score for one row, or null where this finding has no adopted model.
 *
 * Null rather than a fallback number, so the caller has to decide what to do
 * about it — which is the difference between a confidence that says where it
 * came from and one that quietly changes meaning between two rows on the same
 * page.
 */
export function modelScore(
  fitted: DetectionModelFit | null | undefined,
  findingKey: string,
  signals: readonly DetectionSignal[],
): number | null {
  const coefficients = fitted?.coefficients.get(findingKey);
  if (!coefficients) return null;
  let z = coefficients.intercept;
  const seen = new Set<string>();
  for (const s of signals) {
    if (seen.has(s.code)) continue;
    seen.add(s.code);
    const weight = coefficients.byCode.get(s.code);
    // A signal the fit never saw contributes nothing rather than its authored
    // weight. Mixing the two scales in one score would be arithmetic nobody
    // could reconstruct; the finding's next fit picks the signal up.
    if (weight !== undefined) z += weight;
  }
  return Math.min(0.97, Math.max(0.03, sigmoid(z)));
}
