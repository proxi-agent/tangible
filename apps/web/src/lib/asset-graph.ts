import 'server-only';
import { and, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import type { AssetDraft } from '@tangible/far';
import { reconcile, type PriorAsset } from '@tangible/graph';
import type { AssetVersionRow } from '@tangible/db';
import type { Asset, FarMapping } from '@tangible/types';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Writing an import into the asset graph.
 *
 * The old confirm path deleted every asset row for a file and inserted a fresh
 * set. This one compares instead: the same register uploaded twice produces one
 * set of assets and a list of what moved, and re-confirming with a corrected
 * mapping costs the client's classification work nothing, because the assets it
 * was done against are still the same rows.
 *
 * Everything that decides *what changed* lives in @tangible/graph and is pure.
 * This file only knows how to read the prior state and write the plan down.
 */

/** Fields a version carries, in one place so the three writers cannot drift. */
function versionValues(draft: AssetDraft) {
  return {
    sourceSheet: draft.sourceSheet,
    sourceRow: draft.sourceRow,
    assetTag: draft.assetTag,
    description: draft.description,
    category: draft.category,
    glAccount: draft.glAccount,
    acquisitionDate: draft.acquisitionDate,
    acquisitionYear: draft.acquisitionYear,
    inServiceDate: draft.inServiceDate,
    originalCost: draft.originalCost,
    accumulatedDepreciation: draft.accumulatedDepreciation,
    netBookValue: draft.netBookValue,
    quantity: draft.quantity,
    serialNumber: draft.serialNumber,
    entity: draft.entity,
    location: draft.location,
    department: draft.department,
    vendor: draft.vendor,
    usefulLife: draft.usefulLife,
    depreciationMethod: draft.depreciationMethod,
    disposalDate: draft.disposalDate,
    disposalIndicator: draft.disposalIndicator,
    isDisposed: draft.isDisposed,
    warnings: draft.warnings,
    raw: draft.raw,
  };
}

/**
 * Everything the client's graph already holds, as the reconciler wants it.
 *
 * Scoped to the client rather than the engagement, because that is the whole
 * point: an asset carried from the 2027 register into the 2028 one is one asset
 * with a history, not two rows that happen to describe the same forklift.
 */
async function loadPriorAssets(
  clientId: string,
): Promise<{ priors: PriorAsset[]; taxYearById: Map<string, number> }> {
  const db = requireDb();
  const v = schema.assetVersions;
  const rows = await db
    .select({
      id: schema.assets.id,
      naturalKey: schema.assets.naturalKey,
      ordinal: schema.assets.ordinal,
      isAbsent: schema.assets.isAbsent,
      currentTaxYear: schema.assets.currentTaxYear,
      isDisposed: v.isDisposed,
      description: v.description,
      category: v.category,
      glAccount: v.glAccount,
      entity: v.entity,
      location: v.location,
      department: v.department,
      serialNumber: v.serialNumber,
      originalCost: v.originalCost,
      quantity: v.quantity,
      acquisitionDate: v.acquisitionDate,
      acquisitionYear: v.acquisitionYear,
      inServiceDate: v.inServiceDate,
      usefulLife: v.usefulLife,
      depreciationMethod: v.depreciationMethod,
      accumulatedDepreciation: v.accumulatedDepreciation,
      netBookValue: v.netBookValue,
    })
    .from(schema.assets)
    .leftJoin(v, eq(v.id, schema.assets.currentVersionId))
    .where(eq(schema.assets.clientId, clientId));

  const taxYearById = new Map<string, number>();
  const priors = rows.map((row) => {
    taxYearById.set(row.id, row.currentTaxYear);
    const { id, naturalKey, ordinal, isAbsent, isDisposed, currentTaxYear: _y, ...values } = row;
    return {
      id,
      naturalKey,
      ordinal,
      isAbsent,
      isDisposed: isDisposed ?? false,
      values,
    } satisfies PriorAsset;
  });

  return { priors, taxYearById };
}

export interface ApplyBatchInput {
  engagementId: string;
  clientId: string;
  taxYear: number;
  farFileId: string;
  mapping: FarMapping;
  drafts: AssetDraft[];
  skippedCount: number;
  actor: string | null;
}

export interface ApplyBatchResult {
  batchId: string;
  assetCount: number;
  newCount: number;
  matchedCount: number;
  absentCount: number;
  changedCount: number;
}

export async function applyImportBatch(input: ApplyBatchInput): Promise<ApplyBatchResult> {
  const db = requireDb();
  const { priors, taxYearById } = await loadPriorAssets(input.clientId);
  const plan = reconcile({ priorAssets: priors, drafts: input.drafts });

  /**
   * An asset whose newest register is a later year than this one is not absent
   * for failing to appear here — it was never going to. Re-confirming an old
   * file must not retire assets the client only ever reported in a newer one.
   */
  const staleAbsences = plan.absent
    .filter((a) => (taxYearById.get(a.id) ?? input.taxYear) <= input.taxYear)
    .map((a) => a.id);
  const suppressed = new Set(
    plan.absent.map((a) => a.id).filter((id) => !staleAbsences.includes(id)),
  );

  return db.transaction(async (tx) => {
    // Serialize confirms of the same file. Two overlapping requests would each
    // reconcile against the same prior state and then both write a full batch.
    await tx.execute(sql`select id from far_files where id = ${input.farFileId} for update`);

    const [batch] = await tx
      .insert(schema.importBatches)
      .values({
        engagementId: input.engagementId,
        farFileId: input.farFileId,
        status: 'pending',
        mapping: input.mapping,
        assetCount: plan.counts.total,
        newCount: plan.counts.new,
        matchedCount: plan.counts.matched,
        absentCount: staleAbsences.length,
        changedCount: plan.counts.changed,
        skippedCount: input.skippedCount,
        createdBy: input.actor,
      })
      .returning({ id: schema.importBatches.id });
    if (!batch) throw new Error('failed to open an import batch');
    const batchId = batch.id;

    // Earlier batches for this same file are corrections, not history worth
    // presenting as current — their versions stay readable, they just stop
    // being what the engagement reads.
    const superseded = await tx
      .update(schema.importBatches)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(schema.importBatches.farFileId, input.farFileId),
          eq(schema.importBatches.status, 'applied'),
        ),
      )
      .returning({ id: schema.importBatches.id });
    if (superseded.length > 0) {
      await tx
        .update(schema.assetVersions)
        .set({ isCurrent: false })
        .where(
          inArray(
            schema.assetVersions.batchId,
            superseded.map((b) => b.id),
          ),
        );
    }

    // 1. Mint durable assets for the discoveries, so every resolution has an id.
    const assetIdByDraftIndex = new Map<number, string>();
    const discoveries = plan.resolutions.filter((r) => r.assetId === null);
    if (discoveries.length > 0) {
      const inserted = await tx
        .insert(schema.assets)
        .values(
          discoveries.map((r) => ({
            clientId: input.clientId,
            naturalKey: r.naturalKey,
            ordinal: r.ordinal,
            matchMethod: r.matchMethod,
            firstSeenBatchId: batchId,
            lastSeenBatchId: batchId,
            currentTaxYear: input.taxYear,
          })),
        )
        .returning({ id: schema.assets.id });
      discoveries.forEach((r, i) => {
        const id = inserted[i]?.id;
        if (id) assetIdByDraftIndex.set(r.draftIndex, id);
      });
    }
    for (const r of plan.resolutions) {
      if (r.assetId) assetIdByDraftIndex.set(r.draftIndex, r.assetId);
    }

    // 2. One version per row, whether the asset is new or carried forward.
    const versionIdByAssetId = new Map<string, string>();
    if (plan.resolutions.length > 0) {
      const versions = await tx
        .insert(schema.assetVersions)
        .values(
          plan.resolutions.map((r) => ({
            assetId: assetIdByDraftIndex.get(r.draftIndex)!,
            batchId,
            engagementId: input.engagementId,
            farFileId: input.farFileId,
            isCurrent: true,
            ...versionValues(r.draft),
          })),
        )
        .returning({ id: schema.assetVersions.id, assetId: schema.assetVersions.assetId });
      for (const row of versions) versionIdByAssetId.set(row.assetId, row.id);
    }

    // 2b. One current version per asset per engagement. An engagement can carry
    //     two files — a register per site is normal — and if the same asset is
    //     listed in both, the later import is the truth. Without this the asset
    //     is counted twice in every stat and valued twice in the report, which
    //     is exactly the double-count the old delete-and-replace also had and
    //     nobody could see.
    const touched = [
      ...new Set(plan.resolutions.map((r) => assetIdByDraftIndex.get(r.draftIndex))),
    ].filter((id): id is string => Boolean(id));
    if (touched.length > 0) {
      await tx
        .update(schema.assetVersions)
        .set({ isCurrent: false })
        .where(
          and(
            eq(schema.assetVersions.engagementId, input.engagementId),
            eq(schema.assetVersions.isCurrent, true),
            ne(schema.assetVersions.batchId, batchId),
            inArray(schema.assetVersions.assetId, touched),
          ),
        );
    }

    // 3. Point each asset at what this batch says, unless what it already knows
    //    is newer. An asset seen here is by definition no longer absent.
    for (const r of plan.resolutions) {
      const assetId = assetIdByDraftIndex.get(r.draftIndex);
      if (!assetId) continue;
      const versionId = versionIdByAssetId.get(assetId);
      const known = taxYearById.get(assetId);
      const advances = known === undefined || input.taxYear >= known;

      await tx
        .update(schema.assets)
        .set(
          advances
            ? {
                matchMethod: r.matchMethod,
                lastSeenBatchId: batchId,
                currentVersionId: versionId ?? null,
                currentTaxYear: input.taxYear,
                isAbsent: false,
                updatedAt: new Date(),
              }
            : { isAbsent: false, updatedAt: new Date() },
        )
        .where(eq(schema.assets.id, assetId));
    }

    // 4. Assets this register did not mention.
    if (staleAbsences.length > 0) {
      await tx
        .update(schema.assets)
        .set({ isAbsent: true, updatedAt: new Date() })
        .where(inArray(schema.assets.id, staleAbsences));
    }

    // 5. The history. Discoveries carry a draft index rather than an id,
    //    because the id did not exist when the plan was made.
    const events = plan.events
      .filter((e) => !(e.assetId && suppressed.has(e.assetId)))
      .map((e) => {
        const assetId =
          e.assetId ??
          (e.draftIndex === null ? null : (assetIdByDraftIndex.get(e.draftIndex) ?? null));
        return assetId
          ? {
              assetId,
              batchId,
              kind: e.kind,
              field: e.field,
              previousValue: e.previousValue,
              value: e.value,
              significance: e.significance,
              summary: e.summary,
              actor: input.actor,
            }
          : null;
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (events.length > 0) {
      const EVENT_CHUNK = 500;
      for (let i = 0; i < events.length; i += EVENT_CHUNK) {
        await tx.insert(schema.assetEvents).values(events.slice(i, i + EVENT_CHUNK));
      }
    }

    await tx
      .update(schema.importBatches)
      .set({ status: 'applied', appliedAt: new Date() })
      .where(eq(schema.importBatches.id, batchId));

    return {
      batchId,
      assetCount: plan.counts.total,
      newCount: plan.counts.new,
      matchedCount: plan.counts.matched,
      absentCount: staleAbsences.length,
      changedCount: plan.counts.changed,
    };
  });
}

/**
 * The assets an engagement is working on: the current version of each row in its
 * latest applied batch, joined to the durable asset behind it.
 *
 * Every engagement-scoped read goes through this rather than touching either
 * table, so the shape stays the one consumers already know. The one thing that
 * moved is `id`: it is the durable asset, which is what classifications,
 * findings and positions hang off, while `versionId` names the snapshot the
 * values came from.
 */
export function assetGraphColumns() {
  return {
    ...getTableColumns(schema.assetVersions),
    matchMethod: schema.assets.matchMethod,
    isAbsent: schema.assets.isAbsent,
    jurisdictionId: schema.assets.jurisdictionId,
  };
}

export type AssetGraphRow = AssetVersionRow & {
  matchMethod: string;
  isAbsent: boolean;
  jurisdictionId: string | null;
};

/** The join. Chain `.where(engagementAssetsWhere(id))` onto it. */
export function assetGraphFrom() {
  return requireDb()
    .select(assetGraphColumns())
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId));
}

/** Current rows for one engagement. The predicate every read starts from. */
export function engagementAssetsWhere(engagementId: string) {
  return and(
    eq(schema.assetVersions.engagementId, engagementId),
    eq(schema.assetVersions.isCurrent, true),
  );
}

export function assetDto(row: AssetGraphRow): Asset {
  return {
    // The durable asset, not the snapshot — this is the id everything else keys on.
    id: row.assetId,
    versionId: row.id,
    engagementId: row.engagementId,
    farFileId: row.farFileId,
    batchId: row.batchId,
    sourceSheet: row.sourceSheet,
    sourceRow: row.sourceRow,
    assetTag: row.assetTag,
    description: row.description,
    category: row.category,
    glAccount: row.glAccount,
    acquisitionDate: row.acquisitionDate,
    acquisitionYear: row.acquisitionYear,
    inServiceDate: row.inServiceDate,
    originalCost: row.originalCost,
    accumulatedDepreciation: row.accumulatedDepreciation,
    netBookValue: row.netBookValue,
    quantity: row.quantity,
    serialNumber: row.serialNumber,
    entity: row.entity,
    location: row.location,
    department: row.department,
    vendor: row.vendor,
    usefulLife: row.usefulLife,
    depreciationMethod: row.depreciationMethod,
    disposalDate: row.disposalDate,
    disposalIndicator: row.disposalIndicator,
    isDisposed: row.isDisposed,
    warnings: (row.warnings as string[] | null) ?? [],
    matchMethod: row.matchMethod,
    isAbsent: row.isAbsent,
    jurisdictionId: row.jurisdictionId,
  };
}
