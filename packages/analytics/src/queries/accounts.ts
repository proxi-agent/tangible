import {
  SEGMENT_KEYS,
  type AccountQuery,
  type AccountSeries,
  type AccountYearPoint,
  type FilterFacets,
  type Paginated,
  type SegmentKey,
} from '@tangible/types';
import { SEGMENT_PREDICATES, segmentsPredicate } from '../predicates.js';
import { accountSeriesCte } from '../series.js';
import { and, bool, lit, litList, num, numOrNull, str } from '../sql.js';
import type { Warehouse } from '../warehouse.js';

const SORT_COLUMNS: Record<AccountQuery['sortBy'], string> = {
  latestAssessedValue: 'latest_assessed_value',
  estimatedAnnualPenalty: 'estimated_annual_penalty',
  estimatedLifetimePenalty: 'estimated_lifetime_penalty',
  yearsUnfiled: 'years_unfiled',
  yearsOnRoll: 'years_on_roll',
  ownerName: 'owner_name',
};

function filterClause(query: AccountQuery): string {
  return and(
    segmentsPredicate(query.segments),
    query.includeExempt ? null : 'NOT is_exempt',
    query.search
      ? `(owner_name ILIKE ${lit(`%${query.search}%`)} OR account_id ILIKE ${lit(`%${query.search}%`)})`
      : null,
    query.cities.length ? `site_city IN (${litList(query.cities)})` : null,
    query.stateClasses.length ? `state_class IN (${litList(query.stateClasses)})` : null,
    query.minValue !== undefined ? `latest_assessed_value >= ${lit(query.minValue)}` : null,
    query.maxValue !== undefined ? `latest_assessed_value <= ${lit(query.maxValue)}` : null,
    query.minYearsUnfiled !== undefined ? `years_unfiled >= ${lit(query.minYearsUnfiled)}` : null,
    query.hasAgent !== undefined ? `has_agent = ${lit(query.hasAgent)}` : null,
  );
}

/** Which segments a given row belongs to, evaluated inline so the UI can badge it. */
function segmentFlagsSql(): string {
  return SEGMENT_KEYS.map((key) => `(${SEGMENT_PREDICATES[key]}) AS seg__${key}`).join(',\n      ');
}

function rowToSeries(row: Record<string, unknown>): AccountSeries {
  const segments = SEGMENT_KEYS.filter((key: SegmentKey) => bool(row[`seg__${key}`]));
  return {
    jurisdictionId: String(row.jurisdiction_id),
    accountId: String(row.account_id),
    ownerName: str(row.owner_name),
    ownerKey: str(row.owner_key),
    siteCity: str(row.site_city),
    stateClass: str(row.state_class),
    stateClassGroup: str(row.state_class_group),
    hasAgent: bool(row.has_agent),
    isExempt: bool(row.is_exempt),
    latestYear: num(row.latest_year),
    latestAssessedValue: numOrNull(row.latest_assessed_value),
    yearsOnRoll: num(row.years_on_roll),
    yearsUnfiled: num(row.years_unfiled),
    yearsFiledLate: num(row.years_filed_late),
    isFrozen: bool(row.is_frozen),
    neverDeclines: bool(row.never_declines),
    estimatedAnnualTax: numOrNull(row.estimated_annual_tax),
    estimatedAnnualPenalty: numOrNull(row.estimated_annual_penalty),
    estimatedLifetimePenalty: numOrNull(row.estimated_lifetime_penalty),
    segments,
    history: [],
  };
}

export async function listAccounts(
  warehouse: Warehouse,
  query: AccountQuery,
): Promise<Paginated<AccountSeries>> {
  const where = filterClause(query);
  const orderColumn = SORT_COLUMNS[query.sortBy];
  const direction = query.sortDir === 'asc' ? 'ASC' : 'DESC';
  const cte = accountSeriesCte(query.jurisdictionId, query.taxYear);

  const sql = /* sql */ `
    WITH ${cte},
    filtered AS (SELECT * FROM series WHERE ${where})
    SELECT
      *,
      count(*) OVER () AS total_count,
      ${segmentFlagsSql()}
    FROM filtered
    ORDER BY ${orderColumn} ${direction} NULLS LAST, account_id ASC
    LIMIT ${lit(query.limit)} OFFSET ${lit(query.offset)};
  `;

  const rows = await warehouse.query<Record<string, unknown>>(sql);
  const total = rows.length ? num(rows[0]?.total_count) : await countAccounts(warehouse, query);

  return {
    items: rows.map(rowToSeries),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

/** Used when a page comes back empty (offset past the end) and the window count is unavailable. */
export async function countAccounts(warehouse: Warehouse, query: AccountQuery): Promise<number> {
  const sql = /* sql */ `
    WITH ${accountSeriesCte(query.jurisdictionId, query.taxYear)}
    SELECT count(*) AS n FROM series WHERE ${filterClause(query)};
  `;
  const row = await warehouse.queryOne<{ n: unknown }>(sql);
  return num(row?.n);
}

/** A single account with its full year-by-year history. */
export async function getAccount(
  warehouse: Warehouse,
  jurisdictionId: string,
  taxYear: number,
  accountId: string,
): Promise<AccountSeries | null> {
  const sql = /* sql */ `
    WITH ${accountSeriesCte(jurisdictionId, taxYear)}
    SELECT *, ${segmentFlagsSql()}
    FROM series
    WHERE account_id = ${lit(accountId)};
  `;
  const row = await warehouse.queryOne<Record<string, unknown>>(sql);
  if (!row) return null;

  const historySql = /* sql */ `
    SELECT
      ay.tax_year,
      ay.assessed_value,
      ay.appraised_value,
      ay.rendition_filed,
      ay.rendition_late,
      ay.assessed_value * j.rate                        AS estimated_tax,
      CASE WHEN ay.rendition_filed = FALSE OR ay.rendition_late = TRUE
           THEN ay.assessed_value * j.rate * coalesce(p.penalty_rate, 0.1)
           ELSE 0 END                                   AS estimated_penalty
    FROM account_year ay
    CROSS JOIN (
      SELECT coalesce(
        (SELECT blended_tax_rate FROM jurisdiction WHERE jurisdiction_id = ${lit(jurisdictionId)}),
        0.025
      ) AS rate
    ) j
    LEFT JOIN tax_policy p ON p.tax_year = ay.tax_year
    WHERE ay.jurisdiction_id = ${lit(jurisdictionId)}
      AND ay.account_id = ${lit(accountId)}
      AND ay.tax_year <= ${lit(taxYear)}
    ORDER BY ay.tax_year ASC;
  `;

  const historyRows = await warehouse.query<Record<string, unknown>>(historySql);
  const history: AccountYearPoint[] = historyRows.map((h) => ({
    taxYear: num(h.tax_year),
    assessedValue: numOrNull(h.assessed_value),
    appraisedValue: numOrNull(h.appraised_value),
    renditionFiled: h.rendition_filed === null ? null : bool(h.rendition_filed),
    renditionLate: h.rendition_late === null ? null : bool(h.rendition_late),
    estimatedTax: numOrNull(h.estimated_tax),
    estimatedPenalty: numOrNull(h.estimated_penalty),
  }));

  return { ...rowToSeries(row), history };
}

/** Distinct filter values present in the data, for populating the UI controls. */
export async function getFilterFacets(
  warehouse: Warehouse,
  jurisdictionId: string,
  taxYear: number,
): Promise<FilterFacets> {
  const cte = accountSeriesCte(jurisdictionId, taxYear);

  const [cities, classes, range] = await Promise.all([
    warehouse.query<Record<string, unknown>>(/* sql */ `
      WITH ${cte}
      SELECT site_city AS value, count(*) AS n
      FROM series
      WHERE site_city IS NOT NULL AND trim(site_city) <> ''
      GROUP BY 1 ORDER BY n DESC LIMIT 200;
    `),
    warehouse.query<Record<string, unknown>>(/* sql */ `
      WITH ${cte}
      SELECT state_class AS value, any_value(state_class_group) AS label, count(*) AS n
      FROM series
      WHERE state_class IS NOT NULL AND trim(state_class) <> ''
      GROUP BY 1 ORDER BY n DESC LIMIT 100;
    `),
    warehouse.queryOne<Record<string, unknown>>(/* sql */ `
      WITH ${cte}
      SELECT
        coalesce(min(latest_assessed_value), 0) AS min_value,
        coalesce(max(latest_assessed_value), 0) AS max_value
      FROM series;
    `),
  ]);

  return {
    jurisdictionId,
    taxYear,
    cities: cities.map((c) => ({ value: String(c.value), count: num(c.n) })),
    stateClasses: classes.map((c) => ({
      value: String(c.value),
      label: str(c.label) ?? 'other',
      count: num(c.n),
    })),
    valueRange: { min: num(range?.min_value), max: num(range?.max_value) },
  };
}
