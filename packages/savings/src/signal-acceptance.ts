import type { DetectionSignal } from '@tangible/types';

/**
 * Which evidence a district actually pays for.
 *
 * `acceptance.ts` learns how often a county concedes a *kind* of argument. That
 * is the right first thing to learn and it is blind to the one distinction a
 * reviewer makes every day: a ghost-asset row with a disposal date written on
 * it and a ghost-asset row flagged because nothing else explained a zero-cost
 * line are not the same position, and a model that prices them identically is
 * saying the evidence on the row does not matter to the district. Nobody
 * believes that. This file measures it.
 *
 * The measurement is the only feedback path in the engine that does not run
 * through a person in the firm. Everything else the system learns from — the
 * review queue, the classification memory, the column mappings — is the firm
 * marking its own homework, which is worth a great deal and is still the firm's
 * opinion. An allowed claim is the district's opinion, and it is the one that
 * decides what the client owes.
 *
 * ## What this is not allowed to touch
 *
 * Confidence. A district's answer is not evidence about whether a position was
 * *correct* — an argument can be right and refused, and a district that
 * concedes a weak position has conceded a weak position. Those are two
 * different questions and the engine keeps two different numbers for them:
 * `confidence` is "is this true", learned from reviewers in `model.ts`;
 * acceptance is "will this stick", learned here. Feeding outcomes into
 * confidence would quietly redefine the word on every screen that prints it,
 * and the row that suffered would be the correct unpopular one.
 *
 * ## Why the prior here is zero and in `model.ts` it is not
 *
 * `model.ts` anchors each coefficient to an authored weight, because somebody
 * sat down and wrote a sentence about what that signal means. Nobody has ever
 * written a sentence about what a signal is worth *to an appraisal district* —
 * that claim has no author and no argument behind it. So the honest prior is
 * that a signal changes nothing, and every lift below has to be bought out of
 * outcomes.
 *
 * ## Marginal lifts are not additive, and are not added
 *
 * Each lift is measured one code at a time, against every position that lacked
 * it. Signals co-occur heavily — a recorded disposal date and a disposal flag
 * are one fact seen twice — so summing the lifts of the codes a row carries
 * would count that fact twice and would keep counting it as more sources
 * arrive. Rather than pretend to a joint fit that a few dozen outcomes cannot
 * support, a row takes the single largest lift it carries and nothing else.
 * That understates a row whose signals really are independent, which is the
 * direction to be wrong in when the output is a number on a client's estimate.
 */

/**
 * One closed position, with the evidence that was showing when it went out.
 *
 * The signals come off the claim, not off the row's current state. The claim
 * froze them at filing for the same reason it froze the predicted confidence:
 * the register can be re-imported and the row re-decided, and a prediction
 * reconstructed after the answer is not a prediction.
 */
export interface SignalOutcome {
  findingKey: string;
  signals: readonly DetectionSignal[];
  /** 0–1: the share of the value claimed that the district allowed. */
  share: number;
}

/**
 * How much a finding's own rate anchors each arm of a comparison.
 *
 * Ten, and deliberately heavier than it looks: it applies to *both* arms, so a
 * code seen six times against thirty is pulled toward the finding's own mean
 * from both sides and only real separation survives. The alternative — raw
 * arm means — would report a lift of a full log-odds the first time six ghost
 * rows with disposal dates all came back allowed, which is a fact about six
 * rows.
 */
export const SIGNAL_PRIOR_STRENGTH = 10;

/**
 * The smallest either arm may be.
 *
 * Both arms, not just the one carrying the code. A code present on 40 of 42
 * positions has been measured against two, and "positions without it do worse"
 * is then a claim about two positions wearing the authority of forty.
 */
export const MIN_ARM = 6;

/**
 * The smallest lift worth applying, in log-odds.
 *
 * A tenth of a log-odd moves a 60% rate to about 62%. Below that the code has
 * been measured and found not to matter, which is a real and reportable result
 * — it is shown on the board with its counts — but multiplying an estimate by
 * it would be arithmetic dressed as knowledge.
 */
export const MIN_LIFT = 0.1;

/**
 * And the largest, in log-odds, however flatly the outcomes separate.
 *
 * One log-odd takes a 50% rate to 73% or to 27%. A cap rather than a trust in
 * the shrinkage because the shrinkage protects against thin arms and not
 * against a real but unrepeatable run — one appraiser, one season, one
 * argument they happened to be tired of.
 */
export const MAX_LIFT = 1;

export interface SignalLift {
  findingKey: string;
  code: string;
  /** The signal's own label, as the row prints it. */
  label: string;
  /** Closed positions of this finding that carried the code. */
  withCount: number;
  /** Their allowed share, shrunk toward the finding's own mean. */
  withShare: number;
  withoutCount: number;
  withoutShare: number;
  /** `logit(withShare) − logit(withoutShare)`, capped. */
  lift: number;
  /** True when both arms cleared `MIN_ARM` and the lift cleared `MIN_LIFT`. */
  published: boolean;
  basis: string;
}

export interface SignalLiftModel {
  lifts: SignalLift[];
  /** Closed positions read, across every finding. */
  observations: number;
  /** How many lifts are actually moving estimates. */
  published: number;
}

/** What one row's estimate is adjusted by, and which single signal did it. */
export interface AppliedLift {
  code: string;
  label: string;
  lift: number;
  basis: string;
}

const clampP = (p: number) => Math.min(0.98, Math.max(0.02, p));
const logit = (p: number) => Math.log(clampP(p) / (1 - clampP(p)));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/**
 * Distinct codes on a row. A signal fired twice is one fact.
 *
 * Weightless signals are dropped, and the reason is an ordering one rather than
 * a philosophical one. A signal carrying no weight is one appended to *explain*
 * a number instead of to argue for the position — the prior-years line is
 * computed from the recovery it annotates — so it does not exist yet at the
 * moment the row is priced. A lift measured on it could therefore never be
 * applied to anything, and would sit on the board looking like knowledge the
 * engine had declined to use.
 */
function codesOf(signals: readonly DetectionSignal[]): Set<string> {
  return new Set(signals.filter((s) => s.weight !== 0).map((s) => s.code));
}

export function learnSignalLifts(outcomes: readonly SignalOutcome[]): SignalLiftModel {
  const usable = outcomes.filter(
    (row) => Number.isFinite(row.share) && row.share >= 0 && row.share <= 1,
  );

  const byFinding = new Map<string, SignalOutcome[]>();
  for (const row of usable) {
    const bucket = byFinding.get(row.findingKey);
    if (bucket) bucket.push(row);
    else byFinding.set(row.findingKey, [row]);
  }

  const lifts: SignalLift[] = [];
  for (const [findingKey, rows] of [...byFinding.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    // The anchor is the finding's own observed mean rather than the built-in
    // constant. What is being measured here is separation *within* a finding —
    // whether one kind of ghost row does better than another — and anchoring to
    // a rate the finding as a whole has already moved away from would report
    // that move on every code alike.
    const anchor = mean(rows.map((row) => row.share));
    // Each row's codes once, not once per code. The sets are read twice per
    // code below and there are as many codes as a detector emits, so building
    // them inline turned one pass over the finding into a quadratic one.
    const codeSets = rows.map((row) => codesOf(row.signals));
    const labels = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const [index, row] of rows.entries()) {
      for (const code of codeSets[index]!) {
        counts.set(code, (counts.get(code) ?? 0) + 1);
        if (!labels.has(code)) {
          labels.set(code, row.signals.find((s) => s.code === code)?.label ?? code);
        }
      }
    }

    for (const code of [...counts.keys()].sort()) {
      const withRows = rows.filter((_, index) => codeSets[index]!.has(code));
      const withoutRows = rows.filter((_, index) => !codeSets[index]!.has(code));
      const withShare = shrink(anchor, withRows);
      const withoutShare = shrink(anchor, withoutRows);
      const raw = logit(withShare) - logit(withoutShare);
      const lift = Math.max(-MAX_LIFT, Math.min(MAX_LIFT, raw));
      const armed = withRows.length >= MIN_ARM && withoutRows.length >= MIN_ARM;
      const published = armed && Math.abs(lift) >= MIN_LIFT;
      lifts.push({
        findingKey,
        code,
        label: labels.get(code) ?? code,
        withCount: withRows.length,
        withShare: round(withShare),
        withoutCount: withoutRows.length,
        withoutShare: round(withoutShare),
        lift: round(lift),
        published,
        basis: basisSentence({
          withCount: withRows.length,
          withShare,
          withoutCount: withoutRows.length,
          withoutShare,
          lift,
          armed,
          published,
        }),
      });
    }
  }

  return {
    lifts,
    observations: usable.length,
    published: lifts.filter((one) => one.published).length,
  };
}

/**
 * The one lift a row gets, or null where it has earned none.
 *
 * Largest in absolute value, ties broken by code so two runs of the same report
 * never disagree. A row carrying both a signal the district pays for and one it
 * punishes takes the bigger of the two: they are two readings of the same
 * district and the stronger one is the better measured.
 */
export function liftFor(
  lifts: readonly SignalLift[],
  findingKey: string,
  signals: readonly DetectionSignal[],
): AppliedLift | null {
  const codes = codesOf(signals);
  const candidates = lifts.filter(
    (one) => one.published && one.findingKey === findingKey && codes.has(one.code),
  );
  if (candidates.length === 0) return null;
  const best = [...candidates].sort(
    (a, b) => Math.abs(b.lift) - Math.abs(a.lift) || a.code.localeCompare(b.code),
  )[0]!;
  return { code: best.code, label: best.label, lift: best.lift, basis: best.basis };
}

/** A finding's rate for this district, moved by what the row is carrying. */
export function adjustAcceptance(rate: number, lift: AppliedLift | null): number {
  if (lift === null) return rate;
  return Math.min(0.97, Math.max(0.03, sigmoid(logit(rate) + lift.lift)));
}

/**
 * Posterior mean of a Beta anchored at the finding's own rate, updated by
 * fractional successes. The same shape `acceptance.ts` uses, and for the same
 * reason: a partial allowance is the most common outcome there is, and rounding
 * it to a win or a loss would throw away most of the dataset.
 */
function shrink(anchor: number, rows: readonly SignalOutcome[]): number {
  const successes = rows.reduce((total, row) => total + row.share, 0);
  return (anchor * SIGNAL_PRIOR_STRENGTH + successes) / (SIGNAL_PRIOR_STRENGTH + rows.length);
}

function basisSentence(args: {
  withCount: number;
  withShare: number;
  withoutCount: number;
  withoutShare: number;
  lift: number;
  armed: boolean;
  published: boolean;
}): string {
  const { withCount, withShare, withoutCount, withoutShare, armed, published } = args;
  const seen = `Allowed ${pct(withShare)} on the ${plural(withCount, 'position')} carrying it, against ${pct(withoutShare)} on the ${plural(withoutCount, 'position')} without it.`;
  if (!armed) {
    return `${seen} Not applied: it takes ${MIN_ARM} closed positions on each side before the comparison says anything.`;
  }
  if (!published) {
    return `${seen} Measured and found not to matter, so it moves nothing.`;
  }
  return `${seen} Applied to the estimate for rows carrying it.`;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0.5;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const round = (n: number) => Math.round(n * 1000) / 1000;
