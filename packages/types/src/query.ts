import { z } from 'zod';
import { SegmentKeySchema } from './segments.js';

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export const SortDirectionSchema = z.enum(SORT_DIRECTIONS);
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const ACCOUNT_SORT_FIELDS = [
  'latestAssessedValue',
  'estimatedAnnualPenalty',
  'estimatedLifetimePenalty',
  'yearsUnfiled',
  'yearsOnRoll',
  'ownerName',
] as const;

export const AccountSortFieldSchema = z.enum(ACCOUNT_SORT_FIELDS);
export type AccountSortField = (typeof ACCOUNT_SORT_FIELDS)[number];

/**
 * Sortable columns on the owner rollup.
 *
 * Enumerated rather than accepting a column name, because the value reaches an
 * ORDER BY clause. A closed set is also what lets the table header offer sorting
 * only where the server can actually deliver it.
 */
export const OWNER_SORT_FIELDS = [
  'estimatedAnnualPenalty',
  'totalAssessedValue',
  'accountCount',
  'unfiledAccountCount',
  'ownerName',
] as const;

export const OwnerSortFieldSchema = z.enum(OWNER_SORT_FIELDS);
export type OwnerSortField = (typeof OWNER_SORT_FIELDS)[number];

/**
 * The one filter object every account-facing endpoint accepts. The web app
 * builds it from URL search params, so a filtered view is always shareable.
 */
export const AccountQuerySchema = z.object({
  jurisdictionId: z.string(),
  taxYear: z.coerce.number().int(),
  /** Accounts must belong to every segment listed (AND, not OR). */
  segments: z.array(SegmentKeySchema).default([]),
  search: z.string().trim().min(1).max(120).optional(),
  cities: z.array(z.string()).default([]),
  stateClasses: z.array(z.string()).default([]),
  minValue: z.coerce.number().nonnegative().optional(),
  maxValue: z.coerce.number().nonnegative().optional(),
  minYearsUnfiled: z.coerce.number().int().nonnegative().optional(),
  hasAgent: z.coerce.boolean().optional(),
  includeExempt: z.coerce.boolean().default(false),
  sortBy: AccountSortFieldSchema.default('estimatedAnnualPenalty'),
  sortDir: SortDirectionSchema.default('desc'),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type AccountQuery = z.infer<typeof AccountQuerySchema>;

export function paginatedSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    limit: z.number().int(),
    offset: z.number().int(),
  });
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Filter options derived from the loaded data, used to populate the UI controls. */
export const FilterFacetsSchema = z.object({
  jurisdictionId: z.string(),
  taxYear: z.number().int(),
  cities: z.array(z.object({ value: z.string(), count: z.number().int() })),
  stateClasses: z.array(
    z.object({ value: z.string(), label: z.string(), count: z.number().int() }),
  ),
  valueRange: z.object({ min: z.number(), max: z.number() }),
});

export type FilterFacets = z.infer<typeof FilterFacetsSchema>;
