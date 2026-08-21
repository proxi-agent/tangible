import 'server-only';
import { desc, eq, inArray } from 'drizzle-orm';
import { carryForward, type CarriedAsset, type CarryForward, type PriorReturn } from '@tangible/filing';
import { assetGraphColumns, assetGraphFrom, engagementAssetsWhere } from '@/lib/asset-graph';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * This season's register against last season's returns.
 *
 * The filing record has only ever been written. This is the read: the reason
 * `rendition_filings.asset_ids` is stored at all, and the reason its index is
 * on (location, year, status) rather than on the engagement.
 *
 * Prior returns are found through the *client*, not the engagement. One
 * engagement is one tax year, so a client's 2026 returns hang off a different
 * engagement row than the 2027 work in front of you — reading by engagement id
 * would find nothing every time and quietly report a first season forever.
 */
export async function engagementCarryForward(engagementId: string): Promise<CarryForward> {
  const db = requireDb();
  const { engagement } = await fetchEngagement(engagementId);

  const [filings, register] = await Promise.all([
    db
      .select({
        locationId: schema.renditionFilings.locationId,
        locationLabel: schema.renditionFilings.locationLabel,
        accountId: schema.renditionFilings.accountId,
        taxYear: schema.renditionFilings.taxYear,
        status: schema.renditionFilings.status,
        filedOn: schema.renditionFilings.filedOn,
        assetIds: schema.renditionFilings.assetIds,
        assetCount: schema.renditionFilings.assetCount,
        totalHistoricalCost: schema.renditionFilings.totalHistoricalCost,
      })
      .from(schema.renditionFilings)
      .innerJoin(schema.engagements, eq(schema.engagements.id, schema.renditionFilings.engagementId))
      .where(eq(schema.engagements.clientId, engagement.clientId))
      .orderBy(desc(schema.renditionFilings.taxYear)),
    assetGraphFrom().where(engagementAssetsWhere(engagementId)),
  ]);

  const returns: PriorReturn[] = filings.map((row) => ({
    ...row,
    // jsonb, so the column type is `unknown` — a filing recorded by this app
    // always writes an array of ids, and anything else is not one we can read.
    assetIds: Array.isArray(row.assetIds) ? (row.assetIds as string[]) : [],
  }));

  const current: CarriedAsset[] = register.map((row) => ({
    id: row.assetId,
    assetTag: row.assetTag,
    description: row.description,
    acquisitionYear: row.acquisitionYear,
    originalCost: row.originalCost,
    isDisposed: row.isDisposed,
    disposalDate: row.disposalDate,
  }));

  return carryForward({
    taxYear: engagement.taxYear,
    returns,
    register: current,
    absent: await lastSeen(returns, engagement.taxYear, new Set(current.map((one) => one.id))),
  });
}

/**
 * What the graph last knew about property this year's register does not carry.
 *
 * A filing freezes asset ids and nothing else about them, so without this the
 * dropped property could be counted and not named — a card reporting "4 assets
 * on last year's return are gone" with four blank rows under it. The versions
 * are still there: an asset is durable and its versions are not deleted when a
 * later register stops mentioning it, which is the whole point of the graph.
 */
async function lastSeen(
  returns: PriorReturn[],
  taxYear: number,
  onRegister: Set<string>,
): Promise<CarriedAsset[]> {
  const wanted = [
    ...new Set(
      returns
        .filter((one) => one.status === 'filed' && one.taxYear < taxYear)
        .flatMap((one) => one.assetIds),
    ),
  ].filter((id) => !onRegister.has(id));
  if (wanted.length === 0) return [];

  // Newest first, then first-wins per asset. Ordering in SQL and reducing here
  // rather than a DISTINCT ON: the list is bounded by what was on a return, and
  // this keeps the query one the (asset_id, created_at) index serves directly.
  const rows = await requireDb()
    .select(assetGraphColumns())
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .where(inArray(schema.assetVersions.assetId, wanted))
    .orderBy(desc(schema.assetVersions.createdAt));

  const seen = new Map<string, CarriedAsset>();
  for (const row of rows) {
    if (seen.has(row.assetId)) continue;
    seen.set(row.assetId, {
      id: row.assetId,
      assetTag: row.assetTag,
      description: row.description,
      acquisitionYear: row.acquisitionYear,
      originalCost: row.originalCost,
      isDisposed: row.isDisposed,
      disposalDate: row.disposalDate,
    });
  }
  return [...seen.values()];
}
