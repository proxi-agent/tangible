import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  ClassificationQuerySchema,
  type ClassificationQueueItem,
  type Paginated,
} from '@tangible/types';
import { assetDto, assetGraphColumns, engagementAssetsWhere } from '@/lib/asset-graph';
import { handle, params as queryParams } from '@/lib/route';
import { classificationDto } from '@/lib/classification';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const v = schema.assetVersions;
const c = schema.assetClassifications;

/**
 * The review queue.
 *
 * Ordered by what it costs to be wrong: the most expensive unreviewed asset
 * first. A reviewer who only has ten minutes should spend them on the $180,000
 * line the model was unsure about, not on the $40 chair that happened to sort
 * first alphabetically.
 *
 * Scoped by the engagement's own register rather than by the classification's
 * `engagement_id`. A decision made last season belongs to the asset, not to the
 * season — an asset carried into this year's register with a decision from last
 * year's would otherwise be missing from this queue entirely, which is the
 * failure mode where a reviewer signs a form they never actually reviewed.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<Paginated<ClassificationQueueItem>> => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);
    const query = ClassificationQuerySchema.parse(queryParams(request));

    const conditions: SQL[] = [engagementAssetsWhere(engagementId)!];
    if (query.status) conditions.push(eq(c.status, query.status));
    if (query.source) conditions.push(eq(c.source, query.source));
    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        or(ilike(v.description, term), ilike(v.category, term), ilike(v.assetTag, term))!,
      );
    }
    const where = and(...conditions);

    const db = requireDb();
    const [[count], rows] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(v)
        .innerJoin(c, eq(c.assetId, v.assetId))
        .where(where),
      db
        .select({
          classification: c,
          asset: assetGraphColumns(),
          // How many other rows on this register carry the same description.
          // Settling one settles all of them, and a reviewer deserves to know
          // that before deciding how hard to think about it.
          siblingCount: sql<number>`(
            select count(*)::int - 1
              from asset_classifications sib
              join asset_versions sv
                on sv.asset_id = sib.asset_id
               and sv.engagement_id = ${engagementId}
               and sv.is_current
             where sib.fingerprint is not null
               and sib.fingerprint = ${c.fingerprint}
          )`,
        })
        .from(v)
        .innerJoin(schema.assets, eq(schema.assets.id, v.assetId))
        .innerJoin(c, eq(c.assetId, v.assetId))
        .where(where)
        .orderBy(
          desc(sql`coalesce(${v.originalCost}, 0)`),
          asc(v.sourceSheet),
          asc(v.sourceRow),
          asc(c.id),
        )
        .limit(query.limit)
        .offset(query.offset),
    ]);

    return {
      items: rows.map((row) => ({
        classification: classificationDto(row.classification),
        asset: assetDto(row.asset),
        siblingCount: Math.max(0, row.siblingCount ?? 0),
      })),
      total: count?.total ?? 0,
      limit: query.limit,
      offset: query.offset,
    };
  });
}
