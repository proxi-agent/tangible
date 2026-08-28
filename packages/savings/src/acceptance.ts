import { acceptanceFor } from './recovery.js';

/**
 * What a district actually concedes, learned from what it actually conceded.
 *
 * The acceptance rates in `recovery.ts` are judgement written down as constants.
 * They were always meant to be replaced, and this is the file that replaces
 * them — not by throwing them away, but by treating each one as a prior that
 * real outcomes pull on. That distinction is the whole design:
 *
 *   - **Nobody starts with data.** The first engagement in a new county has
 *     none, and a model that answered "no rate" there would be less useful than
 *     the guess it was supposed to improve on. So a rate always exists, and the
 *     question is only how much of it is evidence.
 *   - **Three outcomes are not a rate.** A firm that wins its first two
 *     misclassification arguments has not discovered that Harris County concedes
 *     misclassification 100% of the time. Shrinkage toward the prior is what
 *     stops the model from saying so, and the observation counts are printed
 *     next to the number so nobody has to take the shrinkage on trust.
 *   - **A rate is only published once it is worth publishing.** Below
 *     `MIN_OBSERVATIONS` the learned number is computed and shown to the firm,
 *     but it is not handed to the report as an override — the report keeps the
 *     constant and keeps saying the constant is judgement. Half-learned numbers
 *     that look measured are worse than honest guesses.
 *
 * ## What "assessor" means here
 *
 * The ambition is acceptance by finding, by county, by assessor. Two of those
 * three are observable. The third is not: nothing in this system records which
 * appraiser worked an informal, and inventing a column for it would produce a
 * field that is null on every row we will ever have. So the finest grain this
 * model learns at is the appraisal district, which in Texas *is* the assessing
 * authority as far as any record we hold is concerned. When appraiser names
 * start arriving on resolution letters, this file gains a third level and
 * nothing above it changes.
 *
 * ## Partial allowances
 *
 * A position allowed 60% of what it asked is not a win and not a loss, and
 * rounding it to either would throw away the most common outcome there is. It
 * enters as a fractional success: 0.6 toward the numerator, 0.4 against. That
 * is a quasi-likelihood rather than a real Bernoulli trial, so the interval
 * this file reports is indicative rather than exact, and it says so.
 *
 * ## What is deliberately not here
 *
 * Dollar weighting. A $2M position and a $900 position count the same. The
 * alternative — weight by value claimed — would let one large account at one
 * client set the firm's rate for a whole finding kind, and the thing being
 * estimated is how often a district says yes, not how much it says yes to.
 */

/**
 * One closed position, reduced to the only three things the model reads.
 *
 * The caller is responsible for having filtered to `learnable` rows. That rule
 * lives in `@tangible/filing`'s `realize()` and is not re-implemented here,
 * because a second copy of it is a second place for it to drift: a pro-rata
 * split and a withdrawal must never reach this function, and the one place
 * that decides so is the one that computed the split.
 */
export interface AcceptanceObservation {
  findingKey: string;
  /** The appraisal district. Null where the engagement never named one. */
  jurisdictionId: string | null;
  /** 0–1: the share of the value claimed that the district allowed. */
  share: number;
}

/**
 * How many observations the built-in constant is worth.
 *
 * Not zero, because the constants are not noise — they came from practice, and
 * a model that abandoned one on first contact with a single outcome would be
 * more confident than any person in the firm. Twelve means five real outcomes
 * move a rate roughly a third of the way from judgement to evidence, and
 * twenty-five outcomes leave the prior contributing about a third of the
 * answer. That is the pace a partner should recognise as reasonable.
 */
export const PRIOR_STRENGTH = 12;

/**
 * How much the pooled rate for a finding anchors one district's rate.
 *
 * Lower than `PRIOR_STRENGTH`, and the asymmetry is the point. "Districts
 * generally concede disposals" is a weaker claim about Harris County than
 * "Harris County conceded these eight disposals" — so eight local outcomes
 * should carry a district halfway away from the national number, which is what
 * eight here means.
 */
export const LOCAL_PRIOR_STRENGTH = 8;

/**
 * Below this, the learned rate is reported but not used.
 *
 * Five is not a statistically satisfying number and is not meant to be. It is
 * the point at which the shrunk estimate stops being almost exactly the prior,
 * which is the only thing that makes overriding worth doing at all. The
 * evidence line beside every rate carries the actual count so that a reader can
 * apply a stricter standard than this one.
 */
export const MIN_OBSERVATIONS = 5;

export interface AcceptanceEvidence {
  findingKey: string;
  /** The rate the model now uses for this finding in this district. */
  rate: number;
  /** What it would have been with no outcomes at all: the built-in constant. */
  prior: number;
  /** Every closed, learnable position of this kind, everywhere. */
  observations: number;
  /** How many of those were in this district. */
  localObservations: number;
  /** True once `observations` reaches `MIN_OBSERVATIONS`. */
  measured: boolean;
  /**
   * An approximate 95% band on the rate, from a normal approximation to the
   * Beta posterior. Wide bands are the honest output of thin data, and the
   * point of showing it is that a rate of 0.72 ± 0.19 should not be read as
   * 0.72.
   */
  interval: [number, number];
  /** The same thing in a sentence, for a screen that has room for one line. */
  basis: string;
}

export interface LearnedAcceptance {
  /**
   * The overrides map, carrying only findings that cleared `MIN_OBSERVATIONS`.
   * Passed straight into `expectedRecovery` — a key that is absent falls back
   * to the constant, which is exactly the behaviour wanted for a finding the
   * firm has never taken to this district.
   */
  rates: Record<string, number>;
  /** Every finding with at least one closed position, measured or not. */
  evidence: AcceptanceEvidence[];
  /** Closed learnable positions the model read, across all finding kinds. */
  observations: number;
  /** True when at least one rate cleared the bar. Drives the report's label. */
  measured: boolean;
}

/**
 * Learn the acceptance rates to use for one district.
 *
 * Two shrinkage steps, in the order the claims get more specific:
 *
 *   1. the built-in constant, pulled by every outcome of this kind anywhere;
 *   2. that pooled rate, pulled by the outcomes of this kind in this district.
 *
 * A finding with outcomes elsewhere but none here still moves — which is
 * right, and is most of the value in the first year of a second state. Harris
 * County's answer on ghost assets is real evidence about what Dallas will do,
 * just weaker evidence than Dallas's own.
 */
export function learnAcceptance(
  observations: readonly AcceptanceObservation[],
  jurisdictionId: string | null,
): LearnedAcceptance {
  const usable = observations.filter(
    (row) => Number.isFinite(row.share) && row.share >= 0 && row.share <= 1,
  );
  const byKey = new Map<string, AcceptanceObservation[]>();
  for (const row of usable) {
    const list = byKey.get(row.findingKey);
    if (list) list.push(row);
    else byKey.set(row.findingKey, [row]);
  }

  const evidence: AcceptanceEvidence[] = [];
  const rates: Record<string, number> = {};

  for (const [findingKey, rows] of [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const prior = acceptanceFor(findingKey);
    const pooled = shrink(prior, PRIOR_STRENGTH, rows);
    const local = rows.filter((row) => sameJurisdiction(row.jurisdictionId, jurisdictionId));
    const rate = shrink(pooled, LOCAL_PRIOR_STRENGTH, local);
    const measured = rows.length >= MIN_OBSERVATIONS;

    // The interval is taken at the level that actually produced the number: a
    // district with its own outcomes is being described by those, and the
    // pooled count would understate how little is known about it.
    const strength = local.length > 0 ? LOCAL_PRIOR_STRENGTH : PRIOR_STRENGTH;
    const anchor = local.length > 0 ? pooled : prior;
    const sample = local.length > 0 ? local : rows;

    evidence.push({
      findingKey,
      rate,
      prior,
      observations: rows.length,
      localObservations: local.length,
      measured,
      interval: interval(anchor, strength, sample),
      basis: basisSentence({
        prior,
        rate,
        observations: rows.length,
        localObservations: local.length,
        measured,
      }),
    });
    if (measured) rates[findingKey] = rate;
  }

  return {
    rates,
    evidence,
    observations: usable.length,
    measured: Object.keys(rates).length > 0,
  };
}

/**
 * Posterior mean of a Beta whose prior mean is `prior` and whose prior weight
 * is `strength`, updated by fractional successes.
 */
function shrink(prior: number, strength: number, rows: readonly AcceptanceObservation[]): number {
  const successes = rows.reduce((total, row) => total + row.share, 0);
  return (prior * strength + successes) / (strength + rows.length);
}

function interval(
  prior: number,
  strength: number,
  rows: readonly AcceptanceObservation[],
): [number, number] {
  const successes = rows.reduce((total, row) => total + row.share, 0);
  const alpha = prior * strength + successes;
  const beta = (1 - prior) * strength + (rows.length - successes);
  const total = alpha + beta;
  const mean = alpha / total;
  const sd = Math.sqrt((alpha * beta) / (total * total * (total + 1)));
  return [clamp(mean - 1.96 * sd), clamp(mean + 1.96 * sd)];
}

/**
 * Jurisdiction ids are county-scoped (`tx-harris`), and matching them exactly
 * is deliberate. Rolling up to the state would pool Harris with Bexar under the
 * name of one of them, and the county is the level at which a district's
 * habits are a real thing.
 */
function sameJurisdiction(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

function basisSentence(args: {
  prior: number;
  rate: number;
  observations: number;
  localObservations: number;
  measured: boolean;
}): string {
  const { prior, rate, observations, localObservations, measured } = args;
  const outcomes = `${observations} closed position${observations === 1 ? '' : 's'}`;
  const here =
    localObservations > 0
      ? `${localObservations} of them in this district`
      : 'none of them in this district';
  const move =
    Math.abs(rate - prior) < 0.005
      ? 'which has not moved it from the assumed rate'
      : rate > prior
        ? `which has moved it up from the assumed ${pct(prior)}`
        : `which has moved it down from the assumed ${pct(prior)}`;
  const gate = measured
    ? 'Used on the report.'
    : `Not used on the report yet — that takes ${MIN_OBSERVATIONS}.`;
  return `${outcomes}, ${here}, ${move}. ${gate}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}
