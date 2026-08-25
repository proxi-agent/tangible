import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { classificationLabel, isExclusion, isValuable } from '@tangible/classification';
import { appraisalDistrictName } from '@tangible/filing';
import type {
  AssetAppraisalState,
  AssetProfile,
  AssetProfileClassification,
  ClassificationStatus,
} from '@tangible/types';
import { appraise, scheduleFor, type LifeClass } from '@tangible/valuation';
import { lookupRate } from '@/lib/analysis';
import { assetDto, assetGraphColumns, engagementAssetsWhere, type AssetGraphRow } from '@/lib/asset-graph';
import { handle, notFound } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Everything the graph knows about one asset.
 *
 * The list view shows the current snapshot; this is everything behind it — how
 * the row matched its durable identity, what was decided about it and by which
 * authority, what the district's arithmetic makes of it, which sworn documents
 * it has been on, and every change any import has recorded. All of it is read
 * on demand from the same tables the rest of the app writes, so the page can
 * never disagree with the workspace it drills into.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string; assetId: string }> },
): Promise<Response> {
  return handle(async (): Promise<AssetProfile> => {
    const { engagementId, assetId } = await params;
    const { engagement } = await fetchEngagement(engagementId);
    const db = requireDb();

    // The durable asset, scoped to the engagement's client so one client's
    // asset id can never be read through another client's engagement.
    const [durable] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, assetId), eq(schema.assets.clientId, engagement.clientId)));
    if (!durable) notFound(`No asset ${assetId} for this client`);

    // The snapshot this engagement is working from — same read as the table.
    const [current] = await db
      .select(assetGraphColumns())
      .from(schema.assetVersions)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
      .where(and(engagementAssetsWhere(engagementId), eq(schema.assetVersions.assetId, assetId)));
    if (!current) {
      notFound('This asset is not on the current register of this engagement');
    }
    const asset = assetDto(current as AssetGraphRow);

    const [classificationRows, placementRows, sightingRows, eventRows, versionRows, filingRows, setRows] =
      await Promise.all([
        db
          .select()
          .from(schema.assetClassifications)
          .where(eq(schema.assetClassifications.assetId, assetId)),
        durable.locationId
          ? db
              .select()
              .from(schema.clientLocations)
              .where(eq(schema.clientLocations.id, durable.locationId))
          : Promise.resolve([]),
        db
          .select({
            batchId: schema.importBatches.id,
            appliedAt: schema.importBatches.appliedAt,
            createdAt: schema.importBatches.createdAt,
            fileName: schema.farFiles.originalFilename,
          })
          .from(schema.importBatches)
          .leftJoin(schema.farFiles, eq(schema.farFiles.id, schema.importBatches.farFileId))
          .where(inArray(schema.importBatches.id, [durable.firstSeenBatchId, durable.lastSeenBatchId])),
        db
          .select()
          .from(schema.assetEvents)
          .where(eq(schema.assetEvents.assetId, assetId))
          .orderBy(desc(schema.assetEvents.occurredAt), desc(schema.assetEvents.id)),
        db
          .select({
            versionId: schema.assetVersions.id,
            batchId: schema.assetVersions.batchId,
            engagementId: schema.assetVersions.engagementId,
            isCurrent: schema.assetVersions.isCurrent,
            createdAt: schema.assetVersions.createdAt,
            sourceSheet: schema.assetVersions.sourceSheet,
            sourceRow: schema.assetVersions.sourceRow,
            originalCost: schema.assetVersions.originalCost,
            accumulatedDepreciation: schema.assetVersions.accumulatedDepreciation,
            netBookValue: schema.assetVersions.netBookValue,
            category: schema.assetVersions.category,
            location: schema.assetVersions.location,
            isDisposed: schema.assetVersions.isDisposed,
            batchStatus: schema.importBatches.status,
            fileName: schema.farFiles.originalFilename,
          })
          .from(schema.assetVersions)
          .innerJoin(schema.importBatches, eq(schema.importBatches.id, schema.assetVersions.batchId))
          .leftJoin(schema.farFiles, eq(schema.farFiles.id, schema.assetVersions.farFileId))
          .where(eq(schema.assetVersions.assetId, assetId))
          .orderBy(desc(schema.assetVersions.createdAt), desc(schema.assetVersions.id)),
        // Every filed return that carried this asset, across the client's
        // engagements. Read off the filing record's own asset list — observed
        // at the moment of filing, not reconstructed.
        db
          .select({
            filingId: schema.renditionFilings.id,
            engagementId: schema.renditionFilings.engagementId,
            taxYear: schema.renditionFilings.taxYear,
            jurisdictionId: schema.renditionFilings.jurisdictionId,
            locationLabel: schema.renditionFilings.locationLabel,
            status: schema.renditionFilings.status,
            scheduleValue: schema.renditionFilings.scheduleValue,
            recordedAt: schema.renditionFilings.recordedAt,
          })
          .from(schema.renditionFilings)
          .innerJoin(schema.engagements, eq(schema.engagements.id, schema.renditionFilings.engagementId))
          .where(
            and(
              eq(schema.engagements.clientId, engagement.clientId),
              sql`${schema.renditionFilings.assetIds} @> ${JSON.stringify([assetId])}::jsonb`,
            ),
          )
          .orderBy(desc(schema.renditionFilings.taxYear), desc(schema.renditionFilings.recordedAt)),
        db
          .select({
            id: schema.findingSets.id,
            source: schema.findingSets.source,
            committedAt: schema.findingSets.committedAt,
          })
          .from(schema.findingSets)
          .where(eq(schema.findingSets.engagementId, engagementId))
          .orderBy(desc(schema.findingSets.committedAt)),
      ]);

    // Findings that name this asset, from the latest committed set of each
    // source — the sets the findings tab is working, not every run ever made.
    const latestSets = new Map<string, { id: string; committedAt: Date }>();
    for (const set of setRows) {
      if (!latestSets.has(set.source)) latestSets.set(set.source, set);
    }
    const latestSetIds = [...latestSets.values()].map((s) => s.id);
    const findingRows =
      latestSetIds.length > 0
        ? await db
            .select({
              setId: schema.findings.setId,
              source: schema.findings.source,
              key: schema.findings.key,
              title: schema.findings.title,
              kind: schema.findings.kind,
              effect: schema.findings.effect,
            })
            .from(schema.findings)
            .where(
              and(
                inArray(schema.findings.setId, latestSetIds),
                sql`${schema.findings.evidence} @> ${JSON.stringify([{ assetId }])}::jsonb`,
              ),
            )
            .orderBy(schema.findings.ordinal)
        : [];
    const committedAtBySetId = new Map(
      [...latestSets.values()].map((s) => [s.id, s.committedAt]),
    );

    const classificationRow = classificationRows[0] ?? null;
    const classification: AssetProfileClassification | null = classificationRow
      ? {
          categoryKey: classificationRow.categoryKey,
          label: classificationRow.categoryKey
            ? classificationLabel(classificationRow.categoryKey)
            : null,
          lifeClassOverride: classificationRow.lifeClassOverride,
          confidence: classificationRow.confidence,
          rationale: classificationRow.rationale,
          source: classificationRow.source as AssetProfileClassification['source'],
          status: classificationRow.status as AssetProfileClassification['status'],
          model: classificationRow.model,
          reviewedBy: classificationRow.reviewedBy,
          reviewedAt: classificationRow.reviewedAt?.toISOString() ?? null,
        }
      : null;

    const placementRow = placementRows[0] ?? null;
    // Where the asset's return files: the site's own district when it names
    // one, the engagement's otherwise — the same fallback the rendition uses.
    const effectiveJurisdiction =
      placementRow?.jurisdictionId ?? engagement.jurisdictionId ?? null;

    const appraisal = await appraisalState();

    async function appraisalState(): Promise<AssetAppraisalState> {
      if (asset.isDisposed) return { state: 'disposed' };
      if (!classification) return { state: 'unclassified' };
      if (
        !isValuable({
          categoryKey: classification.categoryKey,
          status: classification.status as ClassificationStatus,
        })
      ) {
        return { state: 'needs-review' };
      }
      const categoryKey = classification.categoryKey!;
      if (isExclusion(categoryKey)) {
        return { state: 'excluded', categoryKey, label: classificationLabel(categoryKey) };
      }
      const schedule = effectiveJurisdiction
        ? scheduleFor(effectiveJurisdiction, engagement.taxYear)
        : undefined;
      if (!schedule) {
        return {
          state: 'no-schedule',
          detail: effectiveJurisdiction
            ? `No published schedule for ${effectiveJurisdiction}`
            : 'No jurisdiction set, so no schedule applies',
        };
      }
      const result = appraise(
        {
          originalCost: asset.originalCost ?? Number.NaN,
          acquisitionYear: asset.acquisitionYear ?? Number.NaN,
          categoryKey,
          lifeClassOverride: (classification.lifeClassOverride ?? undefined) as
            | LifeClass
            | undefined,
          businessSic: engagement.sicCode,
        },
        schedule,
      );
      if (!result.ok) {
        return { state: 'gap', reason: result.gap.reason, detail: result.gap.detail };
      }
      const rate = await lookupRate(effectiveJurisdiction);
      return {
        state: 'valued',
        marketValue: result.value.marketValue,
        replacementCostNew: result.value.replacementCostNew,
        indexFactor: result.value.indexFactor,
        percentGood: result.value.percentGood,
        schedule: result.value.schedule,
        lifeSource: result.value.lifeSource,
        atFloor: result.value.atFloor,
        sic: result.value.sicProfile
          ? {
              code: result.value.sicProfile.sic,
              description: result.value.sicProfile.description,
              life: result.value.sicProfile.defaultLife,
            }
          : null,
        taxRate: rate,
        estimatedTax: result.value.marketValue * rate,
      };
    }

    const sighting = (batchId: string) => {
      const row = sightingRows.find((s) => s.batchId === batchId);
      if (!row) return null;
      return {
        batchId: row.batchId,
        fileName: row.fileName,
        appliedAt: (row.appliedAt ?? row.createdAt)?.toISOString() ?? null,
      };
    };

    return {
      asset,
      clientId: durable.clientId,
      naturalKey: durable.naturalKey,
      ordinal: durable.ordinal,
      matchMethod: durable.matchMethod as AssetProfile['matchMethod'],
      isAbsent: durable.isAbsent,
      currentTaxYear: durable.currentTaxYear,
      firstSeen: sighting(durable.firstSeenBatchId),
      lastSeen: sighting(durable.lastSeenBatchId),
      classification,
      placement: placementRow
        ? {
            locationId: placementRow.id,
            label: placementRow.label,
            addressLine1: placementRow.addressLine1,
            city: placementRow.city,
            stateCode: placementRow.stateCode,
            accountId: placementRow.accountId,
            jurisdictionId: placementRow.jurisdictionId ?? engagement.jurisdictionId,
            jurisdictionName: effectiveJurisdiction
              ? appraisalDistrictName(effectiveJurisdiction)
              : null,
          }
        : null,
      appraisal,
      filings: filingRows.map((f) => ({
        filingId: f.filingId,
        engagementId: f.engagementId,
        taxYear: f.taxYear,
        jurisdictionId: f.jurisdictionId,
        jurisdictionName: f.jurisdictionId ? appraisalDistrictName(f.jurisdictionId) : null,
        locationLabel: f.locationLabel,
        status: f.status,
        scheduleValue: f.scheduleValue,
        recordedAt: f.recordedAt.toISOString(),
      })),
      findings: findingRows.map((f) => ({
        setId: f.setId,
        source: f.source,
        key: f.key,
        title: f.title,
        kind: f.kind,
        effect: f.effect,
        committedAt: committedAtBySetId.get(f.setId)?.toISOString() ?? new Date(0).toISOString(),
      })),
      events: eventRows.map((e) => ({
        id: e.id,
        assetId: e.assetId,
        kind: e.kind as AssetProfile['events'][number]['kind'],
        batchId: e.batchId,
        field: e.field as AssetProfile['events'][number]['field'],
        previousValue: e.previousValue,
        value: e.value,
        significance: e.significance as AssetProfile['events'][number]['significance'],
        summary: e.summary,
        actor: e.actor,
        occurredAt: e.occurredAt.toISOString(),
      })),
      versions: versionRows.map((v) => ({
        versionId: v.versionId,
        batchId: v.batchId,
        engagementId: v.engagementId,
        fileName: v.fileName,
        batchStatus: v.batchStatus as AssetProfile['versions'][number]['batchStatus'],
        isCurrent: v.isCurrent,
        createdAt: v.createdAt.toISOString(),
        sourceSheet: v.sourceSheet,
        sourceRow: v.sourceRow,
        originalCost: v.originalCost,
        accumulatedDepreciation: v.accumulatedDepreciation,
        netBookValue: v.netBookValue,
        category: v.category,
        location: v.location,
        isDisposed: v.isDisposed,
      })),
      raw: (current.raw as Record<string, unknown> | null) ?? null,
    };
  });
}
