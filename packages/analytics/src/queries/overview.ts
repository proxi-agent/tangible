import {
  SEGMENT_KEYS,
  type MarketOverview,
  type SegmentKey,
  type SegmentMetric,
} from '@tangible/types';
import { SEGMENT_PREDICATES } from '../predicates.js';
import { accountSeriesCte } from '../series.js';
import { num, numOrNull } from '../sql.js';
import type { Warehouse } from '../warehouse.js';

/**
 * Every segment's headline numbers, computed in a single pass over the roll.
 *
 * Each segment contributes a set of FILTER-ed aggregates rather than its own
 * query, so the whole overview is one scan regardless of how many segments the
 * product grows.
 */
export async function getMarketOverview(
  warehouse: Warehouse,
  jurisdictionId: string,
  taxYear: number,
): Promise<MarketOverview> {
  const segmentAggregates = SEGMENT_KEYS.flatMap((key) => {
    const predicate = SEGMENT_PREDICATES[key];
    const f = `FILTER (WHERE ${predicate})`;
    return [
      `count(*) ${f} AS ${key}__count`,
      `coalesce(sum(latest_assessed_value) ${f}, 0) AS ${key}__value`,
      `coalesce(sum(estimated_annual_tax) ${f}, 0) AS ${key}__tax`,
      `coalesce(sum(estimated_annual_penalty) ${f}, 0) AS ${key}__penalty`,
      `median(latest_assessed_value) ${f} AS ${key}__median_value`,
      `median(estimated_annual_penalty) ${f} AS ${key}__median_penalty`,
    ];
  });

  const sql = /* sql */ `
    WITH ${accountSeriesCte(jurisdictionId, taxYear)}
    SELECT
      count(*)                                                    AS total_accounts,
      count(*) FILTER (WHERE is_taxable)                          AS taxable_accounts,
      count(*) FILTER (WHERE is_exempt)                           AS exempt_accounts,
      count(*) FILTER (WHERE is_taxable AND filed_latest_year)    AS filed_accounts,
      count(*) FILTER (
        WHERE is_taxable AND NOT filing_unknown_latest_year
      )                                                           AS filing_known_accounts,
      coalesce(sum(latest_assessed_value), 0)                     AS total_assessed_value,
      any_value(blended_tax_rate)                                 AS blended_tax_rate,
      any_value(exemption_threshold)                              AS exemption_threshold,
      ${segmentAggregates.join(',\n      ')}
    FROM series;
  `;

  const row = await warehouse.queryOne<Record<string, unknown>>(sql);

  const taxableAccounts = num(row?.taxable_accounts);
  const filingKnown = num(row?.filing_known_accounts);
  const filedAccounts = num(row?.filed_accounts);

  const segments: SegmentMetric[] = SEGMENT_KEYS.map((key: SegmentKey) => {
    const count = num(row?.[`${key}__count`]);
    return {
      segment: key,
      accountCount: count,
      totalAssessedValue: num(row?.[`${key}__value`]),
      estimatedTax: num(row?.[`${key}__tax`]),
      estimatedAnnualPenalty: num(row?.[`${key}__penalty`]),
      medianAssessedValue: numOrNull(row?.[`${key}__median_value`]),
      medianAnnualPenalty: numOrNull(row?.[`${key}__median_penalty`]),
      shareOfTaxable: taxableAccounts > 0 ? count / taxableAccounts : null,
    };
  });

  return {
    jurisdictionId,
    taxYear,
    blendedTaxRate: num(row?.blended_tax_rate),
    exemptionThreshold: num(row?.exemption_threshold),
    totalAccounts: num(row?.total_accounts),
    taxableAccounts,
    exemptAccounts: num(row?.exempt_accounts),
    // Only accounts whose filing status the source actually publishes count
    // toward the rate; otherwise a missing column would read as 0% filing.
    filingRate: filingKnown > 0 ? filedAccounts / filingKnown : null,
    totalAssessedValue: num(row?.total_assessed_value),
    segments,
  };
}
