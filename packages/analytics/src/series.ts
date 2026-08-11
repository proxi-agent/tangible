import { DEFAULT_BLENDED_TAX_RATE, RENDITION_PENALTY_RATE } from '@tangible/types';
import { lit } from './sql.js';

/**
 * Builds the `series` CTE: one row per account, collapsing every tax year up to
 * `asOfYear` into the derived flags the product is built on.
 *
 * This is a generated CTE rather than a stored view because "as of year N" is a
 * genuine analytical dimension — comparing the 2026 roll (post-HB 9) against
 * 2025 is the whole point, and a view fixed at the latest year cannot do it.
 *
 * A note on filing flags: `rendition_filed` is three-valued. A year is only
 * counted as unfiled when the source explicitly says FALSE. Years where the
 * jurisdiction publishes no filing flag are counted separately as unknown, so a
 * source that omits the field produces no non-filer signal at all rather than a
 * spurious one.
 */
export function accountSeriesCte(jurisdictionId: string, asOfYear: number): string {
  const j = lit(jurisdictionId);
  const y = lit(asOfYear);

  return /* sql */ `
series AS (
  WITH base AS (
    SELECT *
    FROM account_year
    WHERE jurisdiction_id = ${j}
      AND tax_year <= ${y}
  ),
  deltas AS (
    SELECT
      jurisdiction_id,
      account_id,
      assessed_value - lag(assessed_value) OVER (
        PARTITION BY jurisdiction_id, account_id ORDER BY tax_year
      ) AS delta
    FROM base
  ),
  monotonic AS (
    SELECT
      jurisdiction_id,
      account_id,
      coalesce(min(delta) >= 0, TRUE) AS never_declines
    FROM deltas
    GROUP BY 1, 2
  ),
  latest AS (
    SELECT * EXCLUDE (rn)
    FROM (
      SELECT *, row_number() OVER (
        PARTITION BY jurisdiction_id, account_id ORDER BY tax_year DESC
      ) AS rn
      FROM base
    )
    WHERE rn = 1
  ),
  agg AS (
    SELECT
      jurisdiction_id,
      account_id,
      max(tax_year)                                                    AS latest_year,
      min(tax_year)                                                    AS first_year,
      count(*)                                                         AS years_on_roll,
      count(*) FILTER (WHERE rendition_filed = FALSE)                  AS years_unfiled,
      count(*) FILTER (WHERE rendition_filed IS NULL)                  AS years_filing_unknown,
      count(*) FILTER (WHERE rendition_late = TRUE)                    AS years_filed_late,
      (count(DISTINCT assessed_value) = 1
        AND count(assessed_value) = count(*))                          AS is_frozen,
      -- Sec. 22.28 penalizes a rendition that is not filed *on time*, so late
      -- filings are exposed too, not just missing ones.
      sum(CASE WHEN rendition_filed = FALSE OR rendition_late = TRUE
               THEN coalesce(assessed_value, 0) ELSE 0 END)            AS penalizable_value_sum
    FROM base
    GROUP BY 1, 2
  ),
  policy AS (
    SELECT
      coalesce(
        (SELECT blended_tax_rate FROM jurisdiction WHERE jurisdiction_id = ${j}),
        ${lit(DEFAULT_BLENDED_TAX_RATE)}
      ) AS blended_tax_rate,
      coalesce(
        (SELECT exemption_threshold FROM tax_policy WHERE tax_year = ${y}),
        (SELECT exemption_threshold FROM tax_policy ORDER BY tax_year DESC LIMIT 1),
        0
      ) AS exemption_threshold,
      coalesce(
        (SELECT penalty_rate FROM tax_policy WHERE tax_year = ${y}),
        ${lit(RENDITION_PENALTY_RATE)}
      ) AS penalty_rate
  )
  SELECT
    a.jurisdiction_id,
    a.account_id,
    l.owner_name,
    l.owner_key,
    l.site_city,
    l.site_address,
    l.mail_city,
    l.mail_state,
    l.state_class,
    l.state_class_group,
    coalesce(l.has_agent, FALSE)                          AS has_agent,
    l.agent_name,
    coalesce(l.is_exempt, FALSE)                          AS is_exempt,
    a.latest_year,
    a.first_year,
    l.assessed_value                                      AS latest_assessed_value,
    l.appraised_value                                     AS latest_appraised_value,
    l.market_value                                        AS latest_market_value,
    a.years_on_roll,
    a.years_unfiled,
    a.years_filing_unknown,
    a.years_filed_late,
    a.is_frozen,
    m.never_declines,
    coalesce(l.rendition_filed, FALSE)                    AS filed_latest_year,
    (l.rendition_filed IS NULL)                           AS filing_unknown_latest_year,
    coalesce(l.rendition_late, FALSE)                     AS late_latest_year,
    p.blended_tax_rate,
    p.exemption_threshold,
    p.penalty_rate,
    (coalesce(l.assessed_value, 0) >= p.exemption_threshold
      AND NOT coalesce(l.is_exempt, FALSE))               AS is_taxable,
    coalesce(l.assessed_value, 0) * p.blended_tax_rate    AS estimated_annual_tax,
    CASE
      WHEN l.rendition_filed = FALSE OR l.rendition_late = TRUE
      THEN coalesce(l.assessed_value, 0) * p.blended_tax_rate * p.penalty_rate
      ELSE 0
    END                                                   AS estimated_annual_penalty,
    a.penalizable_value_sum * p.blended_tax_rate * p.penalty_rate
                                                          AS estimated_lifetime_penalty
  FROM agg a
  JOIN latest l USING (jurisdiction_id, account_id)
  JOIN monotonic m USING (jurisdiction_id, account_id)
  CROSS JOIN policy p
  -- Only accounts actually on the roll in the as-of year. Without this, an
  -- account that fell off in 2023 keeps appearing with its last known value
  -- carried forward, and every count becomes the union of all years rather
  -- than a picture of one.
  WHERE a.latest_year = ${y}
)`;
}

/** Column list of the `series` CTE, for callers that need to alias it. */
export const SERIES_COLUMNS = [
  'jurisdiction_id',
  'account_id',
  'owner_name',
  'owner_key',
  'site_city',
  'site_address',
  'mail_city',
  'mail_state',
  'state_class',
  'state_class_group',
  'has_agent',
  'agent_name',
  'is_exempt',
  'latest_year',
  'first_year',
  'latest_assessed_value',
  'latest_appraised_value',
  'latest_market_value',
  'years_on_roll',
  'years_unfiled',
  'years_filing_unknown',
  'years_filed_late',
  'is_frozen',
  'never_declines',
  'filed_latest_year',
  'filing_unknown_latest_year',
  'late_latest_year',
  'blended_tax_rate',
  'exemption_threshold',
  'penalty_rate',
  'is_taxable',
  'estimated_annual_tax',
  'estimated_annual_penalty',
  'estimated_lifetime_penalty',
] as const;
