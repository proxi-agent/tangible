import { lit, litList, num, str } from '../sql.js';
import type { Warehouse } from '../warehouse.js';

/**
 * Which taxing units levy on an account, and how much of it each one taxes.
 *
 * The warehouse's half of the per-account rate. It reads `account_unit`, which
 * the ingest normalizes at load — see `loadUnitFile` — so nothing here divides,
 * sums or repairs anything. A caller hands these placements to
 * `accountRate` in `@tangible/valuation`, which holds the adopted rates.
 */

export interface AccountUnitPlacement {
  unitCode: string;
  /** The fraction of the account this unit taxes, in [0, 1]. */
  share: number;
}

/**
 * Placements for several accounts at once, keyed by account.
 *
 * A batch rather than one call per account because an engagement with sites in
 * four cities asks for four, and each one is a single index lookup — the round
 * trips would cost more than the query. An account the roll holds no units for
 * is absent from the map rather than present and empty: "we have no units for
 * this account" and "no unit taxes it" are different facts, and only the
 * second one is a reason to refuse a rate.
 */
export async function accountPlacements(
  warehouse: Warehouse,
  jurisdictionId: string,
  taxYear: number,
  accountIds: readonly string[],
): Promise<Map<string, AccountUnitPlacement[]>> {
  const placements = new Map<string, AccountUnitPlacement[]>();
  if (accountIds.length === 0) return placements;

  const rows = await warehouse.query<Record<string, unknown>>(/* sql */ `
    SELECT account_id, unit_code, share
    FROM account_unit
    WHERE jurisdiction_id = ${lit(jurisdictionId)}
      AND tax_year = ${lit(taxYear)}
      AND account_id IN (${litList([...accountIds])})
    ORDER BY account_id, unit_code;
  `);

  for (const row of rows) {
    const accountId = str(row.account_id);
    const unitCode = str(row.unit_code);
    if (!accountId || !unitCode) continue;
    const list = placements.get(accountId) ?? [];
    list.push({ unitCode, share: num(row.share) });
    placements.set(accountId, list);
  }
  return placements;
}

/**
 * The years this jurisdiction has taxing units loaded for.
 *
 * Separate from the account roll's own year list because the two genuinely
 * diverge: Harris publishes the preliminary account file for a year months
 * before the unit file catches up, so a year can be fully on the roll with
 * only part of its accounts placed.
 */
export async function listUnitYears(
  warehouse: Warehouse,
  jurisdictionId: string,
): Promise<number[]> {
  const rows = await warehouse.query<{ tax_year: unknown }>(/* sql */ `
    SELECT DISTINCT tax_year FROM account_unit
    WHERE jurisdiction_id = ${lit(jurisdictionId)}
    ORDER BY tax_year;
  `);
  return rows.map((row) => num(row.tax_year));
}
