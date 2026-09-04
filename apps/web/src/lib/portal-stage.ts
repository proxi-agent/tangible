import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { emptyPortalStage, type PortalStage, type PortalStageName } from '@tangible/types';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * How much of the client wing this season has earned.
 *
 * Seven counts, taken in one round of queries, from which the rail decides what
 * to draw. They are counts and not a verdict for a reason given at the type: a
 * business asking why their Returns link is missing should be answerable by
 * reading a number, and `returnsOwed: 0` answers it where `showReturns: false`
 * only restates the question.
 *
 * Everything here is cheap on purpose — indexed equality counts, no report
 * built, no rendition drafted — because the shell asks for it on every portal
 * page load, before the page's own queries have started.
 */
export async function portalStage(engagementId: string): Promise<PortalStage> {
  const db = requireDb();

  const one = async (query: Promise<{ n: number }[]>): Promise<number> => (await query)[0]?.n ?? 0;

  const [documentsReceived, assetsRead, runs, openQuestions, returnsOwed, claimsMade] =
    await Promise.all([
      one(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.intakeFiles)
          .where(eq(schema.intakeFiles.engagementId, engagementId)),
      ),
      one(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.assetVersions)
          .where(engagementAssetsWhere(engagementId)),
      ),
      db
        .select({ status: schema.analysisRuns.status, n: sql<number>`count(*)::int` })
        .from(schema.analysisRuns)
        .where(eq(schema.analysisRuns.engagementId, engagementId))
        .groupBy(schema.analysisRuns.status),
      openAskCount(engagementId),
      /**
       * Sites with property standing on them, which is the unit a return is
       * filed per. Counted off the assets rather than off `client_locations`,
       * because a business can have five addresses on file and one of them
       * holding anything — and it is the second number that decides whether
       * there is a return to talk about.
       */
      one(
        db
          .select({ n: sql<number>`count(distinct ${schema.assets.locationId})::int` })
          .from(schema.assetVersions)
          .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
          .where(
            and(
              engagementAssetsWhere(engagementId),
              eq(schema.assetVersions.isDisposed, false),
              isNotNull(schema.assets.locationId),
            ),
          ),
      ),
      one(
        db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.recoveryClaims)
          .where(eq(schema.recoveryClaims.engagementId, engagementId)),
      ),
    ]);

  const byStatus = new Map(runs.map((row) => [row.status, row.n]));
  const reportPublished = (byStatus.get('published') ?? 0) > 0;
  const runInFlight = (byStatus.get('queued') ?? 0) + (byStatus.get('running') ?? 0) > 0;

  /**
   * Three stages, and the middle one is the load-bearing one. A drop that has
   * landed but produced nothing yet is not the same as no drop at all: the
   * first has a progress card worth watching and a report page that will fill
   * in, and the second has neither. Reading them as one state is what made the
   * empty portal look like a lost upload.
   *
   * A failed run counts as `processing` rather than falling back to
   * `documents`, and deliberately: the report page is where the failure is
   * explained and another file can be sent from, so it must still exist.
   */
  const stage: PortalStageName = reportPublished
    ? 'ready'
    : documentsReceived + assetsRead > 0 || runs.length > 0
      ? 'processing'
      : 'documents';

  return {
    engagementId,
    stage,
    documentsReceived,
    assetsRead,
    reportPublished,
    runInFlight,
    openQuestions,
    returnsOwed,
    claimsMade,
  };
}

/**
 * Questions still waiting on this business.
 *
 * Both kinds, and the awkward shape is the schema's: a finding ask carries the
 * engagement, and a mapping ask carries the file the columns came from. The
 * same union `engagementAsks` takes, counted rather than built.
 */
async function openAskCount(engagementId: string): Promise<number> {
  const db = requireDb();
  const files = await db
    .select({ id: schema.farFiles.id })
    .from(schema.farFiles)
    .where(eq(schema.farFiles.engagementId, engagementId));
  const fileIds = files.map((file) => file.id);

  const [own, mapping] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.mappingAsks)
      .where(
        and(
          eq(schema.mappingAsks.engagementId, engagementId),
          eq(schema.mappingAsks.status, 'open'),
        ),
      ),
    fileIds.length === 0
      ? Promise.resolve([{ n: 0 }])
      : db
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.mappingAsks)
          .where(
            and(
              inArray(schema.mappingAsks.farFileId, fileIds),
              eq(schema.mappingAsks.status, 'open'),
            ),
          ),
  ]);

  return (own[0]?.n ?? 0) + (mapping[0]?.n ?? 0);
}

export { emptyPortalStage };
