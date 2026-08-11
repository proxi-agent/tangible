import { listOwners } from '@tangible/analytics';
import {
  OwnerSortFieldSchema,
  SegmentKeySchema,
  SortDirectionSchema,
  type SegmentKey,
} from '@tangible/types';
import { handle, params, toArray } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Accounts rolled up by normalized owner. A business with twelve locations
 * carries twelve penalties, so the entity is the unit worth contacting.
 */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const raw = params(request);
    const segments = toArray(raw.segments)
      .map((s) => SegmentKeySchema.safeParse(s))
      .filter((r) => r.success)
      .map((r) => r.data as SegmentKey);

    return listOwners(await getWarehouse(), {
      jurisdictionId: String(raw.jurisdictionId),
      taxYear: Number(raw.taxYear),
      segments,
      minAccounts: raw.minAccounts ? Number(raw.minAccounts) : 2,
      search: raw.search ? String(raw.search) : undefined,
      // An unrecognized sort falls back to the default rather than 400ing: a
      // stale bookmark should still render the list, just not in the order it
      // asked for.
      sortBy: OwnerSortFieldSchema.safeParse(raw.sortBy).data,
      sortDir: SortDirectionSchema.safeParse(raw.sortDir).data,
      limit: Math.min(Number(raw.limit ?? 50), 500),
      offset: Number(raw.offset ?? 0),
    });
  });
}
