import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { classificationLabel, isExclusion, isValuable } from '@tangible/classification';
import { sanitizeAnswer } from '@tangible/filing';
import { aiUnavailableReason, answerGraphQuestion, isAiConfigured } from '@tangible/ai';
import type {
  ClassificationStatus,
  DigestAsset,
  GraphAnswer,
  GraphAskRecord,
  GraphDigest,
} from '@tangible/types';
import { buildSavingsAnalysis } from '@/lib/analysis';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { engagementResult } from '@/lib/result';
import { HttpError } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Ask-the-graph: the record, made answerable.
 *
 * The digest is assembled from the same builders the screens render —
 * `buildSavingsAnalysis` for findings and leakage, `engagementResult` for the
 * season — so an answer can never disagree with the workspace it points into.
 * The model sees the digest and nothing else; code validates its references
 * before anything is stored; a person reads the answer through the links.
 */

/**
 * Largest costs kept when a register outgrows the digest. The digest records
 * how many rows fell off, and the answerer is instructed to say so whenever
 * an answer depends on the tail.
 */
const DIGEST_ASSET_CAP = 400;

type AskRow = typeof schema.graphAnswers.$inferSelect;

function dto(row: AskRow): GraphAskRecord {
  return {
    id: row.id,
    engagementId: row.engagementId,
    question: row.question,
    facts: row.facts as GraphDigest,
    answer: row.answer as GraphAnswer,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

async function digestAssets(engagementId: string, clientId: string): Promise<DigestAsset[]> {
  const db = requireDb();
  const rows = await db
    .select({
      assetId: schema.assets.id,
      locationId: schema.assets.locationId,
      version: schema.assetVersions,
      classification: schema.assetClassifications,
    })
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(engagementAssetsWhere(engagementId));

  const locations = new Map(
    (
      await db
        .select()
        .from(schema.clientLocations)
        .where(eq(schema.clientLocations.clientId, clientId))
    ).map((location) => [location.id, location.label]),
  );

  return rows.map(({ assetId, locationId, version: v, classification: c }) => {
    // The same refusal order the valuation walk applies, collapsed to a word.
    const status = v.isDisposed
      ? 'disposed'
      : !c?.categoryKey
        ? 'unclassified'
        : !isValuable({ categoryKey: c.categoryKey, status: c.status as ClassificationStatus })
          ? 'needs-review'
          : isExclusion(c.categoryKey)
            ? 'excluded'
            : 'in-service';
    return {
      id: assetId,
      tag: v.assetTag,
      description: v.description,
      site: (locationId ? locations.get(locationId) : null) ?? null,
      category: c?.categoryKey ? classificationLabel(c.categoryKey) : null,
      status,
      acquisitionYear: v.acquisitionYear,
      originalCost: v.originalCost,
    };
  });
}

/** The record as the answerer sees it, from the same builders as the screens. */
export async function assembleGraphDigest(engagementId: string): Promise<GraphDigest> {
  const [{ report, client, engagement }, season] = await Promise.all([
    buildSavingsAnalysis(engagementId),
    engagementResult(engagementId),
  ]);
  const assets = await digestAssets(engagementId, engagement.clientId);
  assets.sort((a, b) => (b.originalCost ?? -1) - (a.originalCost ?? -1));

  return {
    clientName: client.name,
    taxYear: engagement.taxYear,
    jurisdictionName: report.jurisdictionName,
    generatedAt: new Date().toISOString(),
    season,
    assessed: report.assessed,
    coverage: report.coverage,
    leakage: report.leakage,
    findings: report.findings.map(({ evidence: _evidence, ...finding }) => finding),
    assets: assets.slice(0, DIGEST_ASSET_CAP),
    assetsOmitted: Math.max(0, assets.length - DIGEST_ASSET_CAP),
  };
}

/** Past exchanges, newest first. The history of what was asked is record too. */
export async function listGraphAsks(engagementId: string): Promise<GraphAskRecord[]> {
  await fetchEngagement(engagementId);
  const rows = await requireDb()
    .select()
    .from(schema.graphAnswers)
    .where(eq(schema.graphAnswers.engagementId, engagementId))
    .orderBy(desc(schema.graphAnswers.createdAt))
    .limit(20);
  return rows.map(dto);
}

/** Assemble, answer, validate, store. Every exchange is a new row. */
export async function askGraph(engagementId: string, question: string): Promise<GraphAskRecord> {
  await fetchEngagement(engagementId);
  if (!isAiConfigured()) {
    throw new HttpError(503, `Ask-the-graph is off. ${aiUnavailableReason()}`);
  }

  const digest = await assembleGraphDigest(engagementId);

  let result;
  try {
    result = await answerGraphQuestion(question, digest);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `The answer failed: ${message}`);
  }

  const answer = sanitizeAnswer(digest, result.parsed);

  const [inserted] = await requireDb()
    .insert(schema.graphAnswers)
    .values({ engagementId, question, facts: digest, answer, model: result.model })
    .returning();
  return dto(inserted!);
}
