import { classificationLabel, isExclusion, isValuable } from '@tangible/classification';
import type { ClassificationStatus, FindingEvidence, FindingKind } from '@tangible/types';
import { appraise, type DepreciationSchedule, type LifeClass } from '@tangible/valuation';
import {
  rollupMapped,
  type MappableLine,
  type MappedBasis,
  type UnplacedBucket,
} from './mapped-basis.js';

/**
 * What they filed, against what they own.
 *
 * Extraction reads the return, mapping turns the filer's wording into our
 * categories, and {@link rollupMapped} puts the result on the same grain the
 * register is classified to. This is the subtraction those three steps exist
 * for, and it is where the product's central claim gets made: *this line of
 * your rendition is not supported by your own books.*
 *
 * A claim that strong has to be built so it cannot manufacture itself. Three
 * rules do that work, and every awkward part of this file comes from one of
 * them:
 *
 *   1. **Scope before you subtract.** A rendition states the owner's position
 *      on January 1 of its tax year. An asset the client bought afterwards was
 *      never renderable on it, and an asset disposed of beforehand was not
 *      theirs to render. Comparing either would invent a discrepancy out of a
 *      calendar, so both are set aside by name rather than netted in.
 *   2. **Nothing unsettled is compared.** An asset in the classification queue
 *      and a line waiting on a reviewer are both carried as *not compared*,
 *      with their cost stated. A gap in our reading must never read as a gap in
 *      the client's filing.
 *   3. **It reconciles, on both sides.** Compared cost plus set-aside cost is
 *      the whole register; matched plus reallocated plus over- or under-reported
 *      is the whole of each compared side. Every figure in the output can be
 *      walked back to a total someone can check.
 *
 * The output is deliberately two-directional. Cost on the return that the books
 * do not support is money the client is owed; cost in the books the return never
 * mentions is exposure they need to hear about before a district finds it. A
 * comparison that reported only the flattering half would be a sales document,
 * not an audit.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface RegisterAsset {
  id: string;
  description: string | null;
  acquisitionYear: number | null;
  originalCost: number | null;
  isDisposed: boolean;
  /** ISO date where the register carried one. Decides *which side* of a January 1 a disposal falls. */
  disposalDate: string | null;
  categoryKey: string | null;
  lifeClassOverride: number | null;
  /** Null when the asset has no classification row at all. */
  status: ClassificationStatus | null;
}

export interface CompareRegisterInput {
  /**
   * The tax year **the return covers** — not the engagement's. Everything is
   * scoped to that January 1, and the district's own tables for that year are
   * what priced the filing, so this is the year the schedule should come from
   * too.
   */
  taxYear: number;
  assets: readonly RegisterAsset[];
  /** The return's lines, already mapped to our categories. */
  lines: readonly MappableLine[];
  schedule: DepreciationSchedule | null;
  businessSic: string | null;
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** One (category, year) cell, with both sides of it. */
export interface ComparisonCell {
  categoryKey: string;
  label: string;
  yearAcquired: number | null;
  registerCost: number;
  reportedCost: number;
  /** Reported less register. Positive means the return claimed more than the books hold. */
  difference: number;
  /** Schedule value of the register cost, valued as the register classifies it. */
  registerValue: number | null;
  /** Schedule value of the reported cost, valued as the client filed it. */
  reportedValue: number | null;
  /** The filer's own wordings behind the reported side, so a cell can be argued with. */
  wordings: string[];
  assetCount: number;
}

export const CATEGORY_VERDICTS = [
  'agrees',
  'over-reported',
  'under-reported',
  /** Reported, with nothing on the register to support it. */
  'only-reported',
  /** Owned, and the return never mentions it. */
  'only-owned',
] as const;

export type CategoryVerdict = (typeof CATEGORY_VERDICTS)[number];

export interface ComparisonCategory {
  categoryKey: string;
  label: string;
  registerCost: number;
  reportedCost: number;
  difference: number;
  registerValue: number | null;
  reportedValue: number | null;
  verdict: CategoryVerdict;
  /**
   * The category's totals agree but its years do not — the same dollars filed
   * against different vintages. Worth its own flag because on an indexed
   * schedule the vintage is most of the value.
   */
  yearsDisagree: boolean;
  cells: ComparisonCell[];
}

/**
 * One acquisition year, decomposed.
 *
 * Within a single vintage, dollars missing from one category and appearing in
 * another are the same dollars filed under the wrong heading — a register does
 * not acquire property in 2019 twice. So the overlap is separated out as
 * reallocation before anything is called over- or under-reported, which stops
 * one mis-scheduled line from being counted as two findings.
 */
export interface ComparisonYear {
  yearAcquired: number | null;
  registerCost: number;
  reportedCost: number;
  /** Dollars that moved between categories inside this vintage. */
  reallocated: number;
  /** What is left over once reallocation is taken out. Only one of these is ever non-zero. */
  overReported: number;
  underReported: number;
  /** Schedule value of the reallocated dollars where the return put them. */
  reallocatedValueAsFiled: number | null;
  /** Schedule value of the same dollars where the register puts them. */
  reallocatedValueAsOwned: number | null;
}

export const REGISTER_ASIDE_REASONS = [
  /** Still in the classification queue — nothing is measured off an unsettled reading. */
  'needs-review',
  /** No classification row at all. */
  'unclassified',
  /** Disposed of before this return's January 1, so it was not theirs to render. */
  'disposed',
  /** Acquired after this return's January 1, so it could not have been on it. */
  'acquired-later',
  /** Not the client's taxable personal property, so it belongs on no schedule. */
  'excluded',
  /** Classified, but carrying no cost to compare. */
  'no-cost',
] as const;

export type RegisterAsideReason = (typeof REGISTER_ASIDE_REASONS)[number];

/** Register cost held out of the comparison, and why. */
export interface RegisterAside {
  reason: RegisterAsideReason;
  label: string;
  cost: number;
  assetCount: number;
  categoryKeys: string[];
}

export interface ComparisonCoverage {
  assetCount: number;
  comparedAssetCount: number;
  asideAssetCount: number;
  /** Compared assets the schedules could not price — usually a missing year. */
  unvaluableAssetCount: number;
  /** Reported lines that reached a category. */
  comparedLineCount: number;
}

/** Which way a finding moves the client's position. */
export const COMPARISON_EFFECTS = [
  /** Acting on it takes value off the return. */
  'saving',
  /** The client is under-reported and should hear it from us first. */
  'exposure',
  'neutral',
] as const;

export type ComparisonEffect = (typeof COMPARISON_EFFECTS)[number];

export interface ComparisonFinding {
  key: string;
  title: string;
  kind: FindingKind;
  effect: ComparisonEffect;
  /** Cost involved. Always computed, even where value is not. */
  cost: number;
  /** Value effect on the district's own tables. Null when no schedule could price it. */
  value: number | null;
  summary: string;
  /** The statutory or procedural hook. What makes this a real position. */
  basis: string;
  /** For modeled findings, the assumption it rests on. */
  assumption: string | null;
  /** The cells behind it, on the return's side. */
  cells: ComparisonCell[];
  /** The register rows behind it, where the finding has any. */
  assets: FindingEvidence[];
}

export interface RegisterComparison {
  taxYear: number;
  /** False when no published schedule was loaded, so every value here is null. */
  hasSchedule: boolean;
  /**
   * The published schedule actually used. It can differ from `taxYear` — a 2023
   * return priced on the 2026 guide is the district's own fallback behaviour,
   * and a report that did not say so would be comparing two years' arithmetic
   * without admitting it.
   */
  scheduleJurisdiction: string | null;
  scheduleTaxYear: number | null;

  /** Every dollar on the register, compared or not. */
  registerTotal: number;
  comparedRegisterCost: number;
  /** Every dollar read off the return, placed or not. Ties to the footing check. */
  reportedTotal: number;
  comparedReportedCost: number;

  /** Cost that lines up: same category, same vintage, both sides. */
  matchedCost: number;
  reallocatedCost: number;
  overReportedCost: number;
  underReportedCost: number;

  registerValue: number | null;
  reportedValue: number | null;
  /** Reported less register. Positive is what the client overpaid on. */
  valueDifference: number | null;
  /**
   * Compared cost the schedules could not price — almost always a missing
   * acquisition year. The value figures above are totals of what *could* be
   * priced, so these are what makes them floors rather than figures, and a
   * reader who cannot see them cannot judge the difference between them.
   */
  unpricedRegisterCost: number;
  unpricedReportedCost: number;

  categories: ComparisonCategory[];
  years: ComparisonYear[];
  registerAside: RegisterAside[];
  /** Reported cost that could not be placed, straight from the rollup. */
  reportedAside: UnplacedBucket[];
  coverage: ComparisonCoverage;
  findings: ComparisonFinding[];
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/**
 * A rendition is filed in whole dollars and a register keeps cents, so a
 * sub-dollar gap is arithmetic, not a finding. Everything below this is treated
 * as agreement.
 */
const AGREEMENT_TOLERANCE = 1;

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const round = (n: number) => Math.round(n * 100) / 100;
const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

const ASIDE_LABELS: Record<RegisterAsideReason, string> = {
  'needs-review': 'Still in the classification queue',
  unclassified: 'Never classified',
  disposed: 'Disposed of before this return’s January 1',
  'acquired-later': 'Acquired after this return’s January 1',
  excluded: 'Not the client’s taxable personal property',
  'no-cost': 'No cost on the register to compare',
};

/** Biggest first, and capped: a report is read, not scrolled. */
const EVIDENCE_SHOWN = 25;
const byCost = (a: FindingEvidence, b: FindingEvidence) =>
  (b.originalCost ?? 0) - (a.originalCost ?? 0);

const cellKey = (categoryKey: string, year: number | null) => `${categoryKey}|${year ?? '~'}`;

/** The year a disposal landed in, where the register dated it. */
function disposalYear(asset: RegisterAsset): number | null {
  if (!asset.disposalDate) return null;
  const year = Number(asset.disposalDate.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

export function compareRegister(input: CompareRegisterInput): RegisterComparison {
  const { schedule, taxYear } = input;
  const basis = rollupMapped(input.lines);

  const priceOf = (cost: number, year: number | null, categoryKey: string): number | null => {
    if (!schedule) return null;
    if (cost === 0) return 0;
    const result = appraise(
      {
        originalCost: cost,
        acquisitionYear: year ?? Number.NaN,
        categoryKey,
        businessSic: input.businessSic,
      },
      schedule,
    );
    return result.ok ? result.value.marketValue : null;
  };

  // --- The register side, scoped to this return's January 1 -----------------

  interface Cell {
    categoryKey: string;
    yearAcquired: number | null;
    registerCost: number;
    reportedCost: number;
    registerValue: number;
    registerUnvaluable: number;
    wordings: string[];
    assets: FindingEvidence[];
  }
  const cells = new Map<string, Cell>();
  const cellFor = (categoryKey: string, year: number | null): Cell => {
    const key = cellKey(categoryKey, year);
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        categoryKey,
        yearAcquired: year,
        registerCost: 0,
        reportedCost: 0,
        registerValue: 0,
        registerUnvaluable: 0,
        wordings: [],
        assets: [],
      };
      cells.set(key, cell);
    }
    return cell;
  };

  const asides = new Map<RegisterAsideReason, RegisterAside & { keys: Set<string> }>();
  const setAside = (reason: RegisterAsideReason, cost: number, categoryKey: string | null) => {
    let aside = asides.get(reason);
    if (!aside) {
      aside = {
        reason,
        label: ASIDE_LABELS[reason],
        cost: 0,
        assetCount: 0,
        categoryKeys: [],
        keys: new Set(),
      };
      asides.set(reason, aside);
    }
    aside.cost += cost;
    aside.assetCount += 1;
    if (categoryKey) aside.keys.add(categoryKey);
  };

  /** Disposed cost by cell, kept so over-reporting can be attributed to it. */
  const disposedByCell = new Map<string, { cost: number; assets: FindingEvidence[] }>();

  const coverage: ComparisonCoverage = {
    assetCount: input.assets.length,
    comparedAssetCount: 0,
    asideAssetCount: 0,
    unvaluableAssetCount: 0,
    comparedLineCount: 0,
  };

  let registerTotal = 0;

  for (const asset of input.assets) {
    const cost = asset.originalCost ?? 0;
    registerTotal += cost;

    if (asset.status === null) {
      setAside('unclassified', cost, asset.categoryKey);
      continue;
    }
    if (!isValuable({ categoryKey: asset.categoryKey, status: asset.status })) {
      setAside('needs-review', cost, asset.categoryKey);
      continue;
    }
    const categoryKey = asset.categoryKey!;

    // Excluded on both sides, and for the same reason `rollupMapped` excludes
    // them: a lessor's copier is real reported cost that belongs to somebody
    // else, and comparing it against an owned-asset register would manufacture
    // a discrepancy the size of everything the client rents.
    if (isExclusion(categoryKey)) {
      setAside('excluded', cost, categoryKey);
      continue;
    }

    // Property acquired in the return's own tax year or later was not owned on
    // its January 1. Held out rather than counted as under-reported, which is
    // what a naive subtraction would call it.
    if (asset.acquisitionYear !== null && asset.acquisitionYear >= taxYear) {
      setAside('acquired-later', cost, categoryKey);
      continue;
    }

    if (asset.isDisposed) {
      // Only a disposal that predates the assessment date takes the asset off
      // this return. One dated later — or not dated at all, where the register
      // says only that it is gone — is treated as still owned on January 1,
      // which is the reading that does not invent a finding.
      const disposed = disposalYear(asset);
      if (disposed === null || disposed < taxYear) {
        const key = cellKey(categoryKey, asset.acquisitionYear);
        const bucket = disposedByCell.get(key) ?? { cost: 0, assets: [] };
        bucket.cost += cost;
        bucket.assets.push(evidence(asset, priceOf(cost, asset.acquisitionYear, categoryKey)));
        disposedByCell.set(key, bucket);
        setAside('disposed', cost, categoryKey);
        continue;
      }
    }

    if (asset.originalCost === null) {
      setAside('no-cost', 0, categoryKey);
      continue;
    }

    const cell = cellFor(categoryKey, asset.acquisitionYear);
    cell.registerCost += cost;
    coverage.comparedAssetCount += 1;

    const value = schedule
      ? appraise(
          {
            originalCost: cost,
            acquisitionYear: asset.acquisitionYear ?? Number.NaN,
            categoryKey,
            lifeClassOverride: (asset.lifeClassOverride ?? undefined) as LifeClass | undefined,
            businessSic: input.businessSic,
          },
          schedule,
        )
      : null;
    if (value?.ok) cell.registerValue += value.value.marketValue;
    else {
      cell.registerUnvaluable += 1;
      if (schedule) coverage.unvaluableAssetCount += 1;
    }
    cell.assets.push(evidence(asset, value?.ok ? value.value.marketValue : null));
  }

  for (const aside of asides.values()) aside.categoryKeys = [...aside.keys].sort();
  coverage.asideAssetCount = [...asides.values()].reduce((sum, a) => sum + a.assetCount, 0);

  // --- The reported side ----------------------------------------------------

  for (const bucket of basis.placed) {
    const cell = cellFor(bucket.categoryKey, bucket.yearAcquired);
    cell.reportedCost += bucket.reported;
    for (const wording of bucket.wordings)
      if (!cell.wordings.includes(wording)) cell.wordings.push(wording);
    coverage.comparedLineCount += bucket.lineCount;
  }

  // --- Decompose each vintage ----------------------------------------------

  const byYear = new Map<string, Cell[]>();
  for (const cell of cells.values()) {
    const key = String(cell.yearAcquired ?? '~');
    byYear.set(key, [...(byYear.get(key) ?? []), cell]);
  }

  const years: ComparisonYear[] = [];
  let matchedCost = 0;
  let reallocatedCost = 0;
  let overReportedCost = 0;
  let underReportedCost = 0;

  /** Over-reporting attributable to each cell, once reallocation is taken out. */
  const netOverByCell = new Map<string, number>();
  const netUnderByCell = new Map<string, number>();

  for (const group of byYear.values()) {
    const year = group[0]!.yearAcquired;
    let over = 0;
    let under = 0;
    let registerCost = 0;
    let reportedCost = 0;
    // The decomposition itself carries no tolerance: every cent has to land in
    // matched, reallocated, over or under, or the identities below stop holding.
    // The tolerance decides what gets *called* a discrepancy, further down.
    for (const cell of group) {
      const diff = cell.reportedCost - cell.registerCost;
      registerCost += cell.registerCost;
      reportedCost += cell.reportedCost;
      matchedCost += Math.min(cell.registerCost, cell.reportedCost);
      if (diff > 0) over += diff;
      else under += -diff;
    }

    // A missing acquisition year is not a vintage. Two rows that share only
    // "nobody recorded when this was bought" are not the same property, and
    // netting them against each other would call two independent gaps one
    // mis-scheduled line — the reallocation argument rests entirely on a
    // register not acquiring the same property in the same year twice, and
    // there is no year here to rest it on.
    const reallocated = year === null ? 0 : Math.min(over, under);
    const netOver = over - reallocated;
    const netUnder = under - reallocated;

    // Price the reallocated dollars where each side puts them, pro-rata across
    // the cells that gave them up and the cells that received them.
    let valueAsFiled: number | null = schedule ? 0 : null;
    let valueAsOwned: number | null = schedule ? 0 : null;

    for (const cell of group) {
      const diff = cell.reportedCost - cell.registerCost;
      const key = cellKey(cell.categoryKey, cell.yearAcquired);
      if (diff > 0) {
        const share = diff / over;
        netOverByCell.set(key, netOver * share);
        if (valueAsFiled !== null) {
          const priced = priceOf(reallocated * share, year, cell.categoryKey);
          valueAsFiled = priced === null ? null : valueAsFiled + priced;
        }
      } else if (diff < 0) {
        const share = -diff / under;
        netUnderByCell.set(key, netUnder * share);
        if (valueAsOwned !== null) {
          const priced = priceOf(reallocated * share, year, cell.categoryKey);
          valueAsOwned = priced === null ? null : valueAsOwned + priced;
        }
      }
    }

    reallocatedCost += reallocated;
    overReportedCost += netOver;
    underReportedCost += netUnder;

    years.push({
      yearAcquired: year,
      registerCost: round(registerCost),
      reportedCost: round(reportedCost),
      reallocated: round(reallocated),
      overReported: round(netOver),
      underReported: round(netUnder),
      reallocatedValueAsFiled: valueAsFiled === null ? null : round(valueAsFiled),
      reallocatedValueAsOwned: valueAsOwned === null ? null : round(valueAsOwned),
    });
  }

  years.sort((a, b) => (b.yearAcquired ?? 0) - (a.yearAcquired ?? 0));

  // --- Roll cells up to categories -----------------------------------------

  const publicCells = new Map<string, ComparisonCell>();
  for (const cell of cells.values()) {
    publicCells.set(cellKey(cell.categoryKey, cell.yearAcquired), {
      categoryKey: cell.categoryKey,
      label: classificationLabel(cell.categoryKey),
      yearAcquired: cell.yearAcquired,
      registerCost: round(cell.registerCost),
      reportedCost: round(cell.reportedCost),
      difference: round(cell.reportedCost - cell.registerCost),
      registerValue: schedule && cell.registerUnvaluable === 0 ? round(cell.registerValue) : null,
      reportedValue: priceOf(cell.reportedCost, cell.yearAcquired, cell.categoryKey),
      wordings: cell.wordings,
      assetCount: cell.assets.length,
    });
  }

  const categories: ComparisonCategory[] = [];
  const byCategory = new Map<string, ComparisonCell[]>();
  for (const cell of publicCells.values())
    byCategory.set(cell.categoryKey, [...(byCategory.get(cell.categoryKey) ?? []), cell]);

  // Totalled off the cells rather than the categories: a category rolls up to
  // null the moment one of its cells cannot be priced, which is the right answer
  // for that row and the wrong one for the page — a single undated asset would
  // otherwise take the whole comparison's value with it. What could not be
  // priced is carried alongside instead, in cost.
  let registerValue: number | null = schedule ? 0 : null;
  let reportedValue: number | null = schedule ? 0 : null;
  let unpricedRegisterCost = 0;
  let unpricedReportedCost = 0;
  for (const cell of publicCells.values()) {
    if (cell.registerValue === null) unpricedRegisterCost += cell.registerCost;
    else if (registerValue !== null) registerValue += cell.registerValue;
    if (cell.reportedValue === null) unpricedReportedCost += cell.reportedCost;
    else if (reportedValue !== null) reportedValue += cell.reportedValue;
  }

  for (const [categoryKey, group] of byCategory) {
    const registerCost = group.reduce((sum, c) => sum + c.registerCost, 0);
    const reportedCost = group.reduce((sum, c) => sum + c.reportedCost, 0);
    const difference = round(reportedCost - registerCost);
    const verdict: CategoryVerdict =
      registerCost === 0
        ? 'only-reported'
        : reportedCost === 0
          ? 'only-owned'
          : Math.abs(difference) <= AGREEMENT_TOLERANCE
            ? 'agrees'
            : difference > 0
              ? 'over-reported'
              : 'under-reported';

    const catRegisterValue = group.every((c) => c.registerValue !== null)
      ? round(group.reduce((sum, c) => sum + (c.registerValue ?? 0), 0))
      : null;
    const catReportedValue = group.every((c) => c.reportedValue !== null)
      ? round(group.reduce((sum, c) => sum + (c.reportedValue ?? 0), 0))
      : null;

    categories.push({
      categoryKey,
      label: classificationLabel(categoryKey),
      registerCost: round(registerCost),
      reportedCost: round(reportedCost),
      difference,
      registerValue: catRegisterValue,
      reportedValue: catReportedValue,
      verdict,
      yearsDisagree:
        verdict === 'agrees' &&
        group.some((c) => Math.abs(c.difference) > AGREEMENT_TOLERANCE),
      cells: group.sort((a, b) => (b.yearAcquired ?? 0) - (a.yearAcquired ?? 0)),
    });
  }

  categories.sort(
    (a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.label.localeCompare(b.label),
  );

  const comparedRegisterCost = round(categories.reduce((sum, c) => sum + c.registerCost, 0));
  const comparedReportedCost = round(categories.reduce((sum, c) => sum + c.reportedCost, 0));

  const comparison: RegisterComparison = {
    taxYear,
    hasSchedule: schedule !== null,
    scheduleJurisdiction: schedule?.jurisdictionName ?? null,
    scheduleTaxYear: schedule?.taxYear ?? null,
    registerTotal: round(registerTotal),
    comparedRegisterCost,
    reportedTotal: round(basis.reportedTotal),
    comparedReportedCost,
    matchedCost: round(matchedCost),
    reallocatedCost: round(reallocatedCost),
    overReportedCost: round(overReportedCost),
    underReportedCost: round(underReportedCost),
    registerValue: registerValue === null ? null : round(registerValue),
    reportedValue: reportedValue === null ? null : round(reportedValue),
    valueDifference:
      registerValue === null || reportedValue === null ? null : round(reportedValue - registerValue),
    unpricedRegisterCost: round(unpricedRegisterCost),
    unpricedReportedCost: round(unpricedReportedCost),
    categories,
    years,
    registerAside: [...asides.values()]
      .map(({ keys: _keys, ...aside }) => ({ ...aside, cost: round(aside.cost) }))
      .sort((a, b) => b.cost - a.cost),
    reportedAside: basis.unplaced,
    coverage,
    findings: [],
  };

  const assetsByCell = new Map<string, FindingEvidence[]>(
    [...cells.entries()].map(([key, cell]) => [key, cell.assets]),
  );

  comparison.findings = findingsFor(comparison, {
    publicCells,
    assetsByCell,
    disposedByCell,
    netOverByCell,
    netUnderByCell,
    priceOf,
  });

  return comparison;
}

function evidence(asset: RegisterAsset, value: number | null): FindingEvidence {
  return {
    assetId: asset.id,
    description: asset.description,
    acquisitionYear: asset.acquisitionYear,
    originalCost: asset.originalCost,
    scheduleValue: value,
    categoryKey: asset.categoryKey,
  };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

interface FindingContext {
  publicCells: Map<string, ComparisonCell>;
  assetsByCell: Map<string, FindingEvidence[]>;
  disposedByCell: Map<string, { cost: number; assets: FindingEvidence[] }>;
  netOverByCell: Map<string, number>;
  netUnderByCell: Map<string, number>;
  priceOf: (cost: number, year: number | null, categoryKey: string) => number | null;
}

/**
 * What the two sides mean, in the order a client should hear it.
 *
 * The ordering is not by size. Disposals come first because they are the least
 * arguable thing on the list — the register itself dated them — and exposure
 * comes last but is never omitted, because a comparison that reported only the
 * refund would be a sales document rather than an audit.
 */
function findingsFor(comparison: RegisterComparison, ctx: FindingContext): ComparisonFinding[] {
  const findings: ComparisonFinding[] = [];
  const material = (key: string) => {
    const cell = ctx.publicCells.get(key);
    return cell !== undefined && Math.abs(cell.difference) > AGREEMENT_TOLERANCE;
  };
  const cellsOf = (keys: Iterable<string>) =>
    [...keys]
      .map((key) => ctx.publicCells.get(key))
      .filter((cell): cell is ComparisonCell => cell !== undefined)
      .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  // --- 1. Rendered after it was disposed of --------------------------------
  //
  // The strongest claim the comparison can make, and the only one that needs no
  // assumption at all: the client's own register says the asset was gone before
  // the assessment date, and the return reported cost in the very cell it would
  // have occupied.
  const ghostKeys: string[] = [];
  let ghostCost = 0;
  let ghostValue: number | null = comparison.hasSchedule ? 0 : null;
  const ghostAssets: FindingEvidence[] = [];

  for (const [key, disposed] of ctx.disposedByCell) {
    const over = ctx.netOverByCell.get(key) ?? 0;
    if (over <= AGREEMENT_TOLERANCE) continue;
    const attributable = Math.min(disposed.cost, over);
    if (attributable <= AGREEMENT_TOLERANCE) continue;
    const cell = ctx.publicCells.get(key);
    ghostKeys.push(key);
    ghostCost += attributable;
    ghostAssets.push(...disposed.assets);
    if (ghostValue !== null && cell) {
      const priced = ctx.priceOf(attributable, cell.yearAcquired, cell.categoryKey);
      ghostValue = priced === null ? null : ghostValue + priced;
    }
  }

  if (ghostCost > AGREEMENT_TOLERANCE) {
    const count = ghostAssets.length;
    findings.push({
      key: 'rendered-after-disposal',
      title: 'Property rendered after the register says it was gone',
      kind: 'measured',
      effect: 'saving',
      cost: round(ghostCost),
      value: ghostValue === null ? null : round(ghostValue),
      summary:
        `The ${comparison.taxYear} return reported ${money(ghostCost)} of cost in categories and years where the register carries ${count} disposed ${plural(count, 'asset')} — property the client's own books say was sold, scrapped or retired before January 1, ${comparison.taxYear}.` +
        (ghostValue === null
          ? ''
          : ` On the district's tables for that year it carried ${money(ghostValue)} of value.`),
      basis:
        'A rendition states what the owner held on January 1 (Tax Code 22.01), and Tax Code 25.25(c)(3) lets the appraisal roll be corrected for property included that did not exist in the form or at the location described. The disposal date in the client’s own fixed asset register is the evidence, which is what makes this the least arguable line on the list.',
      assumption: null,
      cells: cellsOf(ghostKeys),
      assets: ghostAssets.sort(byCost).slice(0, EVIDENCE_SHOWN),
    });
  }

  // --- 2. Reported above what the books hold --------------------------------
  const overKeys: string[] = [];
  let overCost = 0;
  let overValue: number | null = comparison.hasSchedule ? 0 : null;

  for (const [key, over] of ctx.netOverByCell) {
    if (!material(key)) continue;
    const explained = Math.min(ctx.disposedByCell.get(key)?.cost ?? 0, over);
    const remainder = over - explained;
    if (remainder <= AGREEMENT_TOLERANCE) continue;
    const cell = ctx.publicCells.get(key)!;
    overKeys.push(key);
    overCost += remainder;
    if (overValue !== null) {
      const priced = ctx.priceOf(remainder, cell.yearAcquired, cell.categoryKey);
      overValue = priced === null ? null : overValue + priced;
    }
  }

  if (overCost > AGREEMENT_TOLERANCE) {
    findings.push({
      key: 'over-reported',
      title: 'Cost reported that the register does not carry',
      kind: 'modeled',
      effect: 'saving',
      cost: round(overCost),
      value: overValue === null ? null : round(overValue),
      summary:
        `${money(overCost)} of cost on the ${comparison.taxYear} return has no matching property in the register for the same category and year acquired.` +
        (overValue === null
          ? ''
          : ` Valued as filed, on the district's own tables, that cost carried ${money(overValue)}.`),
      basis:
        'Only property the owner held on January 1 is renderable (Tax Code 22.01). Where the return states more cost than the books support, either the roll is carrying property the client no longer has — correctable under Tax Code 25.25(c)(3) — or the register is missing rows, and the two are told apart by asking.',
      assumption: `Rests on the register being complete for these categories and years. A register that omits a location, an entity, or a fully written-down class would produce this same gap, so this is the first thing to check before it reaches a district.`,
      cells: cellsOf(overKeys),
      assets: [],
    });
  }

  // --- 3. Owned and not reported --------------------------------------------
  const underKeys: string[] = [];
  let underCost = 0;
  let underValue: number | null = comparison.hasSchedule ? 0 : null;
  const underAssets: FindingEvidence[] = [];

  for (const [key, under] of ctx.netUnderByCell) {
    if (!material(key) || under <= AGREEMENT_TOLERANCE) continue;
    const cell = ctx.publicCells.get(key)!;
    underKeys.push(key);
    underCost += under;
    underAssets.push(...(ctx.assetsByCell.get(key) ?? []));
    if (underValue !== null) {
      const priced = ctx.priceOf(under, cell.yearAcquired, cell.categoryKey);
      underValue = priced === null ? null : underValue + priced;
    }
  }

  if (underCost > AGREEMENT_TOLERANCE) {
    // Unplaced reported cost is the honest caveat here, and it is a large one:
    // a single blended line reading "Furniture, Fixtures & Equipment" can cover
    // any of these categories, and calling that omitted property would be
    // wrong. So the finding is measured only when the whole return was placed.
    const unplaced = comparison.reportedAside.reduce((sum, bucket) => sum + bucket.reported, 0);
    findings.push({
      key: 'under-reported',
      title: 'Property on the register the return does not account for',
      kind: unplaced > AGREEMENT_TOLERANCE ? 'modeled' : 'measured',
      effect: 'exposure',
      cost: round(underCost),
      value: underValue === null ? null : round(underValue),
      summary:
        `${money(underCost)} of cost the register carries as owned on January 1, ${comparison.taxYear} does not appear on the return in the same category and year.` +
        (underValue === null
          ? ''
          : ` On the district's tables that cost would carry ${money(underValue)} of value.`),
      basis:
        'Tax Code 22.01 requires the owner to render all tangible personal property used for the production of income. Filing does not settle what the filing left out: under Tax Code 25.21 an appraisal office may add omitted personal property to the roll for the two preceding years, and 22.29 allows a 50% penalty where a false statement was made with intent to defraud.',
      assumption:
        unplaced > AGREEMENT_TOLERANCE
          ? `${money(unplaced)} of this return could not be placed into a category — blended wording, or lines still waiting on a reviewer — and some of it may cover this property. Settle those lines before treating this as omitted.`
          : 'Every dollar on the return was placed into a category, so nothing on the filing can be covering this.',
      cells: cellsOf(underKeys),
      assets: underAssets.sort(byCost).slice(0, EVIDENCE_SHOWN),
    });
  }

  // --- 4. Right dollars, wrong schedule -------------------------------------
  //
  // The lever that costs the most and shows the least: the same cost filed
  // under a longer-lived category depreciates more slowly on the district's
  // tables, and it recurs every year nobody looks.
  if (comparison.reallocatedCost > AGREEMENT_TOLERANCE) {
    const priced = comparison.years.filter(
      (year) =>
        year.reallocated > AGREEMENT_TOLERANCE &&
        year.reallocatedValueAsFiled !== null &&
        year.reallocatedValueAsOwned !== null,
    );
    const value =
      priced.length === 0
        ? null
        : round(
            priced.reduce(
              (sum, year) =>
                sum + (year.reallocatedValueAsFiled ?? 0) - (year.reallocatedValueAsOwned ?? 0),
              0,
            ),
          );
    const movedYears = comparison.years
      .filter((year) => year.reallocated > AGREEMENT_TOLERANCE)
      .map((year) => year.yearAcquired)
      .filter((year): year is number => year !== null);
    const keys = [...ctx.netOverByCell.keys(), ...ctx.netUnderByCell.keys()].filter(
      (key) =>
        material(key) &&
        movedYears.includes(ctx.publicCells.get(key)?.yearAcquired ?? Number.NaN),
    );

    findings.push({
      key: 'misscheduled',
      title: 'Cost filed under the wrong category for its year',
      kind: 'modeled',
      effect: value === null ? 'neutral' : value > 0 ? 'saving' : 'exposure',
      cost: round(comparison.reallocatedCost),
      value,
      summary:
        `${money(comparison.reallocatedCost)} of cost sits in one category on the register and a different one on the return, within the same year${movedYears.length === 1 ? ` — ${movedYears[0]}` : movedYears.length > 1 ? ` — ${movedYears.slice().sort((a, b) => b - a).join(', ')}` : ''}. The total is right; the schedule it is depreciating on is not.` +
        (value === null
          ? ''
          : value > 0
            ? ` Filed where it is, the district's tables carry it ${money(value)} higher than where the register puts it.`
            : ` Filed where it is, the district's tables carry it ${money(-value)} lower than where the register puts it — correcting this raises the position rather than lowering it.`),
      basis:
        'A district values rendered cost by category and year: an index factor for the vintage and a percent good from the life class the category carries. Computers on a four-year life and machinery on a twelve-year life are roughly a threefold difference in value at the same age, so the heading a dollar is filed under is most of what it is worth.',
      assumption:
        'Dollars that leave one category and arrive in another within the same acquisition year are treated as the same dollars, and priced pro-rata across the categories on each side. Where a year has several categories moving at once, that split is an apportionment rather than a trace.',
      cells: cellsOf(new Set(keys)),
      assets: [],
    });
  }

  return findings;
}
