import type {
  DetectionSignal,
  ExpectedRecovery,
  RateBasis,
  RecoveryYear,
  TaxChain,
} from '@tangible/types';

/**
 * The chain from cost to tax, and what a position on it is actually worth.
 *
 * Two things were folded together before this file existed, and both had to be
 * unfolded for the same reason.
 *
 * The first is the rate. `blendedTaxRate` is a single number that means
 * *assessment ratio × millage*, and in Texas the ratio is 1, so the product is
 * the millage and nothing is lost. It is lost the moment a second state lands:
 * Louisiana assesses business personal property at 15% of fair market value,
 * Mississippi at 15%, and a report that multiplies market value by a blended
 * rate in those places is out by a factor of six with nothing on the page to
 * say so. So the rate is carried as its two factors, the arithmetic prints as a
 * chain a person can check step by step, and Texas is the case where one of the
 * steps happens to be ×1.
 *
 * The second is the saving. `taxAtRisk` is one year of tax on the value a
 * position removes — which is what the position is *worth if it is right and
 * the district accepts it and nobody has to argue about which years*. Three
 * conditions, and a report that prints the product of none of them is quoting
 * its best case as its expectation. Expected recovery is that number with the
 * conditions priced: probability the position is correct, probability the
 * district accepts it, and — for the years already on the roll — probability
 * the year can still be reached at all.
 *
 * None of the probabilities here are measured. They are judgement written down
 * as named constants with the reasoning beside them, wired as real multipliers
 * from the start, so that when outcome data exists phase 4 replaces a value
 * rather than a design. Where a probability is a placeholder, the report says
 * so rather than letting the number pass as evidence.
 */

/**
 * A blended rate read as a rate basis.
 *
 * The honest reading of a single number is "ratio 1, millage the number" — that
 * is what it has always meant in this codebase, and saying so explicitly is the
 * whole point. A jurisdiction that publishes a real ratio supplies one instead.
 */
export function basisFromBlendedRate(blendedTaxRate: number): RateBasis {
  return { assessmentRatio: 1, millage: blendedTaxRate };
}

export function taxOn(marketValue: number, basis: RateBasis): number {
  return marketValue * basis.assessmentRatio * basis.millage;
}

/**
 * One walk from cost to tax, in the order a district does it.
 *
 * Nulls propagate rather than becoming zero. A row whose acquisition year is
 * missing has no index factor, and a chain that printed 1.0 there would be
 * asserting a fact about a year nobody knows.
 */
export function chainFrom(args: {
  assessableCost: number | null;
  indexFactor: number | null;
  percentGood: number | null;
  marketValue: number | null;
  basis: RateBasis;
}): TaxChain {
  const { assessableCost, indexFactor, percentGood, marketValue, basis } = args;
  const replacementCostNew =
    assessableCost === null || indexFactor === null ? null : assessableCost * indexFactor;
  const assessedValue = marketValue === null ? null : marketValue * basis.assessmentRatio;
  return {
    assessableCost,
    indexFactor,
    percentGood,
    replacementCostNew,
    marketValue,
    assessmentRatio: basis.assessmentRatio,
    assessedValue,
    millage: basis.millage,
    tax: assessedValue === null ? null : assessedValue * basis.millage,
  };
}

/**
 * The chain a removed row takes to nothing.
 *
 * A row that comes off the rendition entirely has a corrected chain, and it is
 * not "the same chain with the tax blanked" — every step below the removal is
 * zero, and printing it that way is what makes the waterfall readable as two
 * columns rather than one column and an assertion.
 */
export function removedChain(basis: RateBasis): TaxChain {
  return {
    assessableCost: 0,
    indexFactor: null,
    replacementCostNew: 0,
    percentGood: null,
    marketValue: 0,
    assessmentRatio: basis.assessmentRatio,
    assessedValue: 0,
    millage: basis.millage,
    tax: 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  Which years a position can reach                                          */
/* -------------------------------------------------------------------------- */

/**
 * The 25.25 route a finding leans on for the years already rolled.
 *
 * Not a detail: the two free routes have different windows and reach different
 * errors, and picking the wrong one for a finding would put five years of
 * recovery behind a position that can only reach two.
 *
 *   - **(c)** — five preceding years. Clerical errors, multiple appraisals, an
 *     ownership error, and the inclusion of property *that does not exist in
 *     the form or at the location described in the appraisal roll*. Disposed
 *     assets, duplicates, situs errors and property owned by somebody else all
 *     sit under that last limb, which is why they get five years.
 *   - **(c-1)** — the current year and the two before it, for an inaccuracy in
 *     the appraised value of personal property caused by an error or omission
 *     in a rendition. Misclassification, non-assessable cost inside a
 *     capitalized amount, and a carried-forward wrong figure are all errors in
 *     a rendition rather than property that is not there.
 *   - **null** — a screening finding reaches no prior year, because there is no
 *     position yet to take to one.
 */
export type RecoveryRoute = 'c' | 'c-1' | 'fl-refund' | null;

const TEXAS_ROUTES: Record<string, RecoveryRoute> = {
  'ghost-assets': 'c',
  'suspected-retired': null,
  'situs-error': 'c',
  'duplicate-capitalization': 'c',
  'leased-double-report': 'c',
  'non-taxable': 'c-1',
  misclassification: 'c-1',
  'non-assessable-cost': 'c-1',
  'carryforward-error': 'c-1',
  'de-minimis': 'c-1',
  'fully-depreciated': null,
  'leasehold-double-tax': null,
  freeport: null,
  'idle-obsolete': null,
};

/**
 * Florida, and it is a shorter list than Texas on purpose.
 *
 * Florida has no 25.25. What it has is s. 197.182, F.S. — a refund of taxes
 * "erroneously or illegally assessed", claimed with the tax collector within
 * four years after January 1 of the tax year the taxes were paid for. That is a
 * genuine multi-year route and it is the Florida analogue of 25.25(c).
 *
 * What it is *not* is an analogue of 25.25(c-1). The Texas (c-1) route exists
 * specifically to correct "an error or omission in a rendition" — the
 * taxpayer's own filing — and Texas wrote that remedy down. Florida did not.
 * A Florida taxpayer who reported a machine on the wrong life reported it that
 * way, the county assessed what was rendered, and calling that assessment
 * *erroneous* is a much harder argument than "you taxed property that was not
 * there". So the rendition-error family reaches no prior year here, and the
 * report shows a smaller retroactive number in Florida than in Texas for the
 * same finding on the same asset. That difference is the point of the table.
 *
 * The current year is not on this list either, because it is not a refund
 * question: it is a VAB petition under s. 194.011(3), filed within 25 days of
 * the TRIM notice, and the prospective term already prices it.
 *
 * These section-level citations are checked; the subsection letters inside
 * 197.182 are not, and no motion should quote one from here without somebody
 * opening the statute. The rule carries no approver for exactly that reason.
 */
const FLORIDA_ROUTES: Record<string, RecoveryRoute> = {
  'ghost-assets': 'fl-refund',
  'situs-error': 'fl-refund',
  'duplicate-capitalization': 'fl-refund',
  'leased-double-report': 'fl-refund',
  'non-taxable': 'fl-refund',
  'suspected-retired': null,
  misclassification: null,
  'non-assessable-cost': null,
  'carryforward-error': null,
  'de-minimis': null,
  'fully-depreciated': null,
  'leasehold-double-tax': null,
  freeport: null,
  'idle-obsolete': null,
};

/**
 * Which statute a jurisdiction's prior years run on.
 *
 * A state nobody has researched gets no route at all rather than the Texas one.
 * Quoting 25.25(c) to a Georgia assessor is not a small error — it is the
 * sentence that ends the conversation.
 */
export function routesFor(jurisdictionId: string | null): Record<string, RecoveryRoute> {
  if (jurisdictionId === null || jurisdictionId.startsWith('tx-')) return TEXAS_ROUTES;
  if (jurisdictionId === 'fl' || jurisdictionId.startsWith('fl-')) return FLORIDA_ROUTES;
  return {};
}

export function routeFor(findingKey: string, jurisdictionId: string | null = null): RecoveryRoute {
  return routesFor(jurisdictionId)[findingKey] ?? null;
}

/** 25.25(c): "any of the five preceding years". */
const C_YEARS = 5;
/** 25.25(c-1): "the current tax year and ... either of the two preceding". */
const C1_YEARS = 2;
/**
 * s. 197.182: four years after January 1 of the tax year. Counted as the three
 * preceding years, because the current year is the prospective term and is
 * reached by petition rather than by refund.
 */
const FL_REFUND_YEARS = 3;

export function routeYears(route: RecoveryRoute): number {
  if (route === 'c') return C_YEARS;
  if (route === 'c-1') return C1_YEARS;
  if (route === 'fl-refund') return FL_REFUND_YEARS;
  return 0;
}

/** The statute a route rests on, as a report footnote would print it. */
export function routeAuthority(route: RecoveryRoute): string | null {
  if (route === 'c') return 'Tex. Tax Code 25.25(c)';
  if (route === 'c-1') return 'Tex. Tax Code 25.25(c-1)';
  if (route === 'fl-refund') return 's. 197.182, F.S.';
  return null;
}

/**
 * How likely a prior year is still reachable, given nothing about that year.
 *
 * Every bar in 25.25 is a fact about a year this engine has not been told: a
 * 1.111(e) settlement, an ARB determination on the merits, a 22.28 penalty, a
 * motion already spent. The firm-side `correctionOutlook` decides those exactly
 * when the facts are on file. Here they are not, so this is a decay: the older
 * the year, the more likely one of them happened and the more likely the
 * records that would prove the position are gone.
 *
 * `(c)` decays more slowly than `(c-1)` because its bars are narrower — 25.25(l)
 * says a (c) motion may be filed regardless of whether the owner protested that
 * year, so the single most common thing that shuts (c-1) does not touch it.
 *
 * These two numbers are the most replaceable constants in the file. They are
 * where outcome data lands first.
 */
const YEAR_DECAY: Record<Exclude<RecoveryRoute, null>, number> = {
  c: 0.82,
  'c-1': 0.7,
  /**
   * Lower than either Texas route, and not because the window is shorter — the
   * window is already in `routeYears`. It is lower because a Florida refund
   * runs through more hands: the property appraiser has to certify the error
   * before the tax collector will pay, and the Department of Revenue's approval
   * is required above a threshold. Each of those is a place the claim stops for
   * reasons that have nothing to do with whether it is right.
   */
  'fl-refund': 0.6,
};

/**
 * What share of positions of this kind a district actually concedes.
 *
 * Judgement, and labelled as such everywhere it is printed. The ordering is
 * the part worth arguing with, and it is not arbitrary: a disposal with a date
 * on it is a documentary fact an appraiser has no counter to, and a freeport
 * share is a negotiation about a shipping report. What sits between them is
 * sorted by how much of the answer lives in a document the taxpayer already
 * holds.
 *
 * Read this as "of the positions we assert and are right about, what share does
 * the district accept" — being right is priced separately, by confidence, and
 * multiplying the two is the whole point of keeping them apart.
 */
const ACCEPTANCE: Record<string, number> = {
  'ghost-assets': 0.9,
  'non-taxable': 0.8,
  'duplicate-capitalization': 0.75,
  'situs-error': 0.78,
  'leased-double-report': 0.72,
  'non-assessable-cost': 0.65,
  misclassification: 0.6,
  'carryforward-error': 0.7,
  'de-minimis': 0.85,
  // Screening findings never reach here — they have no priced value to accept —
  // but a rate is kept for each so that pricing one later is a data change.
  'fully-depreciated': 0.55,
  'leasehold-double-tax': 0.4,
  freeport: 0.45,
  'idle-obsolete': 0.35,
  'suspected-retired': 0.3,
};

/** The default for a finding key nobody has priced yet. Deliberately timid. */
const DEFAULT_ACCEPTANCE = 0.5;

export function acceptanceFor(findingKey: string, overrides?: Record<string, number>): number {
  return overrides?.[findingKey] ?? ACCEPTANCE[findingKey] ?? DEFAULT_ACCEPTANCE;
}

/** Everything the model uses, printed on the report so a reader can disagree. */
export interface RecoveryModel {
  /** True until outcome data replaces the acceptance rates. */
  acceptanceIsPlaceholder: boolean;
  acceptance: Record<string, number>;
  yearDecay: Record<string, number>;
  routes: Record<string, RecoveryRoute>;
  note: string;
  /** Where the learned rates came from. See `acceptance.ts`. */
  acceptanceEvidence?: AcceptanceEvidenceLine[];
}

/**
 * The evidence line as the report carries it.
 *
 * Structurally the `AcceptanceEvidence` that `acceptance.ts` produces, declared
 * here rather than imported from it so that this file — which every caller of
 * `expectedRecovery` already depends on — does not acquire a dependency on the
 * learner. The learner depends on this file, and one direction is enough.
 */
export interface AcceptanceEvidenceLine {
  findingKey: string;
  rate: number;
  prior: number;
  observations: number;
  localObservations: number;
  measured: boolean;
  interval: [number, number];
  basis: string;
}

/**
 * `overrides` empty is not the same as `overrides` supplied.
 *
 * A firm with outcomes recorded but none yet past the publishing bar hands this
 * function an empty map, and the earlier `overrides === undefined` test would
 * have read that as "measured" and dropped the placeholder warning off a report
 * whose every rate was still a constant. The map has to have something in it
 * before the report stops apologising for itself.
 */
export function recoveryModel(
  overrides?: Record<string, number>,
  jurisdictionId: string | null = null,
  evidence?: AcceptanceEvidenceLine[],
): RecoveryModel {
  const learned = overrides !== undefined && Object.keys(overrides).length > 0;
  return {
    acceptanceIsPlaceholder: !learned,
    acceptance: { ...ACCEPTANCE, ...(overrides ?? {}) },
    yearDecay: { ...YEAR_DECAY },
    routes: { ...routesFor(jurisdictionId) },
    note: learned
      ? 'Expected recovery multiplies one year of tax by how sure we are the position is right, ' +
        'by how often a district concedes a position of this kind, and — for years already on the ' +
        'roll — by how likely that year can still be corrected. The acceptance rates marked as ' +
        'measured below come from positions this firm has actually closed, shrunk toward the ' +
        'assumed rate in proportion to how few of them there are; the rest are still estimates.'
      : 'Expected recovery multiplies one year of tax by how sure we are the position is right, ' +
        'by how often a district concedes a position of this kind, and — for years already on the ' +
        'roll — by how likely that year can still be corrected. The second and third are informed ' +
        'estimates rather than measured rates, and they are printed here so a reader can substitute ' +
        'their own.',
    ...(evidence !== undefined && evidence.length > 0 ? { acceptanceEvidence: evidence } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/*  Expected recovery                                                         */
/* -------------------------------------------------------------------------- */

export interface RecoveryInput {
  findingKey: string;
  taxYear: number;
  /** One year of tax on the value this position removes. Null leaves it unscored. */
  taxAtRisk: number | null;
  /** 0–1. The row's own confidence, used as the probability it is correct. */
  confidence: number;
  /**
   * The earliest tax year this same error would have been on the roll.
   *
   * The one term in the model that is a fact rather than a judgement, and the
   * reason retroactive recovery is not simply "×5". An asset bought in 2025 has
   * no 2023 exposure; an asset disposed of in June 2024 was correctly on the
   * 2024 roll and is only wrong from 2025. Null means the register cannot say,
   * and the retroactive term is dropped rather than assumed.
   */
  firstExposedYear: number | null;
  /**
   * Which state's correction statute applies. Null means Texas, which is what
   * every caller meant before there was a second state and is kept as the
   * default so no existing call site silently changes answer.
   */
  jurisdictionId?: string | null;
  acceptanceOverrides?: Record<string, number>;
}

export function expectedRecovery(input: RecoveryInput): ExpectedRecovery | null {
  if (input.taxAtRisk === null || !Number.isFinite(input.taxAtRisk)) return null;

  const tax = input.taxAtRisk;
  const pCorrect = clamp(input.confidence);
  const pAccepted = clamp(acceptanceFor(input.findingKey, input.acceptanceOverrides));
  const route = routeFor(input.findingKey, input.jurisdictionId ?? null);

  const prospectiveExpected = tax * pCorrect * pAccepted;

  const years: RecoveryYear[] = [];
  if (route !== null && input.firstExposedYear !== null) {
    const decay = YEAR_DECAY[route];
    const oldest = input.taxYear - routeYears(route);
    for (let year = input.taxYear - 1; year >= oldest; year -= 1) {
      // The asset has to have been wrong on that year's roll. Anything earlier
      // than the first exposed year is a year the return was right.
      if (year < input.firstExposedYear) break;
      const age = input.taxYear - year;
      const probabilityOpen = decay ** age;
      years.push({
        taxYear: year,
        // Priced at this year's rate. Rates move a percent or two a year and
        // the historical ones are not on file; using the current rate is stated
        // rather than hidden, and it is the smallest assumption in the model.
        tax,
        probabilityOpen,
        expected: tax * pCorrect * pAccepted * probabilityOpen,
      });
    }
  }

  const retroExpected = years.reduce((sum, y) => sum + y.expected, 0);
  return {
    expected: prospectiveExpected + retroExpected,
    prospective: { tax, expected: prospectiveExpected },
    retroactive: { route, years, expected: retroExpected },
    probabilityCorrect: pCorrect,
    probabilityAccepted: pAccepted,
    undiscounted: tax * (1 + years.length),
  };
}

function clamp(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/**
 * A signal recording what the retroactive term rests on, so the row's own
 * "why" sentence can carry it. Weightless on purpose: this explains the money,
 * it does not argue for the position.
 */
export function recoverySignal(recovery: ExpectedRecovery): DetectionSignal | null {
  const { years, route } = recovery.retroactive;
  if (years.length === 0 || route === null) return null;
  const oldest = years[years.length - 1]!.taxYear;
  return {
    code: 'prior-years-open',
    label: `Prior years reachable under ${routeAuthority(route) ?? 'the applicable correction statute'}`,
    weight: 0,
    detail: `${years.length} year${years.length === 1 ? '' : 's'} back to ${oldest}, subject to what the district's records show`,
  };
}
