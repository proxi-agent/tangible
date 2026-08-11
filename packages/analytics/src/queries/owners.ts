import type {
  OwnerRollup,
  OwnerSortField,
  Paginated,
  SegmentKey,
  SortDirection,
} from '@tangible/types';
import { segmentsPredicate } from '../predicates.js';
import { accountSeriesCte } from '../series.js';
import { and, bool, lit, num } from '../sql.js';
import type { Warehouse } from '../warehouse.js';

export interface OwnerQuery {
  jurisdictionId: string;
  taxYear: number;
  segments: SegmentKey[];
  /** Only entities holding at least this many accounts — the roll-up targets. */
  minAccounts: number;
  search?: string;
  sortBy?: OwnerSortField;
  sortDir?: SortDirection;
  limit: number;
  offset: number;
}

/**
 * Sortable fields mapped to their SQL. Sorting happens here rather than in the
 * browser because a page is 50 rows out of thousands — sorting what was
 * delivered would reorder a page and look like it reordered the result.
 */
const OWNER_SORT_SQL: Readonly<Record<OwnerSortField, string>> = {
  estimatedAnnualPenalty: 'estimated_annual_penalty',
  totalAssessedValue: 'total_assessed_value',
  accountCount: 'account_count',
  unfiledAccountCount: 'unfiled_account_count',
  ownerName: 'owner_name',
};

/**
 * Accounts grouped by normalized owner. A single business often holds many
 * accounts (one per location), and the penalty stacks per account, so the
 * entity — not the account — is what an outbound campaign actually targets.
 */
export async function listOwners(
  warehouse: Warehouse,
  query: OwnerQuery,
): Promise<Paginated<OwnerRollup>> {
  const where = and(
    segmentsPredicate(query.segments),
    'owner_key IS NOT NULL',
    "trim(owner_key) <> ''",
    query.search ? `owner_name ILIKE ${lit(`%${query.search}%`)}` : null,
  );

  const sql = /* sql */ `
    WITH ${accountSeriesCte(query.jurisdictionId, query.taxYear, warehouse.materializedSeries)},
    filtered AS (SELECT * FROM series WHERE ${where}),
    grouped AS (
      SELECT
        jurisdiction_id,
        owner_key,
        -- Accounts are grouped by normalized owner_key, so the display name has
        -- to be chosen from several spellings of the same business — "DEMONTROND
        -- BUICK CO" and "DEMONTROND BUICK COMPANY". any_value() returned whichever
        -- the scan reached first, so the name changed between runs. max() is
        -- deterministic, and in practice picks the fuller spelling.
        max(owner_name)                                                AS owner_name,
        count(*)                                                       AS account_count,
        count(*) FILTER (WHERE NOT filed_latest_year
                           AND NOT filing_unknown_latest_year)          AS unfiled_account_count,
        count(*) FILTER (WHERE is_frozen)                              AS frozen_account_count,
        coalesce(sum(latest_assessed_value), 0)                        AS total_assessed_value,
        coalesce(sum(latest_assessed_value) FILTER (
          WHERE NOT filed_latest_year AND NOT filing_unknown_latest_year
        ), 0)                                                          AS unfiled_assessed_value,
        coalesce(sum(estimated_annual_tax), 0)                         AS estimated_annual_tax,
        coalesce(sum(estimated_annual_penalty), 0)                     AS estimated_annual_penalty,
        -- Joined into a string rather than returned as a LIST: the DuckDB client
        -- hands back a wrapper object for list columns, and a delimited string
        -- crosses the boundary as a plain value.
        array_to_string(list(DISTINCT site_city)
          FILTER (WHERE site_city IS NOT NULL), '|')                   AS cities,
        array_to_string(list(DISTINCT state_class)
          FILTER (WHERE state_class IS NOT NULL), '|')                 AS state_classes,
        bool_or(has_agent)                                             AS has_agent
      FROM filtered
      GROUP BY 1, 2
      HAVING count(*) >= ${lit(query.minAccounts)}
    )
    SELECT *, count(*) OVER () AS total_count
    FROM grouped
    -- owner_key breaks the remaining ties. This list is paginated, and an order
    -- that is not total lets rows shift between pages — the same owner appearing
    -- twice, or none.
    ORDER BY ${OWNER_SORT_SQL[query.sortBy ?? 'estimatedAnnualPenalty']} ${
      query.sortDir === 'asc' ? 'ASC' : 'DESC'
    } NULLS LAST, total_assessed_value DESC, owner_key ASC
    LIMIT ${lit(query.limit)} OFFSET ${lit(query.offset)};
  `;

  const rows = await warehouse.query<Record<string, unknown>>(sql);

  const items: OwnerRollup[] = rows.map((row) => ({
    jurisdictionId: String(row.jurisdiction_id),
    ownerKey: String(row.owner_key),
    ownerName: String(row.owner_name ?? row.owner_key),
    accountCount: num(row.account_count),
    unfiledAccountCount: num(row.unfiled_account_count),
    frozenAccountCount: num(row.frozen_account_count),
    totalAssessedValue: num(row.total_assessed_value),
    unfiledAssessedValue: num(row.unfiled_assessed_value),
    estimatedAnnualTax: num(row.estimated_annual_tax),
    estimatedAnnualPenalty: num(row.estimated_annual_penalty),
    cities: splitList(row.cities),
    stateClasses: splitList(row.state_classes),
    hasAgent: bool(row.has_agent),
  }));

  return {
    items,
    total: rows.length ? num(rows[0]?.total_count) : 0,
    limit: query.limit,
    offset: query.offset,
  };
}

function splitList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean)
    .sort();
}
