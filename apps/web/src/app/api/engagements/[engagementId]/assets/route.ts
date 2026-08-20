import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { AssetQuerySchema, type Asset, type Paginated } from '@tangible/types';
import { assetDto, assetGraphColumns, engagementAssetsWhere } from '@/lib/asset-graph';
import { handle, params as queryParams } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const v = schema.assetVersions;

/** Closed sets from the schema, so nothing user-supplied ever reaches ORDER BY raw. */
const SORT_COLUMNS = {
  sourceRow: v.sourceRow,
  description: v.description,
  category: v.category,
  acquisitionYear: v.acquisitionYear,
  originalCost: v.originalCost,
} as const;

export function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<Paginated<Asset>> => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);

    const raw = queryParams(request);
    const query = AssetQuerySchema.parse({
      ...raw,
      // `z.coerce.boolean()` would treat "false" as true, so map explicitly.
      warningsOnly: raw.warningsOnly === 'true',
      disposedOnly: raw.disposedOnly === 'true',
    });

    const conditions: SQL[] = [engagementAssetsWhere(engagementId)!];
    if (query.sheet) conditions.push(eq(v.sourceSheet, query.sheet));
    if (query.warningsOnly) {
      conditions.push(sql`jsonb_array_length(${v.warnings}) > 0`);
    }
    if (query.disposedOnly) conditions.push(eq(v.isDisposed, true));
    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        or(
          ilike(v.description, term),
          ilike(v.assetTag, term),
          ilike(v.category, term),
          ilike(v.location, term),
          ilike(v.serialNumber, term),
        )!,
      );
    }
    const where = and(...conditions);

    const db = requireDb();
    const column = SORT_COLUMNS[query.sortBy];
    const direction = sql.raw(query.sortDir === 'desc' ? 'desc' : 'asc');

    const [[count], rows] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(v)
        .where(where),
      db
        .select(assetGraphColumns())
        .from(v)
        .innerJoin(schema.assets, eq(schema.assets.id, v.assetId))
        .where(where)
        // The id breaks every remaining tie: without a total order, two rows
        // that compare equal can swap between requests and a paged read then
        // shows one twice and skips another.
        .orderBy(sql`${column} ${direction} nulls last`, v.sourceSheet, v.sourceRow, v.id)
        .limit(query.limit)
        .offset(query.offset),
    ]);

    return {
      items: rows.map(assetDto),
      total: count?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  });
}
