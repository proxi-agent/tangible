import { categoryFor } from './categories.js';
import type {
  CategoryRule,
  DepreciationSchedule,
  LifeClass,
  SicProfile,
  SpecialSchedule,
} from './types.js';

/**
 * Run one asset through a jurisdiction's own arithmetic.
 *
 * HCAD's method, from page 1 of the guide: reported original cost x index
 * factor x percent good. Everything here is that sentence, plus the two edge
 * rules the tables imply rather than state.
 */

export interface AppraisalInput {
  /** Historical cost when new. */
  originalCost: number;
  /** Year acquired. Assets with no year cannot be valued; see `AppraisalGap`. */
  acquisitionYear: number;
  /** A key from HCAD_CATEGORIES, or an explicit life class to override it. */
  categoryKey: string;
  lifeClassOverride?: LifeClass;
  /**
   * The taxpayer's SIC code. For SIC-driven categories this is what actually
   * decides the life; without it those categories fall back to the category
   * default, which the result reports so the difference is never invisible.
   */
  businessSic?: string | null;
}

/** Why the asset was valued on the life it was valued on. */
export type LifeSource =
  /** A person set the life explicitly on this asset. */
  | 'override'
  /** The district's SIC table, keyed to what the business does. */
  | 'sic'
  /** The category's published default. */
  | 'category';

export interface Appraisal {
  category: CategoryRule;
  /** The table actually used, after any override. */
  schedule: LifeClass | SpecialSchedule | 'none' | 'exempt';
  indexFactor: number;
  percentGood: number;
  /** Original cost trended to replacement cost new. */
  replacementCostNew: number;
  /** What the district's schedules produce for this asset. */
  marketValue: number;
  /**
   * True when the asset is older than the schedule's last published year, so
   * the floor applied. Worth surfacing: a floored asset is fully depreciated in
   * the district's own model, and if the client is still rendering it at cost
   * that gap is the finding.
   */
  atFloor: boolean;
  /**
   * True where this jurisdiction does not tax this class of property at all,
   * in which case `marketValue` is zero and the reason says why.
   *
   * Distinct from a zero that fell out of the arithmetic: a fully depreciated
   * asset is worth nothing *and still belongs on the return*, while exempt
   * property should never have been on it. The report treats the two as
   * completely different findings, so the flag travels with the value.
   */
  exempt: boolean;
  exemptReason: string | null;
  /** Which authority decided the life. */
  lifeSource: LifeSource;
  /**
   * Set when the category is SIC-driven and the SIC produced a different life
   * from the category default. This is the misclassification lever made
   * explicit: the same machine on a different line of business is a different
   * number, and a report should be able to say by how much.
   */
  sicProfile: { sic: string; description: string; defaultLife: LifeClass } | null;
}

/** Why an asset could not be valued. Never guessed around — it is reported. */
export interface AppraisalGap {
  reason: 'no-cost' | 'no-year' | 'unknown-category' | 'no-schedule';
  detail: string;
}

export type AppraisalResult = { ok: true; value: Appraisal } | { ok: false; gap: AppraisalGap };

/**
 * Percent good for a year, with the floor rule the tables imply.
 *
 * A life class stops printing once it reaches its floor, so an asset older than
 * the last published year is not missing data — it is fully depreciated in the
 * district's model, and the floor is the answer. A year newer than the table
 * (an asset acquired after the schedule was published) takes the newest row,
 * which is the base year at 100% of the index.
 */
function lookupPercentGood(
  table: Readonly<Record<number, number>>,
  year: number,
): { percentGood: number; atFloor: boolean } | null {
  const years = Object.keys(table).map(Number);
  if (years.length === 0) return null;

  const direct = table[year];
  if (direct !== undefined) return { percentGood: direct, atFloor: false };

  const newest = Math.max(...years);
  const oldest = Math.min(...years);
  if (year > newest) return { percentGood: table[newest]!, atFloor: false };
  if (year < oldest) return { percentGood: table[oldest]!, atFloor: true };

  // A gap inside the published range would mean the table was transcribed
  // wrong, so it is reported rather than interpolated.
  return null;
}

/**
 * The index factor for a year, clamped to the published range.
 *
 * Null when there is nothing published at all, for the same reason
 * `lookupPercentGood` returns null: `Math.max()` of no arguments is
 * `-Infinity`, `indexFactors[-Infinity]` is undefined, and the non-null
 * assertion carries that undefined straight into `originalCost * factor`. The
 * result is `NaN`, which is not an error anywhere downstream — it compares
 * false against every threshold, formats as a dash, sums to `NaN`, and ends up
 * on a rendition the client signs under oath. An empty index table means the
 * schedules were extracted wrong; that is worth a gap the practitioner sees,
 * not a silently blank market value.
 */
function lookupIndexFactor(schedule: DepreciationSchedule, year: number): number | null {
  const direct = schedule.indexFactors[year];
  if (direct !== undefined) return direct;
  const years = Object.keys(schedule.indexFactors).map(Number);
  if (years.length === 0) return null;
  const newest = Math.max(...years);
  const oldest = Math.min(...years);
  if (year > newest) return schedule.indexFactors[newest]!;
  return schedule.indexFactors[oldest]!;
}

export function appraise(input: AppraisalInput, schedule: DepreciationSchedule): AppraisalResult {
  const category = categoryFor(schedule, input.categoryKey);
  if (!category) {
    return {
      ok: false,
      gap: { reason: 'unknown-category', detail: `No category "${input.categoryKey}"` },
    };
  }
  if (!Number.isFinite(input.originalCost)) {
    return { ok: false, gap: { reason: 'no-cost', detail: 'No original cost to value' } };
  }

  // Property this jurisdiction does not tax. Valued at nothing, and the answer
  // carries its authority rather than arriving as a bare zero.
  if (category.schedule === 'exempt') {
    return {
      ok: true,
      value: {
        category,
        schedule: 'exempt',
        indexFactor: 1,
        percentGood: 0,
        replacementCostNew: input.originalCost,
        marketValue: 0,
        atFloor: false,
        exempt: true,
        exemptReason: category.exemptAuthority ?? 'Not taxable property in this jurisdiction',
        lifeSource: 'category',
        sicProfile: null,
      },
    };
  }

  // Inventory and supplies are carried at full cost — no index, no percent
  // good, no acquisition year needed.
  if (category.schedule === 'none') {
    return {
      ok: true,
      value: {
        category,
        schedule: 'none',
        indexFactor: 1,
        percentGood: 100,
        replacementCostNew: input.originalCost,
        marketValue: input.originalCost,
        atFloor: false,
        exempt: false,
        exemptReason: null,
        lifeSource: 'category',
        sicProfile: null,
      },
    };
  }

  if (!Number.isInteger(input.acquisitionYear)) {
    return {
      ok: false,
      gap: { reason: 'no-year', detail: 'No acquisition year, so no point on the schedule' },
    };
  }

  // Which life applies, in order of authority: an explicit decision about this
  // asset, then the district's table for this line of business, then the
  // category default. The default is a placeholder for SIC-driven categories,
  // so falling back to it is a fact worth reporting rather than a silent step.
  const profile =
    category.sicDriven && input.businessSic ? lookupSicProfile(schedule, input.businessSic) : null;

  let lifeSource: LifeSource = 'category';
  let resolved: LifeClass | SpecialSchedule | 'none' | 'exempt' = category.schedule;
  if (input.lifeClassOverride !== undefined) {
    resolved = input.lifeClassOverride;
    lifeSource = 'override';
  } else if (profile) {
    resolved = profile.profile.machineryLife;
    lifeSource = 'sic';
  }

  const key = resolved;
  const table =
    typeof key === 'number'
      ? schedule.percentGood[key]
      : schedule.specialPercentGood[key as SpecialSchedule];
  if (!table) {
    return { ok: false, gap: { reason: 'no-schedule', detail: `No published schedule "${key}"` } };
  }

  const found = lookupPercentGood(table, input.acquisitionYear);
  if (!found) {
    return {
      ok: false,
      gap: {
        reason: 'no-schedule',
        detail: `Schedule "${key}" publishes no value for ${input.acquisitionYear}`,
      },
    };
  }

  // A schedule whose tables already carry the index is never indexed again,
  // whatever the category says. Trusting twelve category rules to each set
  // `indexed: false` is trusting the wrong thing: the fact belongs to the
  // district's arithmetic, not to the category, and getting it wrong would
  // double-trend silently.
  const indexFactor =
    category.indexed && !schedule.costIndexIncluded
      ? lookupIndexFactor(schedule, input.acquisitionYear)
      : 1;
  if (indexFactor === null) {
    return {
      ok: false,
      gap: {
        reason: 'no-schedule',
        detail: `The schedule publishes no index factors, so ${input.acquisitionYear} cannot be indexed`,
      },
    };
  }
  const replacementCostNew = input.originalCost * indexFactor;
  const marketValue = replacementCostNew * (found.percentGood / 100);

  return {
    ok: true,
    value: {
      category,
      schedule: key,
      indexFactor,
      percentGood: found.percentGood,
      replacementCostNew,
      marketValue,
      atFloor: found.atFloor,
      exempt: false,
      exemptReason: null,
      lifeSource,
      sicProfile: profile
        ? {
            sic: profile.sic,
            description: profile.profile.description,
            defaultLife: category.schedule as LifeClass,
          }
        : null,
    },
  };
}

/**
 * Find a SIC profile, tolerating how the code is actually written down.
 *
 * HCAD sub-codes carry a letter ("8049A"), the roll and the client both write
 * plain four-digit codes, and people type spaces and dots into a text field. An
 * exact hit wins; failing that, a four-digit code matches the base code's
 * canonical entry — never a lettered variant, because picking one arbitrarily
 * from several would silently choose a life.
 */
export function lookupSicProfile(
  schedule: DepreciationSchedule,
  sic: string,
): { sic: string; profile: SicProfile } | null {
  const cleaned = sic
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;

  const exact = schedule.sicProfiles[cleaned];
  if (exact) return { sic: cleaned, profile: exact };

  const base = cleaned.slice(0, 4);
  const plain = schedule.sicProfiles[base];
  if (plain) return { sic: base, profile: plain };

  return null;
}

export interface PortfolioTotals {
  /** Assets that could be valued. */
  valued: number;
  /** Assets that could not, by reason. */
  gaps: Record<AppraisalGap['reason'], number>;
  originalCost: number;
  marketValue: number;
  /** Market value of assets sitting at their schedule floor. */
  flooredMarketValue: number;
  flooredCount: number;
}

/** Aggregate a set of appraisals into the figures a report leads with. */
export function totalPortfolio(
  results: { input: AppraisalInput; result: AppraisalResult }[],
): PortfolioTotals {
  const totals: PortfolioTotals = {
    valued: 0,
    gaps: { 'no-cost': 0, 'no-year': 0, 'unknown-category': 0, 'no-schedule': 0 },
    originalCost: 0,
    marketValue: 0,
    flooredMarketValue: 0,
    flooredCount: 0,
  };

  for (const { input, result } of results) {
    if (!result.ok) {
      totals.gaps[result.gap.reason] += 1;
      continue;
    }
    totals.valued += 1;
    totals.originalCost += input.originalCost;
    totals.marketValue += result.value.marketValue;
    if (result.value.atFloor) {
      totals.flooredCount += 1;
      totals.flooredMarketValue += result.value.marketValue;
    }
  }

  return totals;
}
