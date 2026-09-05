import { TX_HARRIS_RATES_2025 } from './tx-harris-2025.js';
import { TX_HARRIS_RATES_2026 } from './tx-harris-2026.js';
import type { RateTable } from './types.js';
import type { RuleProvenance } from '@tangible/types';

/**
 * Adopted rate tables, by jurisdiction and tax year.
 *
 * Deliberately not the depreciation registry's twin in one respect: there is no
 * statewide fallback and there never will be. A depreciation guide can be
 * adopted by a neighbouring district and a state can publish one its counties
 * appraise against, so `scheduleFor` has a narrow, declared fallback. A tax
 * rate is adopted by one governing body, for one unit, for one year. Nothing
 * falls back to anything, and a jurisdiction or year that is not in this list
 * returns undefined so the caller says so.
 */
export const RATE_TABLES: readonly RateTable[] = [TX_HARRIS_RATES_2025, TX_HARRIS_RATES_2026];

export function rateTableFor(jurisdictionId: string, taxYear: number): RateTable | undefined {
  return RATE_TABLES.find((t) => t.jurisdictionId === jurisdictionId && t.taxYear === taxYear);
}

/**
 * The most recent adopted year at or before `taxYear`, if there is one.
 *
 * The one narrow exception to the no-fallback rule above, and it is a fallback
 * between years of the same jurisdiction rather than between jurisdictions. It
 * exists because the calendar guarantees the gap: governing bodies adopt a
 * year's rates in the autumn, and a rendition for that year is prepared the
 * spring before. Every engagement for the coming season would otherwise price
 * at the county-wide estimate.
 *
 * Nothing here decides whether that substitution is acceptable — the caller can
 * see which year came back and has to say so on the page. Harris County's own
 * rate moved from 0.385290 to 0.380960 between 2024 and 2025, so a prior year's
 * table is a good approximation and is not the adopted rate.
 */
export function latestAdoptedYear(jurisdictionId: string, notAfter: number): number | undefined {
  const years = RATE_TABLES.filter(
    (t) => t.jurisdictionId === jurisdictionId && t.status === 'adopted' && t.taxYear <= notAfter,
  ).map((t) => t.taxYear);
  return years.length === 0 ? undefined : Math.max(...years);
}

/** The jurisdiction-years whose rates are adopted and loaded. For pickers. */
export function ratedJurisdictions(): { id: string; name: string; taxYears: number[] }[] {
  const byId = new Map<string, { id: string; name: string; taxYears: number[] }>();
  for (const table of RATE_TABLES) {
    if (table.status !== 'adopted') continue;
    const entry = byId.get(table.jurisdictionId);
    if (entry) entry.taxYears.push(table.taxYear);
    else
      byId.set(table.jurisdictionId, {
        id: table.jurisdictionId,
        name: table.jurisdictionName,
        taxYears: [table.taxYear],
      });
  }
  return [...byId.values()]
    .map((entry) => ({ ...entry, taxYears: entry.taxYears.sort((a, b) => b - a) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every committed rate table's provenance, for the rules dashboard and the gate. */
export function rateProvenance(): RuleProvenance[] {
  return RATE_TABLES.map((table) => table.provenance);
}
