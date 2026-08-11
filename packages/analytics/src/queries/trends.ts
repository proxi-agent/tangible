import type { DistributionBucket, YearTrendPoint } from '@tangible/types';
import { accountSeriesCte } from '../series.js';
import { lit, num } from '../sql.js';
import type { Warehouse } from '../warehouse.js';

/**
 * Year-over-year shape of the roll. This is the view that makes the HB 9 shock
 * visible: the exemption jump moves most of the roll out of taxability in a
 * single year, and the filing rate moves with it.
 */
export async function getYearTrend(
  warehouse: Warehouse,
  jurisdictionId: string,
): Promise<YearTrendPoint[]> {
  // Filing counts and penalty are restricted to *taxable* accounts. An account
  // below the exemption owes no tax, so it can owe no percentage of that tax
  // either — counting it would inflate the exposure with accounts that have
  // nothing at stake.
  const sql = /* sql */ `
    WITH scoped AS (
      SELECT
        ay.*,
        j.rate,
        coalesce(p.penalty_rate, 0.1) AS penalty_rate,
        (coalesce(ay.assessed_value, 0) >= coalesce(p.exemption_threshold, 0)
          AND NOT coalesce(ay.is_exempt, FALSE)) AS is_taxable
      FROM account_year ay
      LEFT JOIN tax_policy p ON p.tax_year = ay.tax_year
      CROSS JOIN (
        SELECT coalesce(
          (SELECT blended_tax_rate FROM jurisdiction WHERE jurisdiction_id = ${lit(jurisdictionId)}),
          0.025
        ) AS rate
      ) j
      WHERE ay.jurisdiction_id = ${lit(jurisdictionId)}
    )
    SELECT
      tax_year,
      count(*)                                                       AS total_accounts,
      count(*) FILTER (WHERE is_taxable)                             AS taxable_accounts,
      count(*) FILTER (WHERE is_taxable AND rendition_filed = TRUE)  AS filed_accounts,
      count(*) FILTER (WHERE is_taxable AND rendition_filed = FALSE) AS unfiled_accounts,
      coalesce(sum(assessed_value) FILTER (WHERE is_taxable), 0)     AS total_assessed_value,
      coalesce(sum(
        CASE WHEN is_taxable AND (rendition_filed = FALSE OR rendition_late = TRUE)
             THEN coalesce(assessed_value, 0) * rate * penalty_rate
             ELSE 0 END
      ), 0)                                                          AS estimated_penalty
    FROM scoped
    GROUP BY tax_year
    ORDER BY tax_year ASC;
  `;

  const rows = await warehouse.query<Record<string, unknown>>(sql);

  return rows.map((row) => {
    const filed = num(row.filed_accounts);
    const unfiled = num(row.unfiled_accounts);
    const known = filed + unfiled;
    return {
      taxYear: num(row.tax_year),
      totalAccounts: num(row.total_accounts),
      taxableAccounts: num(row.taxable_accounts),
      filedAccounts: filed,
      unfiledAccounts: unfiled,
      filingRate: known > 0 ? filed / known : null,
      totalAssessedValue: num(row.total_assessed_value),
      estimatedPenalty: num(row.estimated_penalty),
    };
  });
}

/** Value bands, chosen to straddle the $125K exemption boundary. */
const VALUE_BANDS: readonly { label: string; lower: number; upper: number | null }[] = [
  { label: 'Under $125K', lower: 0, upper: 125_000 },
  { label: '$125K – $250K', lower: 125_000, upper: 250_000 },
  { label: '$250K – $500K', lower: 250_000, upper: 500_000 },
  { label: '$500K – $1M', lower: 500_000, upper: 1_000_000 },
  { label: '$1M – $5M', lower: 1_000_000, upper: 5_000_000 },
  { label: '$5M – $25M', lower: 5_000_000, upper: 25_000_000 },
  { label: '$25M+', lower: 25_000_000, upper: null },
];

export async function getValueDistribution(
  warehouse: Warehouse,
  jurisdictionId: string,
  taxYear: number,
): Promise<DistributionBucket[]> {
  const cases = VALUE_BANDS.map((band, i) => {
    const upper = band.upper === null ? '' : ` AND latest_assessed_value < ${lit(band.upper)}`;
    return `WHEN latest_assessed_value >= ${lit(band.lower)}${upper} THEN ${lit(i)}`;
  });

  const sql = /* sql */ `
    WITH ${accountSeriesCte(jurisdictionId, taxYear, warehouse.materializedSeries)}
    SELECT
      CASE ${cases.join(' ')} ELSE NULL END                          AS band_index,
      count(*)                                                       AS account_count,
      coalesce(sum(latest_assessed_value), 0)                        AS total_assessed_value,
      count(*) FILTER (
        WHERE NOT filed_latest_year AND NOT filing_unknown_latest_year
      )                                                              AS unfiled_account_count,
      coalesce(sum(estimated_annual_penalty), 0)                     AS estimated_penalty
    FROM series
    WHERE latest_assessed_value IS NOT NULL
    GROUP BY 1
    ORDER BY 1;
  `;

  const rows = await warehouse.query<Record<string, unknown>>(sql);
  const byIndex = new Map(rows.map((r) => [num(r.band_index), r]));

  return VALUE_BANDS.map((band, i) => {
    const row = byIndex.get(i);
    return {
      label: band.label,
      lowerBound: band.lower,
      upperBound: band.upper,
      accountCount: num(row?.account_count),
      totalAssessedValue: num(row?.total_assessed_value),
      unfiledAccountCount: num(row?.unfiled_account_count),
      estimatedPenalty: num(row?.estimated_penalty),
    };
  });
}

/** Non-filing exposure broken out by state class group. */
export async function getStateClassDistribution(
  warehouse: Warehouse,
  jurisdictionId: string,
  taxYear: number,
): Promise<DistributionBucket[]> {
  const sql = /* sql */ `
    WITH ${accountSeriesCte(jurisdictionId, taxYear, warehouse.materializedSeries)}
    SELECT
      coalesce(state_class_group, 'unclassified')                    AS label,
      count(*)                                                       AS account_count,
      coalesce(sum(latest_assessed_value), 0)                        AS total_assessed_value,
      count(*) FILTER (
        WHERE NOT filed_latest_year AND NOT filing_unknown_latest_year
      )                                                              AS unfiled_account_count,
      coalesce(sum(estimated_annual_penalty), 0)                     AS estimated_penalty
    FROM series
    WHERE is_taxable
    GROUP BY 1
    ORDER BY estimated_penalty DESC;
  `;

  const rows = await warehouse.query<Record<string, unknown>>(sql);

  return rows.map((row) => ({
    label: String(row.label),
    lowerBound: null,
    upperBound: null,
    accountCount: num(row.account_count),
    totalAssessedValue: num(row.total_assessed_value),
    unfiledAccountCount: num(row.unfiled_account_count),
    estimatedPenalty: num(row.estimated_penalty),
  }));
}
