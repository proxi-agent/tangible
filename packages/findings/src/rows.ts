import { classificationLabel } from '@tangible/classification';
import type {
  FindingRow,
  FindingRowDecision,
  FindingRowFacets,
  FindingRowFilters,
  FindingRowTotals,
  ReviewableRow,
} from '@tangible/types';

/**
 * Reading a finding's population: what the filter selects, what it adds up to,
 * and what the filter bar may offer next.
 *
 * These three are pure — rows in, answer out — and they live here rather than
 * beside the route that calls them for one reason: they are the part a client
 * is trusting. A controller who narrows to high-confidence rows over $10,000 at
 * one site and accepts what is left has accepted whatever `matches` returned,
 * and the totals printed above that table are whatever `total` returned. Both
 * deserve tests, and a Next.js lib directory is somewhere tests do not run.
 */

/**
 * Does this row survive the filter?
 *
 * Nine independent constraints, each "any of" over a list, and each an empty
 * list meaning *no constraint* rather than *match nothing* — the difference
 * between opening the page on the whole finding and opening it on an empty
 * table.
 */
export function matchesFilters(
  row: FindingRow,
  decision: FindingRowDecision | null,
  filters: FindingRowFilters,
): boolean {
  if (filters.confidence.length > 0 && !filters.confidence.includes(row.confidence.tier)) {
    return false;
  }
  if (filters.locations.length > 0) {
    // A row with no site is filterable as `unplaced` rather than unreachable.
    // On a register with no location column that is every row, and a filter
    // that silently excluded all of them would look like an empty finding.
    const placed = row.locationId ?? 'unplaced';
    if (!filters.locations.includes(placed)) return false;
  }
  if (filters.costCenters.length > 0 && !filters.costCenters.includes(row.costCenter ?? '')) {
    return false;
  }
  if (filters.categories.length > 0 && !filters.categories.includes(row.categoryKey ?? '')) {
    return false;
  }
  // An undated row passes a lower bound and fails an upper one, and vice versa:
  // "acquired 2019 or later" cannot honestly claim a row with no year, and
  // "acquired 2019 or earlier" cannot either. The infinities say exactly that.
  if (filters.acquiredFrom !== null && (row.acquisitionYear ?? -Infinity) < filters.acquiredFrom) {
    return false;
  }
  if (filters.acquiredTo !== null && (row.acquisitionYear ?? Infinity) > filters.acquiredTo) {
    return false;
  }
  if (filters.costMin !== null && (row.originalCost ?? 0) < filters.costMin) return false;
  if (filters.costMax !== null && (row.originalCost ?? 0) > filters.costMax) return false;
  if (filters.evidence === 'present' && !row.evidencePresent) return false;
  if (filters.evidence === 'absent' && row.evidencePresent) return false;
  if (filters.dispositions.length > 0) {
    const state = decision?.status ?? 'undecided';
    if (!filters.dispositions.includes(state)) return false;
  }
  if (filters.reviewers.length > 0 && !filters.reviewers.includes(decision?.decidedBy ?? '')) {
    return false;
  }
  const needle = filters.query.trim().toLowerCase();
  if (needle) {
    const haystack = [
      row.description ?? '',
      row.assetTag ?? '',
      row.costCenter ?? '',
      row.siteLabel ?? '',
      String(row.acquisitionYear ?? ''),
    ]
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/**
 * What the selected rows come to.
 *
 * `unpricedRows` is counted rather than treated as zero. A row the engine could
 * not price contributes nothing to `valueRemoved`, and without the count beside
 * it a table of blanks reads as a finding worth nothing at all.
 */
export function totalRows(rows: readonly ReviewableRow[]): FindingRowTotals {
  let originalCost = 0;
  let valueRemoved = 0;
  let taxAtRisk = 0;
  let unpricedRows = 0;
  for (const { row } of rows) {
    originalCost += row.originalCost ?? 0;
    if (row.valueRemoved === null) unpricedRows += 1;
    valueRemoved += row.valueRemoved ?? 0;
    taxAtRisk += row.taxAtRisk ?? 0;
  }
  return { rows: rows.length, originalCost, valueRemoved, taxAtRisk, unpricedRows };
}

/**
 * The filter bar's options, taken from the finding's whole population rather
 * than from what the current filter left standing. Narrowing to Houston should
 * not make Dallas vanish from the list of places you can go next.
 */
export function facetsFor(all: readonly ReviewableRow[]): FindingRowFacets {
  const locations = new Map<string, { id: string; label: string; count: number }>();
  const costCenters = new Map<string, number>();
  const categories = new Map<string, number>();
  const reviewers = new Map<string, number>();
  const confidence = { high: 0, medium: 0, low: 0 };
  const dispositions = { accepted: 0, rejected: 0, 'pending-client': 0, undecided: 0 };
  let minYear: number | null = null;
  let maxYear: number | null = null;
  let minCost: number | null = null;
  let maxCost: number | null = null;

  for (const { row, decision } of all) {
    const id = row.locationId ?? 'unplaced';
    const seen = locations.get(id) ?? {
      id,
      label: row.siteLabel ?? 'Not placed at a site',
      count: 0,
    };
    seen.count += 1;
    locations.set(id, seen);

    if (row.costCenter) costCenters.set(row.costCenter, (costCenters.get(row.costCenter) ?? 0) + 1);
    if (row.categoryKey)
      categories.set(row.categoryKey, (categories.get(row.categoryKey) ?? 0) + 1);
    if (decision?.decidedBy) {
      reviewers.set(decision.decidedBy, (reviewers.get(decision.decidedBy) ?? 0) + 1);
    }
    confidence[row.confidence.tier] += 1;
    dispositions[decision?.status ?? 'undecided'] += 1;

    if (row.acquisitionYear !== null) {
      minYear = minYear === null ? row.acquisitionYear : Math.min(minYear, row.acquisitionYear);
      maxYear = maxYear === null ? row.acquisitionYear : Math.max(maxYear, row.acquisitionYear);
    }
    if (row.originalCost !== null) {
      minCost = minCost === null ? row.originalCost : Math.min(minCost, row.originalCost);
      maxCost = maxCost === null ? row.originalCost : Math.max(maxCost, row.originalCost);
    }
  }

  const byCount = <T extends { count: number }>(a: T, b: T) => b.count - a.count;
  return {
    locations: [...locations.values()].sort(byCount),
    costCenters: [...costCenters].map(([value, count]) => ({ value, count })).sort(byCount),
    categories: [...categories]
      .map(([key, count]) => ({ key, label: classificationLabel(key), count }))
      .sort(byCount),
    reviewers: [...reviewers].map(([value, count]) => ({ value, count })).sort(byCount),
    acquired: minYear === null || maxYear === null ? null : { min: minYear, max: maxYear },
    cost: minCost === null || maxCost === null ? null : { min: minCost, max: maxCost },
    confidence,
    dispositions,
  };
}
