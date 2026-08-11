import { lit, num, type Warehouse } from '@tangible/analytics';
import type { JurisdictionSummary } from '@tangible/types';
import { getConnectorForJurisdiction, listJurisdictions } from './connectors/registry.js';

/**
 * Jurisdiction summaries: what is loaded, unioned with what a connector can
 * reach.
 *
 * This lives in the ingest package rather than analytics because it is the one
 * read that spans both — the counts come from the warehouse, the caveats come
 * from the connector registry. Any caller that can serve the dashboard needs
 * exactly this shape, so it is shared rather than reimplemented per host.
 */

interface JurisdictionRow {
  jurisdiction_id: unknown;
  name: unknown;
  cad_code: unknown;
  state: unknown;
  county: unknown;
  fips: unknown;
  connector_id: unknown;
  blended_tax_rate: unknown;
  homepage_url: unknown;
  data_portal_url: unknown;
  account_count: unknown;
  latest_year: unknown;
  last_ingested_at: unknown;
  years: unknown;
}

export async function listJurisdictionSummaries(
  warehouse: Warehouse,
): Promise<JurisdictionSummary[]> {
  const rows = await warehouse.query<JurisdictionRow>(/* sql */ `
    SELECT
      j.*,
      coalesce(stats.account_count, 0)  AS account_count,
      stats.latest_year,
      stats.last_ingested_at,
      coalesce(stats.years, '')         AS years
    FROM jurisdiction j
    LEFT JOIN (
      SELECT
        jurisdiction_id,
        count(DISTINCT account_id)      AS account_count,
        max(tax_year)                   AS latest_year,
        max(ingested_at)                AS last_ingested_at,
        -- Returned as a delimited string: the DuckDB client wraps LIST columns
        -- in an object rather than handing back a plain array.
        array_to_string(list(DISTINCT tax_year ORDER BY tax_year), ',') AS years
      FROM account_year
      GROUP BY 1
    ) stats USING (jurisdiction_id)
    ORDER BY account_count DESC, j.name ASC;
  `);

  const loaded = rows.map(
    (row): JurisdictionSummary => ({
      id: String(row.jurisdiction_id),
      name: String(row.name),
      cadCode: String(row.cad_code),
      state: String(row.state),
      county: String(row.county),
      fips: row.fips === null ? null : String(row.fips),
      connectorId: String(row.connector_id),
      blendedTaxRate: num(row.blended_tax_rate),
      availableYears: String(row.years ?? '')
        .split(',')
        // Drop empties before parsing: a jurisdiction with no data yields an
        // empty string, and Number('') is 0 — a year that does not exist.
        .filter((year) => year.trim() !== '')
        .map(Number)
        .filter(Number.isInteger)
        .sort((a, b) => a - b),
      homepageUrl: row.homepage_url === null ? null : String(row.homepage_url),
      dataPortalUrl: row.data_portal_url === null ? null : String(row.data_portal_url),
      // The warehouse stores what was ingested; the caveats belong to the
      // connector that produced it, so they are read from the registry.
      dataNotes:
        getConnectorForJurisdiction(String(row.jurisdiction_id))?.jurisdiction.dataNotes ?? [],
      accountCount: num(row.account_count),
      latestYear: row.latest_year === null ? null : num(row.latest_year),
      lastIngestedAt: row.last_ingested_at
        ? new Date(String(row.last_ingested_at)).toISOString()
        : null,
    }),
  );

  const known = new Set(loaded.map((j) => j.id));
  const available = listJurisdictions()
    .filter((j) => !known.has(j.id))
    .map(
      (j): JurisdictionSummary => ({
        ...j,
        accountCount: 0,
        latestYear: null,
        lastIngestedAt: null,
      }),
    );

  return [...loaded, ...available];
}

export async function findJurisdictionSummary(
  warehouse: Warehouse,
  id: string,
): Promise<JurisdictionSummary | null> {
  const all = await listJurisdictionSummaries(warehouse);
  return all.find((j) => j.id === id) ?? null;
}

/** Tax years actually present for a jurisdiction, ascending. */
export async function listAvailableYears(
  warehouse: Warehouse,
  jurisdictionId: string,
): Promise<number[]> {
  const rows = await warehouse.query<{ tax_year: unknown }>(/* sql */ `
    SELECT DISTINCT tax_year
    FROM account_year
    WHERE jurisdiction_id = ${lit(jurisdictionId)}
    ORDER BY tax_year ASC;
  `);
  return rows.map((r) => num(r.tax_year));
}
