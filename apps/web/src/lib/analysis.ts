import { and, eq, sql } from 'drizzle-orm';
import { getAccount } from '@tangible/analytics';
import type { ClientRow, EngagementRow, PriorDocumentRow } from '@tangible/db';
import {
  appraisalDistrictName,
  compareRegister,
  type RegisterAsset,
  type RegisterComparison,
} from '@tangible/filing';
import { sourceFingerprint } from '@tangible/findings';
import { defaultRateFor } from '@tangible/types';
import { listAvailableYears } from '@tangible/ingest/catalog';
import {
  analyzeSavings,
  exemptionFor,
  foldLocation,
  type DetectionModelFit,
  type PriorFiling,
  type SavingsAsset,
} from '@tangible/savings';
import { learnedAcceptance } from '@/lib/acceptance';
import { evidenceFor } from '@/lib/evidence';
import type { EvidenceResult } from '@tangible/evidence';
import { loadDetectionModel } from '@/lib/model';
import { loadInvoiceSplits } from '@/lib/invoices';
import type {
  AssessedPosition,
  ClassificationStatus,
  FindingSource,
  SavingsReport,
} from '@tangible/types';
import { scheduleFor, type DepreciationSchedule } from '@tangible/valuation';
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

/**
 * Everything the savings analysis needs, gathered but not yet reasoned about.
 *
 * Split out because a run has to be able to say where it has got to, and this
 * is the one boundary in the work that is real: reading the client's asset
 * graph is four queries and a warehouse lookup, and `analyzeSavings` after it
 * is a single synchronous pass that touches nothing. A progress bar that
 * claimed more stages than this would be describing a pipeline that does not
 * exist.
 *
 * `schedule` is carried out rather than left inside, because a run has to
 * record the guide it actually applied — which is not always the engagement's
 * year. See RunBasisSchema.
 */
export interface SavingsInputs {
  engagement: EngagementRow;
  client: ClientRow;
  assets: SavingsAsset[];
  schedule: DepreciationSchedule | null;
  assessed: AssessedPosition | null;
  blendedTaxRate: number;
  /** Folded labels of the sites the client says they operate. */
  knownLocations: string[];
  /** Last year's return as filed, where one has been read and mapped. */
  priorFiling: PriorFiling | null;
  /** What the invoices behind capitalized lines turned out to contain. */
  invoiceSplits: Awaited<ReturnType<typeof loadInvoiceSplits>>;
  /**
   * What the practice's own closed positions say about how often this district
   * concedes each kind of argument. Optional so that a caller constructing
   * inputs by hand — a test, a replay of a stored run — gets the built-in
   * rates and a report that says so, rather than silently inheriting whatever
   * the firm has learned since.
   */
  acceptance?: Awaited<ReturnType<typeof learnedAcceptance>>;
  /**
   * Coefficients fitted from every decision the firm's reviewers have made,
   * for the findings that have enough of them to have earned one. Optional for
   * the same reason as the rates above: a hand-built input gets the authored
   * weights, and every row it produces says so.
   */
  model?: DetectionModelFit;
  /**
   * What the systems outside the register say about these assets.
   *
   * Optional, and empty is the normal state: a firm that has uploaded no
   * external export gets exactly the register-only signals it got before. What
   * it must never be is *inferred* — an absent array means nothing was
   * consulted, and a source that was never consulted must not clear or condemn
   * a single row.
   */
  evidence?: EvidenceResult[];
  fingerprint: string;
}

export async function loadSavingsInputs(engagementId: string): Promise<SavingsInputs> {
  const { engagement, client } = await fetchEngagement(engagementId);
  const db = requireDb();

  const rows = await db
    .select({
      asset: schema.assetVersions,
      locationId: schema.assets.locationId,
      classification: schema.assetClassifications,
    })
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(engagementAssetsWhere(engagementId));

  // Placement, for the per-jurisdiction leakage rollup. An unplaced asset is
  // passed with no site — its own bucket in the rollup, not a guess.
  const sites = new Map(
    (
      await db
        .select()
        .from(schema.clientLocations)
        .where(eq(schema.clientLocations.clientId, engagement.clientId))
    ).map((l) => {
      // Same rule as the returns builder: the site's own county wins where it
      // names one, else the county the engagement was opened under.
      const jurisdictionId = l.jurisdictionId ?? engagement.jurisdictionId;
      return [
        l.id,
        {
          label: l.label,
          jurisdictionId,
          jurisdictionName: jurisdictionId ? appraisalDistrictName(jurisdictionId) : null,
        },
      ] as const;
    }),
  );

  const assets: SavingsAsset[] = rows.map(({ asset, locationId, classification }) => ({
    id: asset.assetId,
    assetTag: asset.assetTag,
    description: asset.description,
    acquisitionYear: asset.acquisitionYear,
    originalCost: asset.originalCost,
    isDisposed: asset.isDisposed,
    registerCategory: asset.category,
    categoryKey: classification?.categoryKey ?? null,
    lifeClassOverride: classification?.lifeClassOverride ?? null,
    status: (classification?.status as ClassificationStatus | undefined) ?? null,
    site: (locationId ? sites.get(locationId) : null) ?? null,
    locationId,
    // The rest of the register's own row. All of it already landed on import;
    // none of it was reaching the engine, which is why a finding could not say
    // which cost centre it hit or whether the line had a serial number on it.
    disposalDate: asset.disposalDate,
    serialNumber: asset.serialNumber,
    vendor: asset.vendor,
    glAccount: asset.glAccount,
    costCenter: asset.department,
    classificationConfidence: classification?.confidence ?? null,
    classificationSource: classification?.source ?? null,
    // The columns the second-pass detectors read. Book life and depreciation
    // method are the client's own opinion of what a thing is; net book value
    // against accumulated depreciation is where an impairment shows; the
    // register's location string is the only thing on the row that can
    // disagree with where we have the asset placed.
    registerLife: asset.usefulLife,
    depreciationMethod: asset.depreciationMethod,
    netBookValue: asset.netBookValue,
    accumulatedDepreciation: asset.accumulatedDepreciation,
    registerLocation: asset.location,
    acquisitionDate: asset.acquisitionDate,
  }));

  /**
   * The site labels the client has told us about, folded for comparison.
   *
   * A register location that matches none of them is the closest thing this
   * product has to the doc's "assets at closed sites" — `client_locations`
   * carries no closed flag, and a site somebody stopped operating is simply one
   * that never got entered or got deleted. Empty when the client has entered no
   * sites at all, and the detector reads that as "we cannot tell" rather than
   * "every location is wrong".
   */
  const knownLocations = [...new Set([...sites.values()].map((s) => foldLocation(s.label)))].filter(
    Boolean,
  );

  const schedule = engagement.jurisdictionId
    ? (scheduleFor(engagement.jurisdictionId, engagement.taxYear) ?? null)
    : null;

  const [
    assessed,
    blendedTaxRate,
    fingerprint,
    priorFiling,
    invoiceSplits,
    acceptance,
    model,
    evidence,
  ] = await Promise.all([
    lookupAssessed(
      engagement.jurisdictionId,
      await engagementAccounts(engagementId),
      engagement.taxYear,
    ),
    lookupRate(engagement.jurisdictionId),
    analysisFingerprint({ engagementId, source: 'savings' }),
    loadPriorFiling(engagementId),
    loadInvoiceSplits(engagementId),
    learnedAcceptance(engagement.jurisdictionId),
    loadDetectionModel(),
    evidenceFor(engagementId, assets),
  ]);

  return {
    engagement,
    client,
    assets,
    schedule,
    assessed,
    blendedTaxRate,
    fingerprint,
    knownLocations,
    priorFiling,
    invoiceSplits,
    acceptance,
    model,
    evidence,
  };
}

/**
 * The pure half: value the property, find what is wrong with it, price it.
 *
 * Synchronous and total, which is what makes a run reproducible — given the
 * same inputs, the same rules version and the same schedule, this returns the
 * same report. The only thing in it that is not a function of its arguments is
 * the generation timestamp.
 */
export function analyzeLoaded(engagementId: string, inputs: SavingsInputs): SavingsReport {
  const { engagement, client } = inputs;
  return analyzeSavings({
    engagementId,
    clientName: client.name,
    taxYear: engagement.taxYear,
    jurisdictionId: engagement.jurisdictionId,
    assets: inputs.assets,
    schedule: inputs.schedule,
    assessed: inputs.assessed,
    blendedTaxRate: inputs.blendedTaxRate,
    businessSic: engagement.sicCode,
    exemptionAmount: exemptionFor(engagement.jurisdictionId, engagement.taxYear),
    knownLocations: inputs.knownLocations,
    priorFiling: inputs.priorFiling,
    invoiceSplits: inputs.invoiceSplits,
    // Undefined rather than an empty map when nothing has been learned, so the
    // report keeps saying its acceptance rates are judgement. An empty map is
    // the state a firm is in for its whole first season and it must not read as
    // a measurement.
    acceptanceOverrides:
      inputs.acceptance && Object.keys(inputs.acceptance.rates).length > 0
        ? inputs.acceptance.rates
        : undefined,
    acceptanceEvidence: inputs.acceptance?.evidence,
    // Null rather than absent is the same thing to the engine; what matters is
    // that a fit with no adopted findings scores nothing, so every row falls
    // back to the authored weights and says `rules` on its face.
    model: inputs.model ?? null,
    evidence: inputs.evidence,
    generatedAt: new Date().toISOString(),
  });
}

export async function buildSavingsAnalysis(engagementId: string): Promise<SavingsAnalysis> {
  const inputs = await loadSavingsInputs(engagementId);
  return {
    report: analyzeLoaded(engagementId, inputs),
    engagement: inputs.engagement,
    client: inputs.client,
    fingerprint: inputs.fingerprint,
  };
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
    assetTag: asset.assetTag,
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

  if (options.source === 'savings') {
    parts.push(...(await acceptanceFingerprint()));
    parts.push(...(await modelFingerprint()));
    parts.push(...(await evidenceFingerprint(options.engagementId)));
  }

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
 * The firm's outcome record, reduced to whether it has moved.
 *
 * A savings report now depends on something outside the engagement: the
 * acceptance rates learned from every position the practice has closed. When a
 * settlement is recorded on another client, this engagement's expected recovery
 * changes, and a committed set that did not notice would be quoting a number
 * the engine no longer produces.
 *
 * It contributes nothing at all until the first outcome exists. That is
 * deliberate and it is not a shortcut: with no outcomes the learned rates are
 * empty and the report is byte-for-byte what it was, so adding a constant to
 * the fingerprint would mark every committed set in the practice stale to
 * record a change that did not happen.
 */
async function acceptanceFingerprint(): Promise<Array<string | number | null>> {
  const db = requireDb();
  const [outcomes] = await db
    .select({
      count: sql<number>`count(*)::int`,
      latest: sql<string | null>`max(${schema.recoveryOutcomes.recordedAt})`,
    })
    .from(schema.recoveryOutcomes)
    .where(eq(schema.recoveryOutcomes.status, 'recorded'));

  if (!outcomes || outcomes.count === 0) return [];
  return [outcomes.count, outcomes.latest];
}

/**
 * The same trick for the fitted confidence model.
 *
 * A decision recorded on one engagement can change the coefficients scoring
 * rows on another, once a finding has enough of them — so the count and the
 * newest decision stand in for the fit. They stand in *badly* in one direction
 * and well in the other: a new decision may leave every coefficient where it
 * was, which marks a set stale that did not need to be, and no change to the
 * labels can leave the coefficients moved. Being wrong toward "recompute" is
 * the safe half, and recomputing is a button rather than a cost.
 *
 * As with the rates, silence until the first decision exists. A practice that
 * has never reviewed a row is scored by the authored weights exactly as it was
 * before this existed, and nothing should be marked stale to say so.
 */
async function modelFingerprint(): Promise<Array<string | number | null>> {
  const db = requireDb();
  const [decisions] = await db
    .select({
      count: sql<number>`count(*)::int`,
      latest: sql<string | null>`max(${schema.findingRowDecisions.decidedAt})`,
    })
    .from(schema.findingRowDecisions)
    .where(eq(schema.findingRowDecisions.source, 'savings'));

  if (!decisions || decisions.count === 0) return [];
  return [decisions.count, decisions.latest];
}

/**
 * The external exports this engagement is matched against.
 *
 * Unlike the rates and the fit, this one is per engagement — one client's
 * maintenance export changes nothing about another client's report. The count
 * of imported records is in the parts because a re-import under a corrected
 * mapping keeps the same export row and changes every match it produces, and a
 * fingerprint that only watched the file list would not notice.
 *
 * Silent when nothing has been imported, so an engagement with no external
 * sources fingerprints exactly as it did before this feature existed and no
 * stored report is marked stale for a capability nobody used.
 */
async function evidenceFingerprint(engagementId: string): Promise<Array<string | number | null>> {
  const db = requireDb();
  const [row] = await db
    .select({
      count: sql<number>`count(*)::int`,
      records: sql<number>`coalesce(sum(${schema.evidenceExports.recordCount}), 0)::int`,
      latest: sql<string | null>`max(${schema.evidenceExports.updatedAt})`,
    })
    .from(schema.evidenceExports)
    .where(
      and(
        eq(schema.evidenceExports.engagementId, engagementId),
        eq(schema.evidenceExports.status, 'imported'),
      ),
    );

  if (!row || row.count === 0) return [];
  return [row.count, row.records, row.latest];
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
  // A county with no rate of its own falls back to its *state's* blend, not to
  // Harris County's. See `defaultRateFor`.
  const fallback = defaultRateFor(jurisdictionId);
  try {
    const db = requireDb();
    const [row] = await db
      .select({ rate: schema.jurisdictions.blendedTaxRate })
      .from(schema.jurisdictions)
      .where(eq(schema.jurisdictions.id, jurisdictionId));
    return row?.rate ?? fallback;
  } catch {
    return fallback;
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

/**
 * Last year's return, in the shape the carry-forward detector reads.
 *
 * The most recently filed year we hold a *mapped* rendition for. Unmapped lines
 * are dropped rather than guessed at: the comparison is bucket against bucket,
 * and a line whose wording nobody has read yet has no bucket. Dropping it makes
 * the comparison narrower, which is the safe direction — a bucket we cannot see
 * cannot produce a finding, whereas one we mis-mapped produces a wrong one.
 *
 * Only documents that were verified or accepted count. A rendition that did not
 * foot is evidence of something, but it is not a baseline, and building a
 * client-facing finding on figures a check already flagged would be the wrong
 * use of it.
 */
async function loadPriorFiling(engagementId: string): Promise<PriorFiling | null> {
  const db = requireDb();
  const documents = await db
    .select()
    .from(schema.priorDocuments)
    .where(
      and(
        eq(schema.priorDocuments.engagementId, engagementId),
        eq(schema.priorDocuments.kind, 'rendition'),
      ),
    );

  const usable = documents
    .filter((d) => d.status === 'verified' || d.status === 'accepted')
    .filter((d) => d.documentTaxYear !== null)
    .sort((a, b) => (b.documentTaxYear ?? 0) - (a.documentTaxYear ?? 0));
  const latest = usable[0];
  if (!latest) return null;

  const lines = await db
    .select({
      categoryKey: schema.priorReturnLines.categoryKey,
      yearAcquired: schema.priorReturnLines.yearAcquired,
      historicalCost: schema.priorReturnLines.historicalCost,
    })
    .from(schema.priorReturnLines)
    .where(eq(schema.priorReturnLines.documentId, latest.id));

  const mapped = lines.filter(
    (line) =>
      line.categoryKey !== null && line.categoryKey !== 'mixed' && line.historicalCost !== null,
  );
  if (mapped.length === 0) return null;
  return { taxYear: latest.documentTaxYear!, lines: mapped };
}
