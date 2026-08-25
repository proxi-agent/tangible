import { eq, sql } from 'drizzle-orm';
import { getAccount } from '@tangible/analytics';
import type { ClientRow, EngagementRow, PriorDocumentRow } from '@tangible/db';
import { compareRegister, type RegisterAsset, type RegisterComparison } from '@tangible/filing';
import { sourceFingerprint } from '@tangible/findings';
import { listAvailableYears } from '@tangible/ingest/catalog';
import { analyzeSavings, exemptionFor, type SavingsAsset } from '@tangible/savings';
import type {
  AssessedPosition,
  ClassificationStatus,
  FindingSource,
  SavingsReport,
} from '@tangible/types';
import { scheduleFor } from '@tangible/valuation';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { fetchMappedDocument } from '@/lib/prior-mapping';
import { engagementAccounts } from '@/lib/sites';
import { HttpError } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The two analyses, in one place, because two callers now need them.
 *
 * They stay derived on read — settling one more row in a review queue still
 * changes the number immediately, and that has not stopped being the behaviour
 * you want from a document someone is about to put in front of a client. What
 * changed is that a report can now also be *committed*: a dated copy with the
 * partner's dispositions on it. Committing has to run exactly the analysis the
 * screen was showing, so the analysis cannot go on living inside a GET handler.
 *
 * Each builder returns a fingerprint alongside its result. It is taken over the
 * analysis' *inputs* — the register, the classifications, the engagement, the
 * mapping — so a committed set can later say whether the ground it stood on has
 * moved. Over the output it would only tell us the answer changed, which is the
 * one thing already obvious from re-running it.
 */

/**
 * The blended rate used to turn value into tax. A real figure per jurisdiction
 * lives in the warehouse; this is the fallback when that table has not been
 * populated, and it is a round approximation of a Harris County total levy.
 */
const FALLBACK_BLENDED_RATE = 0.025;

export interface SavingsAnalysis {
  report: SavingsReport;
  engagement: EngagementRow;
  client: ClientRow;
  fingerprint: string;
}

export async function buildSavingsAnalysis(engagementId: string): Promise<SavingsAnalysis> {
  const { engagement, client } = await fetchEngagement(engagementId);
  const db = requireDb();

  const rows = await db
    .select({ asset: schema.assetVersions, classification: schema.assetClassifications })
    .from(schema.assetVersions)
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(engagementAssetsWhere(engagementId));

  const assets: SavingsAsset[] = rows.map(({ asset, classification }) => ({
    id: asset.assetId,
    description: asset.description,
    acquisitionYear: asset.acquisitionYear,
    originalCost: asset.originalCost,
    isDisposed: asset.isDisposed,
    registerCategory: asset.category,
    categoryKey: classification?.categoryKey ?? null,
    lifeClassOverride: classification?.lifeClassOverride ?? null,
    status: (classification?.status as ClassificationStatus | undefined) ?? null,
  }));

  const schedule = engagement.jurisdictionId
    ? (scheduleFor(engagement.jurisdictionId, engagement.taxYear) ?? null)
    : null;

  const [assessed, blendedTaxRate, fingerprint] = await Promise.all([
    lookupAssessed(
      engagement.jurisdictionId,
      await engagementAccounts(engagementId),
      engagement.taxYear,
    ),
    lookupRate(engagement.jurisdictionId),
    analysisFingerprint({ engagementId, source: 'savings' }),
  ]);

  const report = analyzeSavings({
    engagementId,
    clientName: client.name,
    taxYear: engagement.taxYear,
    jurisdictionId: engagement.jurisdictionId,
    assets,
    schedule,
    assessed,
    blendedTaxRate,
    businessSic: engagement.sicCode,
    exemptionAmount: exemptionFor(engagement.jurisdictionId, engagement.taxYear),
    generatedAt: new Date().toISOString(),
  });

  return { report, engagement, client, fingerprint };
}

export interface ComparisonAnalysis {
  comparison: RegisterComparison;
  document: PriorDocumentRow;
  engagement: EngagementRow;
  taxYear: number;
  fingerprint: string;
}

export async function buildComparisonAnalysis(documentId: string): Promise<ComparisonAnalysis> {
  const { document, lines } = await fetchMappedDocument(documentId);
  if (document.kind !== 'rendition')
    throw new HttpError(400, 'Only a rendition can be compared against the register.');

  const { engagement } = await fetchEngagement(document.engagementId);
  const db = requireDb();

  const rows = await db
    .select({ asset: schema.assetVersions, classification: schema.assetClassifications })
    .from(schema.assetVersions)
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(engagementAssetsWhere(document.engagementId));

  const assets: RegisterAsset[] = rows.map(({ asset, classification }) => ({
    id: asset.assetId,
    description: asset.description,
    acquisitionYear: asset.acquisitionYear,
    originalCost: asset.originalCost,
    isDisposed: asset.isDisposed,
    disposalDate: asset.disposalDate,
    categoryKey: classification?.categoryKey ?? null,
    lifeClassOverride: classification?.lifeClassOverride ?? null,
    status: (classification?.status as ClassificationStatus | undefined) ?? null,
  }));

  // Everything here is valued on the *return's* own tax year, not the
  // engagement's. A 2025 rendition reviewed inside a 2027 engagement is a
  // statement about January 1, 2025, and pricing it on 2027 index factors would
  // quietly compare two different years' arithmetic.
  const taxYear = document.documentTaxYear ?? engagement.taxYear;
  const schedule = engagement.jurisdictionId
    ? (scheduleFor(engagement.jurisdictionId, taxYear) ?? null)
    : null;

  const comparison = compareRegister({
    taxYear,
    assets,
    lines: lines.map((line) => ({
      schedule: line.schedule,
      type: line.type,
      yearAcquired: line.yearAcquired,
      historicalCost: line.historicalCost,
      goodFaithEstimate: line.goodFaithEstimate,
      categoryKey: line.mapping.categoryKey,
      mappingStatus: line.mapping.status,
    })),
    schedule,
    businessSic: engagement.sicCode,
  });

  const fingerprint = await analysisFingerprint({
    engagementId: document.engagementId,
    source: 'register-comparison',
    priorDocumentId: documentId,
  });

  return { comparison, document, engagement, taxYear, fingerprint };
}

/**
 * The fingerprint on its own, without running the analysis.
 *
 * A committed set asks this to find out whether it is behind: recomputing a
 * full comparison to answer "has anything moved?" would mean pricing every
 * asset on every page load, and the answer is four aggregate queries.
 */
export async function analysisFingerprint(options: {
  engagementId: string;
  source: FindingSource;
  priorDocumentId?: string | null;
}): Promise<string> {
  const { engagement } = await fetchEngagement(options.engagementId);
  const register = await registerFingerprint(options.engagementId);
  const parts: Array<string | number | Date | null> = [
    options.source,
    ...register,
    ...engagementParts(engagement),
  ];

  if (options.source === 'register-comparison') {
    if (!options.priorDocumentId)
      throw new HttpError(400, 'A register comparison needs the return it was run against.');
    const db = requireDb();
    const [document] = await db
      .select({ updatedAt: schema.priorDocuments.updatedAt })
      .from(schema.priorDocuments)
      .where(eq(schema.priorDocuments.id, options.priorDocumentId));
    if (!document) throw new HttpError(404, `Unknown prior document: ${options.priorDocumentId}`);
    parts.push(document.updatedAt, ...(await mappingFingerprint(options.priorDocumentId)));
  }

  return sourceFingerprint(parts);
}

/**
 * The engagement facts the analyses read. `updatedAt` would cover all of them,
 * but it also moves when a note is edited, and a report that calls itself stale
 * because someone fixed a typo teaches people to ignore the word.
 */
function engagementParts(engagement: EngagementRow): Array<string | number | null> {
  return [engagement.taxYear, engagement.jurisdictionId, engagement.sicCode];
}

/**
 * The register and its classifications, reduced to something comparable.
 *
 * Counts and high-water marks rather than the rows themselves: an asset version
 * is immutable once written, so a new `createdAt` or a changed count is the only
 * way the current register can differ. Classifications *are* updated in place,
 * which is why they contribute `updatedAt` instead.
 */
async function registerFingerprint(engagementId: string): Promise<Array<string | number | null>> {
  const db = requireDb();
  const [versions] = await db
    .select({
      count: sql<number>`count(*)::int`,
      latest: sql<string | null>`max(${schema.assetVersions.createdAt})`,
    })
    .from(schema.assetVersions)
    .where(engagementAssetsWhere(engagementId));

  const [classifications] = await db
    .select({
      count: sql<number>`count(*)::int`,
      latest: sql<string | null>`max(${schema.assetClassifications.updatedAt})`,
    })
    .from(schema.assetClassifications)
    .innerJoin(
      schema.assetVersions,
      eq(schema.assetVersions.assetId, schema.assetClassifications.assetId),
    )
    .where(engagementAssetsWhere(engagementId));

  return [
    versions?.count ?? 0,
    versions?.latest ?? null,
    classifications?.count ?? 0,
    classifications?.latest ?? null,
  ];
}

/**
 * The state of the line-mapping queue. `mappedAt` moves on every decision,
 * accept and reject alike, and the mapped count catches a decision that clears
 * a category rather than setting one.
 */
async function mappingFingerprint(documentId: string): Promise<Array<string | number | null>> {
  const db = requireDb();
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      mapped: sql<number>`count(${schema.priorReturnLines.categoryKey})::int`,
      latest: sql<string | null>`max(${schema.priorReturnLines.mappedAt})`,
      created: sql<string | null>`max(${schema.priorReturnLines.createdAt})`,
    })
    .from(schema.priorReturnLines)
    .where(eq(schema.priorReturnLines.documentId, documentId));

  return [row?.count ?? 0, row?.mapped ?? 0, row?.latest ?? null, row?.created ?? null];
}

/**
 * The client's current position on the public roll.
 *
 * Best-effort on purpose. The warehouse is a local DuckDB file that may hold no
 * years for this county, may be mid-ingest and locked, or may not exist at all
 * in a given deployment — and none of that should take down a report whose
 * other half is fully computable. A missing roll means the report says it has
 * no "before" rather than failing.
 */
export async function lookupRate(jurisdictionId: string | null): Promise<number> {
  if (!jurisdictionId) return FALLBACK_BLENDED_RATE;
  try {
    const db = requireDb();
    const [row] = await db
      .select({ rate: schema.jurisdictions.blendedTaxRate })
      .from(schema.jurisdictions)
      .where(eq(schema.jurisdictions.id, jurisdictionId));
    return row?.rate ?? FALLBACK_BLENDED_RATE;
  } catch {
    return FALLBACK_BLENDED_RATE;
  }
}

async function lookupAssessed(
  jurisdictionId: string | null,
  accountIds: readonly string[],
  taxYear: number,
): Promise<AssessedPosition | null> {
  if (!jurisdictionId || accountIds.length === 0) return null;
  try {
    const warehouse = await getWarehouse();
    // The engagement is usually for a season the roll has not published yet —
    // a 2027 filing prepared in 2026 against a roll that ends at 2026. Asking
    // for a year the warehouse does not hold returns nothing, so fall back to
    // the most recent year it does and let the report label which year it
    // compared against.
    const years = await listAvailableYears(warehouse, jurisdictionId);
    if (years.length === 0) return null;
    const lookupYear = years.includes(taxYear) ? taxYear : Math.max(...years);
    const found = (
      await Promise.all(
        accountIds.map((accountId) => getAccount(warehouse, jurisdictionId, lookupYear, accountId)),
      )
    ).filter((account) => account !== null);
    if (found.length === 0) return null;

    const positions = found.map((account) => {
      // Prefer the engagement's own year; fall back to the most recent on the
      // roll, and say which — comparing a corrected 2027 position against a 2025
      // assessment without labelling the year would be quietly misleading.
      const year =
        account.history.find((point) => point.taxYear === taxYear) ?? account.history.at(-1);
      return {
        accountId: account.accountId,
        taxYear: year?.taxYear ?? taxYear,
        appraisedValue: year?.appraisedValue ?? null,
        assessedValue: year?.assessedValue ?? null,
        renditionFiled: year?.renditionFiled ?? null,
        ownerName: account.ownerName,
      } satisfies AssessedPosition;
    });
    return positions.length === 1 ? positions[0]! : combine(positions);
  } catch (cause) {
    console.warn('[savings] roll lookup unavailable', cause);
    return null;
  }
}

/**
 * Several accounts read as one position.
 *
 * The report is engagement-wide — one register, one classification, one set of
 * findings — while the roll is per site, so the "before" a multi-location
 * client is compared against is the sum of what the district has them at. Sums
 * for the money, because that is what the client pays; `null` where every
 * account is silent, so a missing figure stays missing rather than becoming a
 * zero that reads as "assessed at nothing". `renditionFiled` is true only if
 * every site filed: one site that did not is a client who did not, which is the
 * fact the report is trying to surface.
 */
function combine(positions: readonly AssessedPosition[]): AssessedPosition {
  const sum = (pick: (p: AssessedPosition) => number | null) => {
    const values = positions.map(pick).filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
  };
  const filed = positions.map((p) => p.renditionFiled).filter((f) => f !== null);
  return {
    accountId: positions.map((p) => p.accountId).join(', '),
    taxYear: Math.max(...positions.map((p) => p.taxYear)),
    appraisedValue: sum((p) => p.appraisedValue),
    assessedValue: sum((p) => p.assessedValue),
    renditionFiled: filed.length === 0 ? null : filed.every(Boolean),
    ownerName: positions.find((p) => p.ownerName)?.ownerName ?? null,
  };
}
