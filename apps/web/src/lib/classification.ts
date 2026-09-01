import 'server-only';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  CLASSIFY_BATCH_SIZE,
  aiUnavailableReason,
  classifyBatch,
  isAiConfigured,
  type ClassificationRequest,
} from '@tangible/ai';
import {
  dedupeKey,
  decideFromAi,
  decideFromHuman,
  decideFromMemory,
  decideUnclassifiable,
  fingerprint,
  hasSomethingToClassify,
  isKnownClassification,
  type ClassificationInput,
  type Decision,
} from '@tangible/classification';
import type { AssetClassificationRow, AssetVersionRow } from '@tangible/db';
import type {
  AssetClassification,
  ClassificationDecisionResult,
  ClassificationRunResult,
  UpdateClassificationRequest,
} from '@tangible/types';
import { LIFE_CLASSES } from '@tangible/valuation';
import { HttpError } from '@/lib/http';
import { rememberDecision } from '@/lib/classification-memory';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Running the classification engine over an engagement, and recording what a
 * reviewer decides afterwards.
 *
 * The order is the whole design. Memory first, because a decision a person
 * already made is better than one a model is about to make and costs nothing.
 * The model only sees what memory could not answer, deduplicated, so a register
 * with four hundred identical chairs asks one question. And a human decision,
 * whenever it lands, is the last word — it writes back to memory, applies to
 * every twin of that description in the engagement, and is never overwritten by
 * a later run.
 */

/**
 * A ceiling on one run, so a pathological register cannot quietly spend an
 * afternoon and a fortune. Anything past it stays unclassified and is reported
 * as deferred rather than silently dropped; the next run picks it up.
 */
const MAX_DISTINCT_PER_RUN = 1500;

/** Batches in flight at once. Enough to keep a big register brisk, not a flood. */
const BATCH_CONCURRENCY = 4;

const iso = (d: Date) => d.toISOString();

export function classificationDto(row: AssetClassificationRow): AssetClassification {
  return {
    id: row.id,
    assetId: row.assetId,
    engagementId: row.engagementId,
    categoryKey: row.categoryKey,
    lifeClassOverride: row.lifeClassOverride,
    confidence: row.confidence,
    rationale: row.rationale,
    source: row.source as AssetClassification['source'],
    status: row.status as AssetClassification['status'],
    model: row.model,
    fingerprint: row.fingerprint,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? iso(row.reviewedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function inputFor(asset: AssetVersionRow): ClassificationInput {
  return {
    description: asset.description,
    registerCategory: asset.category,
    glAccount: asset.glAccount,
    usefulLife: asset.usefulLife,
  };
}

/** Run `limit` promises at a time, preserving order. */
async function pooled<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface RunOptions {
  /**
   * Re-decide assets that already carry a machine decision. Confirmed rows are
   * never touched either way: a re-run must not be able to erase a person's
   * work, or nobody can trust the queue they just cleared.
   */
  reclassify: boolean;
}

export async function runClassification(
  engagementId: string,
  options: RunOptions,
): Promise<ClassificationRunResult> {
  const db = requireDb();

  const rows = await db
    .select({ asset: schema.assetVersions, classification: schema.assetClassifications })
    .from(schema.assetVersions)
    .leftJoin(
      schema.assetClassifications,
      eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
    )
    .where(
      options.reclassify
        ? and(
            engagementAssetsWhere(engagementId),
            // A confirmed row is a person's decision; leave it alone.
            sql`(${schema.assetClassifications.status} is null or ${schema.assetClassifications.status} <> 'confirmed')`,
          )
        : and(engagementAssetsWhere(engagementId), isNull(schema.assetClassifications.id)),
    );

  const result: ClassificationRunResult = {
    considered: rows.length,
    fromMemory: 0,
    fromAi: 0,
    unclassifiable: 0,
    autoAccepted: 0,
    needsReview: 0,
    distinctSent: 0,
    aiCalls: 0,
    model: null,
    aiUnavailable: false,
    failedBatches: 0,
    deferred: 0,
  };
  if (rows.length === 0) return result;

  const decisions = new Map<string, Decision>();

  // --- Pass 1: what a person already settled, on any engagement ------------
  const assets = rows.map((row) => row.asset);
  const fingerprints = new Map<string, string | null>();
  for (const asset of assets) {
    fingerprints.set(asset.assetId, fingerprint(asset.description));
  }

  const wanted = [...new Set([...fingerprints.values()].filter((f): f is string => f !== null))];
  const memoryRows =
    wanted.length > 0
      ? await db
          .select()
          .from(schema.classificationMemory)
          .where(inArray(schema.classificationMemory.fingerprint, wanted))
      : [];
  const memoryByFingerprint = new Map(memoryRows.map((row) => [row.fingerprint, row]));

  const needModel: AssetVersionRow[] = [];
  for (const asset of assets) {
    const input = inputFor(asset);
    if (!hasSomethingToClassify(input)) {
      decisions.set(
        asset.assetId,
        decideUnclassifiable(
          'This row carries no description, no register category, and no GL account — there is nothing to classify it on.',
        ),
      );
      result.unclassifiable += 1;
      continue;
    }

    const key = fingerprints.get(asset.assetId);
    const remembered = key ? memoryByFingerprint.get(key) : undefined;
    if (remembered) {
      decisions.set(
        asset.assetId,
        decideFromMemory({
          fingerprint: remembered.fingerprint,
          categoryKey: remembered.categoryKey,
          lifeClassOverride: remembered.lifeClassOverride,
          confirmations: remembered.confirmations,
          conflicted: remembered.conflicted,
          conflictingCategoryKey: remembered.conflictingCategoryKey,
          lastConfirmedAt: remembered.lastConfirmedAt,
        }),
      );
      result.fromMemory += 1;
      continue;
    }

    needModel.push(asset);
  }

  // --- Pass 2: ask the model, once per distinct question --------------------
  if (needModel.length > 0 && !isAiConfigured()) {
    // Not a failure. Memory is the half of this engine that needs no API key,
    // and its answers are worth keeping — so they are written, and the rest go
    // to the queue with the reason attached rather than the run aborting.
    result.aiUnavailable = true;
    for (const asset of needModel) {
      decisions.set(asset.assetId, {
        ...decideUnclassifiable(
          `AI classification is off in this deployment. ${aiUnavailableReason()} Classify this row in the queue, and the decision will be remembered.`,
        ),
        fingerprint: fingerprints.get(asset.assetId) ?? null,
      });
    }
  } else if (needModel.length > 0) {
    const groups = new Map<string, AssetVersionRow[]>();
    for (const asset of needModel) {
      const key = dedupeKey(inputFor(asset));
      const group = groups.get(key);
      if (group) group.push(asset);
      else groups.set(key, [asset]);
    }

    const allGroups = [...groups.values()];
    const sending = allGroups.slice(0, MAX_DISTINCT_PER_RUN);
    const deferredGroups = allGroups.slice(MAX_DISTINCT_PER_RUN);
    result.deferred = deferredGroups.length;
    result.distinctSent = sending.length;

    // The ref is the index into `sending`, so an answer can only ever land on
    // the question it was asked about.
    const requests: ClassificationRequest[] = sending.map((group, ref) => {
      const asset = group[0]!;
      return {
        ref,
        description: asset.description,
        registerCategory: asset.category,
        glAccount: asset.glAccount,
        usefulLife: asset.usefulLife,
        acquisitionYear: asset.acquisitionYear,
      };
    });

    const batches: ClassificationRequest[][] = [];
    for (let i = 0; i < requests.length; i += CLASSIFY_BATCH_SIZE) {
      batches.push(requests.slice(i, i + CLASSIFY_BATCH_SIZE));
    }

    const settled = await pooled(batches, BATCH_CONCURRENCY, async (batch) => {
      try {
        return await classifyBatch(batch);
      } catch (cause) {
        // One bad batch must not lose the good ones.
        console.error('[classify] batch failed', cause);
        return null;
      }
    });

    result.aiCalls = batches.length;
    const answered = new Set<number>();
    // Refs whose batch never came back. These are deliberately left with no
    // classification row at all: a transient 502 must not park a row in the
    // queue forever, and an absent row is what makes a plain re-run retry
    // exactly the ones that failed.
    const lost = new Set<number>();
    settled.forEach((outcome, index) => {
      if (!outcome) {
        result.failedBatches += 1;
        for (const request of batches[index]!) lost.add(request.ref);
        return;
      }
      result.model ??= outcome.model;
      for (const answer of outcome.answers) {
        const group = sending[answer.ref];
        if (!group) continue;
        answered.add(answer.ref);
        const decision = decideFromAi(answer, null);
        for (const asset of group) {
          decisions.set(asset.assetId, {
            ...decision,
            fingerprint: fingerprints.get(asset.assetId) ?? null,
          });
          result.fromAi += 1;
        }
      }
    });

    // A ref the model saw and skipped is a different thing from one it never
    // saw: the question was asked and went unanswered, so it gets a person.
    sending.forEach((group, ref) => {
      if (answered.has(ref) || lost.has(ref)) return;
      for (const asset of group) {
        decisions.set(asset.assetId, {
          ...decideUnclassifiable(
            'The model returned no answer for this description. It is queued rather than guessed at.',
          ),
          fingerprint: fingerprints.get(asset.assetId) ?? null,
        });
        result.unclassifiable += 1;
      }
    });
  }

  // --- Write -----------------------------------------------------------------
  const now = new Date();
  const values = [...decisions.entries()].map(([assetId, decision]) => ({
    assetId,
    engagementId,
    categoryKey: decision.categoryKey,
    lifeClassOverride: decision.lifeClassOverride,
    confidence: decision.confidence,
    rationale: decision.rationale,
    source: decision.source,
    status: decision.status,
    model: decision.source === 'ai' ? result.model : null,
    fingerprint: decision.fingerprint,
    updatedAt: now,
  }));

  for (const decision of decisions.values()) {
    if (decision.status === 'auto-accepted') result.autoAccepted += 1;
    else if (decision.status === 'needs-review') result.needsReview += 1;
  }

  const CHUNK = 500;
  if (values.length === 0) return result;
  for (let i = 0; i < values.length; i += CHUNK) {
    await db
      .insert(schema.assetClassifications)
      .values(values.slice(i, i + CHUNK))
      .onConflictDoUpdate({
        target: schema.assetClassifications.assetId,
        set: {
          categoryKey: sql`excluded.category_key`,
          lifeClassOverride: sql`excluded.life_class_override`,
          confidence: sql`excluded.confidence`,
          rationale: sql`excluded.rationale`,
          source: sql`excluded.source`,
          status: sql`excluded.status`,
          model: sql`excluded.model`,
          fingerprint: sql`excluded.fingerprint`,
          updatedAt: sql`excluded.updated_at`,
        },
        // Belt and braces against the reclassify filter: even a race that let a
        // just-confirmed row into this batch cannot overwrite it.
        setWhere: sql`asset_classifications.status <> 'confirmed'`,
      });
  }

  return result;
}

/**
 * Record a reviewer's decision.
 *
 * Three things happen together or not at all: the row is confirmed, every twin
 * of that description in the engagement inherits it, and the decision becomes
 * memory for every engagement that follows. Splitting them would leave the
 * reviewer having answered the same question twice.
 */
export async function recordDecision(
  classificationId: string,
  body: UpdateClassificationRequest,
  reviewer: string | null,
): Promise<ClassificationDecisionResult> {
  if (!isKnownClassification(body.categoryKey)) {
    throw new HttpError(
      400,
      `"${body.categoryKey}" is not a category this jurisdiction publishes.`,
    );
  }
  if (
    body.lifeClassOverride !== undefined &&
    body.lifeClassOverride !== null &&
    !(LIFE_CLASSES as readonly number[]).includes(body.lifeClassOverride)
  ) {
    throw new HttpError(
      400,
      `${body.lifeClassOverride} is not a published life class (${LIFE_CLASSES.join(', ')}).`,
    );
  }

  const db = requireDb();
  const override = body.lifeClassOverride ?? null;
  const now = new Date();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.assetClassifications)
      .where(eq(schema.assetClassifications.id, classificationId))
      .for('update');
    if (!existing) {
      throw new HttpError(404, `Unknown classification: ${classificationId}`);
    }

    const decision = decideFromHuman(
      body.categoryKey,
      override,
      existing.fingerprint,
      body.rationale ?? null,
    );

    /**
     * The label, written before the update that erases what it judges.
     *
     * This row is the only place the machine's answer survives a review, and it
     * exists because `AUTO_ACCEPT_CONFIDENCE` was a number nothing could argue
     * with: the classifier's confidence lived on the row a reviewer overwrote.
     *
     * Only the row the person looked at. `applyToMatching` below settles every
     * twin of this description in the engagement, and those are one judgement
     * inherited rather than forty made — recording them here would report a
     * sample size nobody produced.
     *
     * And only where a machine answered. Re-opening a row another reviewer
     * already confirmed measures one person against another, which is a
     * different question and not this table's.
     */
    if (existing.source === 'ai' || existing.source === 'memory') {
      await tx.insert(schema.classificationReviews).values({
        engagementId: existing.engagementId,
        assetId: existing.assetId,
        classificationId: existing.id,
        fingerprint: existing.fingerprint,
        machineSource: existing.source,
        machineCategoryKey: existing.categoryKey,
        machineLifeClass: existing.lifeClassOverride,
        machineConfidence: existing.confidence,
        machineStatus: existing.status,
        model: existing.model,
        humanCategoryKey: body.categoryKey,
        humanLifeClass: override,
        // Strict: auto-accept would have applied the life class too, so a
        // reviewer who kept the category and moved the class is a reviewer the
        // bar should not have skipped.
        agreed:
          existing.categoryKey === body.categoryKey && existing.lifeClassOverride === override,
        reviewedBy: reviewer,
        reviewedAt: now,
      });
    }

    const set = {
      categoryKey: decision.categoryKey,
      lifeClassOverride: decision.lifeClassOverride,
      confidence: decision.confidence,
      rationale: decision.rationale,
      source: decision.source,
      status: decision.status,
      reviewedBy: reviewer,
      reviewedAt: now,
      updatedAt: now,
    };

    const [updated] = await tx
      .update(schema.assetClassifications)
      .set(set)
      .where(eq(schema.assetClassifications.id, classificationId))
      .returning();

    let applied = 1;
    if (body.applyToMatching && existing.fingerprint) {
      const siblings = await tx
        .update(schema.assetClassifications)
        .set({
          ...set,
          rationale: `${decision.rationale} Applied from a row with the same description, settled by a reviewer.`,
        })
        .where(
          and(
            eq(schema.assetClassifications.engagementId, existing.engagementId),
            eq(schema.assetClassifications.fingerprint, existing.fingerprint),
            ne(schema.assetClassifications.id, classificationId),
            // Another reviewer's confirmed decision is not ours to overwrite.
            ne(schema.assetClassifications.status, 'confirmed'),
          ),
        )
        .returning({ id: schema.assetClassifications.id });
      applied += siblings.length;
    }

    let remembered = false;
    let memoryConflict = false;
    if (body.remember && existing.fingerprint) {
      const [asset] = await tx
        .select({ description: schema.assetVersions.description })
        .from(schema.assetVersions)
        .where(
          and(
            eq(schema.assetVersions.assetId, existing.assetId),
            eq(schema.assetVersions.isCurrent, true),
          ),
        )
        .limit(1);

      const outcome = await rememberDecision(tx, {
        fingerprint: existing.fingerprint,
        // A readable sample, so the memory row is something a person can audit
        // rather than a fold of a description nobody kept.
        sampleDescription: asset?.description ?? existing.fingerprint,
        categoryKey: body.categoryKey,
        lifeClassOverride: override,
        engagementId: existing.engagementId,
        reviewer,
        now,
      });
      remembered = outcome.remembered;
      memoryConflict = outcome.conflict;
    }

    return {
      classification: classificationDto(updated!),
      applied,
      remembered,
      memoryConflict,
    };
  });
}
