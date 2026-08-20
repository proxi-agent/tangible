import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  ClassificationQuerySchema,
  type ClassificationQueueItem,
  type Paginated,
} from '@tangible/types';
import { handle, params as queryParams } from '@/lib/route';
import { classificationDto } from '@/lib/classification';
import { assetDto, fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The review queue.
 *
 * Ordered by what it costs to be wrong: the most expensive unreviewed asset
 * first. A reviewer who only has ten minutes should spend them on the $180,000
 * line the model was unsure about, not on the $40 chair that happened to sort
 * first alphabetically.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<Paginated<ClassificationQueueItem>> => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);
    const query = ClassificationQuerySchema.parse(queryParams(request));

    const conditions: SQL[] = [eq(schema.assetClassifications.engagementId, engagementId)];
    if (query.status) conditions.push(eq(schema.assetClassifications.status, query.status));
    if (query.source) conditions.push(eq(schema.assetClassifications.source, query.source));
    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        or(
          ilike(schema.assets.description, term),
          ilike(schema.assets.category, term),
          ilike(schema.assets.assetTag, term),
        )!,
      );
    }
    const where = and(...conditions);

    const db = requireDb();
    const [[count], rows] = await Promise.all([
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(schema.assetClassifications)
        .innerJoin(schema.assets, eq(schema.assets.id, schema.assetClassifications.assetId))
        .where(where),
      db
        .select({
          classification: schema.assetClassifications,
          asset: schema.assets,
          // How many other rows in this engagement carry the same description.
          // Settling one settles all of them, and a reviewer deserves to know
          // that before deciding how hard to think about it.
          siblingCount: sql<number>`(
            select count(*)::int - 1 from asset_classifications sib
            where sib.engagement_id = ${engagementId}
              and sib.fingerprint is not null
              and sib.fingerprint = ${schema.assetClassifications.fingerprint}
          )`,
        })
        .from(schema.assetClassifications)
        .innerJoin(schema.assets, eq(schema.assets.id, schema.assetClassifications.assetId))
        .where(where)
        .orderBy(
          desc(sql`coalesce(${schema.assets.originalCost}, 0)`),
          asc(schema.assets.sourceSheet),
          asc(schema.assets.sourceRow),
          asc(schema.assetClassifications.id),
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
