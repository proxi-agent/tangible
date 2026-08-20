import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { AssetQuerySchema, type Asset, type Paginated } from '@tangible/types';
import { handle, params as queryParams } from '@/lib/route';
import { assetDto, fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Closed sets from the schema, so nothing user-supplied ever reaches ORDER BY raw. */
const SORT_COLUMNS = {
  sourceRow: schema.assets.sourceRow,
  description: schema.assets.description,
  category: schema.assets.category,
  acquisitionYear: schema.assets.acquisitionYear,
  originalCost: schema.assets.originalCost,
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

    const conditions: SQL[] = [eq(schema.assets.engagementId, engagementId)];
    if (query.sheet) conditions.push(eq(schema.assets.sourceSheet, query.sheet));
    if (query.warningsOnly) {
      conditions.push(sql`jsonb_array_length(${schema.assets.warnings}) > 0`);
    }
    if (query.disposedOnly) conditions.push(eq(schema.assets.isDisposed, true));
    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        or(
          ilike(schema.assets.description, term),
          ilike(schema.assets.assetTag, term),
          ilike(schema.assets.category, term),
          ilike(schema.assets.location, term),
          ilike(schema.assets.serialNumber, term),
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
        .from(schema.assets)
        .where(where),
      db
        .select()
        .from(schema.assets)
        .where(where)
        // The id breaks every remaining tie: without a total order, two rows
        // that compare equal can swap between requests and a paged read then
        // shows one twice and skips another.
        .orderBy(
          sql`${column} ${direction} nulls last`,
          schema.assets.sourceSheet,
          schema.assets.sourceRow,
          schema.assets.id,
        )
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
