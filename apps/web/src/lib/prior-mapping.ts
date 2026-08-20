import 'server-only';
import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  LINE_TYPE_BATCH_SIZE,
  aiUnavailableReason,
  isAiConfigured,
  mapLineTypes,
  type LineTypeRequest,
} from '@tangible/ai';
import {
  isKnownLineMapping,
  lineMappingLabel,
  lineTypeFingerprint,
  mapFromAi,
  mapFromHuman,
  mapFromMemory,
  mapFromSchedule,
  mapUnmappable,
  type LineMapping,
} from '@tangible/classification';
import type { PriorDocumentRow, PriorReturnLineRow } from '@tangible/db';
import { rollupMapped, type MappedBasis } from '@tangible/filing';
import type {
  ClassificationStatus,
  LineMappingDecisionResult,
  LineMappingRunResult,
  LineMappingSource,
  MappedPriorLine,
  RenditionScheduleKey,
  UpdateLineMappingRequest,
} from '@tangible/types';
import { rememberDecision } from '@/lib/classification-memory';
import { HttpError } from '@/lib/route';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Deciding what the filer's own wording means.
 *
 * Extraction stores "Mach & Equip" verbatim and decides nothing. This is where
 * that becomes `machinery-equipment`, which is the join that lets a prior return
 * be compared with a classified register at all.
 *
 * Three authorities, in order, each overriding the one below it:
 *
 *   1. **Memory** — a reviewer already read these exact words on this exact
 *      schedule. Free, and it crosses clients: controllers in one industry write
 *      their schedules the same way, so the tenth machine shop costs nothing.
 *   2. **The schedule letter** — Form 50-144 says Schedule D is licensed
 *      vehicles, so a Schedule D line is licensed vehicles. Four of the six
 *      schedules never reach a model.
 *   3. **The model** — Schedules A and E, one call for the whole return, because
 *      every line is context for every other line.
 *
 * Memory sits above the schedule rule deliberately. A reviewer who overrode a
 * schedule-determined line had a reason, and a re-extraction must not quietly
 * undo it.
 */

/** How many lines one run will decide. Past this, a detail schedule is attached. */
const MAX_DISTINCT_PER_RUN = 400;

export interface MapOptions {
  /**
   * Re-decide lines that already carry a machine reading. A confirmed line is
   * never touched either way — a re-run must not erase a reviewer's work.
   */
  remap: boolean;
}

export async function runLineMapping(
  documentId: string,
  options: MapOptions = { remap: false },
): Promise<LineMappingRunResult> {
  const db = requireDb();

  const [document] = await db
    .select()
    .from(schema.priorDocuments)
    .where(eq(schema.priorDocuments.id, documentId));
  if (!document) throw new HttpError(404, `Unknown prior document: ${documentId}`);

  const [engagement] = await db
    .select()
    .from(schema.engagements)
    .where(eq(schema.engagements.id, document.engagementId));

  const lines = await db
    .select()
    .from(schema.priorReturnLines)
    .where(
      options.remap
        ? and(
            eq(schema.priorReturnLines.documentId, documentId),
            sql`(${schema.priorReturnLines.mappingStatus} is null or ${schema.priorReturnLines.mappingStatus} <> 'confirmed')`,
          )
        : and(
            eq(schema.priorReturnLines.documentId, documentId),
            isNull(schema.priorReturnLines.mappingStatus),
          ),
    );

  const result: LineMappingRunResult = {
    considered: lines.length,
    fromSchedule: 0,
    fromMemory: 0,
    fromAi: 0,
    autoAccepted: 0,
    needsReview: 0,
    distinctSent: 0,
    model: null,
    aiUnavailable: false,
  };
  if (lines.length === 0) return result;

  const mappings = new Map<string, LineMapping>();
  const keys = new Map<string, string | null>();
  for (const line of lines) {
    keys.set(line.id, lineTypeFingerprint(line.schedule as RenditionScheduleKey, line.type));
  }

  // --- Pass 1: memory, then the form itself --------------------------------
  const wanted = [...new Set([...keys.values()].filter((k): k is string => k !== null))];
  const memoryRows =
    wanted.length > 0
      ? await db
          .select()
          .from(schema.classificationMemory)
          .where(inArray(schema.classificationMemory.fingerprint, wanted))
      : [];
  const memoryByKey = new Map(memoryRows.map((row) => [row.fingerprint, row]));

  const needModel: PriorReturnLineRow[] = [];
  for (const line of lines) {
    const key = keys.get(line.id) ?? null;

    const remembered = key ? memoryByKey.get(key) : undefined;
    if (remembered) {
      mappings.set(
        line.id,
        mapFromMemory({
          fingerprint: remembered.fingerprint,
          categoryKey: remembered.categoryKey,
          confirmations: remembered.confirmations,
          conflicted: remembered.conflicted,
          conflictingCategoryKey: remembered.conflictingCategoryKey,
          lastConfirmedAt: remembered.lastConfirmedAt,
        }),
      );
      result.fromMemory += 1;
      continue;
    }

    const fromSchedule = mapFromSchedule(line.schedule as RenditionScheduleKey, key);
    if (fromSchedule) {
      mappings.set(line.id, fromSchedule);
      result.fromSchedule += 1;
      continue;
    }

    if (!key) {
      // A line on a wording schedule with no wording on it. It still carries
      // money, so it is queued rather than dropped — an unlabelled line is a
      // finding about the filing, not a gap in ours.
      mappings.set(
        line.id,
        mapUnmappable(
          `This Schedule ${line.schedule} line carries no property type, so there is nothing to read. The form gives no basis for the schedule the district valued it on.`,
        ),
      );
      continue;
    }

    needModel.push(line);
  }

  // --- Pass 2: the model, once per distinct wording ------------------------
  if (needModel.length > 0 && !isAiConfigured()) {
    result.aiUnavailable = true;
    for (const line of needModel) {
      mappings.set(
        line.id,
        mapUnmappable(
          `AI mapping is off in this deployment. ${aiUnavailableReason()} Read this wording in the queue, and the decision will be remembered.`,
          keys.get(line.id) ?? null,
        ),
      );
    }
  } else if (needModel.length > 0) {
    // Distinct wordings, not distinct lines. Schedule E repeats one type across
    // every year acquired, so a ten-year-old machine shop asks one question and
    // gets one answer for all ten of its rows.
    const groups = new Map<string, PriorReturnLineRow[]>();
    for (const line of needModel) {
      const key = keys.get(line.id)!;
      const group = groups.get(key);
      if (group) group.push(line);
      else groups.set(key, [line]);
    }

    const sending = [...groups.values()].slice(0, MAX_DISTINCT_PER_RUN);
    result.distinctSent = sending.length;

    const requests: LineTypeRequest[] = sending.map((group, ref) => {
      const first = group[0]!;
      return {
        ref,
        schedule: first.schedule as RenditionScheduleKey,
        type: first.type,
        years: group
          .map((line) => line.yearAcquired)
          .filter((year): year is number => year !== null),
        reportedTotal: group.reduce(
          (total, line) => total + (line.historicalCost ?? line.goodFaithEstimate ?? 0),
          0,
        ),
      };
    });

    // The SIC code is the only thing we know about what the business does, and
    // it is the difference between reading "Equipment" on a restaurant's return
    // and on a machine shop's. Passed as a hint, never as an answer.
    const context = {
      businessDescription: engagement?.sicCode ? `SIC code ${engagement.sicCode}` : null,
      taxYear: document.documentTaxYear,
    };

    const batches: LineTypeRequest[][] = [];
    for (let i = 0; i < requests.length; i += LINE_TYPE_BATCH_SIZE) {
      batches.push(requests.slice(i, i + LINE_TYPE_BATCH_SIZE));
    }

    const answered = new Set<number>();
    for (const batch of batches) {
      let outcome: Awaited<ReturnType<typeof mapLineTypes>> | null = null;
      try {
        outcome = await mapLineTypes(batch, context);
      } catch (cause) {
        // One bad batch must not lose the good ones.
        console.error('[map-lines] batch failed', cause);
      }
      if (!outcome) continue;
      result.model ??= outcome.model;
      for (const answer of outcome.answers) {
        const group = sending[answer.ref];
        if (!group) continue;
        answered.add(answer.ref);
        const mapping = mapFromAi(answer, keys.get(group[0]!.id) ?? null);
        for (const line of group) {
          mappings.set(line.id, { ...mapping, fingerprint: keys.get(line.id) ?? null });
          result.fromAi += 1;
        }
      }
    }

    // A wording the model saw and skipped is a different thing from one it never
    // saw. Both end up with a person; only the first says the question was asked.
    sending.forEach((group, ref) => {
      if (answered.has(ref)) return;
      for (const line of group) {
        mappings.set(
          line.id,
          mapUnmappable(
            'The model returned no reading for this wording. It is queued rather than guessed at.',
            keys.get(line.id) ?? null,
          ),
        );
      }
    });

    // Anything past the ceiling stays unread rather than silently unmapped.
    for (const group of [...groups.values()].slice(MAX_DISTINCT_PER_RUN)) {
      for (const line of group) {
        mappings.set(
          line.id,
          mapUnmappable(
            `This return has more than ${MAX_DISTINCT_PER_RUN} distinct property types, which is more than one run reads. Re-run the mapping to pick up the rest.`,
            keys.get(line.id) ?? null,
          ),
        );
      }
    }
  }

  // --- Write ---------------------------------------------------------------
  const now = new Date();
  for (const mapping of mappings.values()) {
    if (mapping.status === 'auto-accepted') result.autoAccepted += 1;
    else if (mapping.status === 'needs-review') result.needsReview += 1;
  }

  await db.transaction(async (tx) => {
    for (const [lineId, mapping] of mappings) {
      await tx
        .update(schema.priorReturnLines)
        .set({
          categoryKey: mapping.categoryKey,
          mappingSource: mapping.source,
          mappingStatus: mapping.status,
          mappingConfidence: mapping.confidence,
          mappingRationale: mapping.rationale,
          mappingFingerprint: mapping.fingerprint,
          mappedAt: now,
        })
        .where(
          and(
            eq(schema.priorReturnLines.id, lineId),
            // Belt and braces against the filter above: a race that let a
            // just-confirmed line into this batch still cannot overwrite it.
            sql`(${schema.priorReturnLines.mappingStatus} is null or ${schema.priorReturnLines.mappingStatus} <> 'confirmed')`,
          ),
        );
    }
  });

  return result;
}

export type { LineMappingDecisionResult };

/**
 * Record a reviewer's reading.
 *
 * The same three-things-together as the asset queue: the line is confirmed,
 * every other line on the return using those words inherits it, and the reading
 * becomes memory for every return that follows. Schedule E is the reason the
 * middle one matters — one wording spans a decade of rows, and asking about each
 * year separately would be ten identical questions.
 */
export async function recordLineMapping(
  lineId: string,
  body: UpdateLineMappingRequest,
  reviewer: string | null,
): Promise<LineMappingDecisionResult> {
  if (!isKnownLineMapping(body.categoryKey)) {
    throw new HttpError(400, `"${body.categoryKey}" is not a reading this vocabulary allows.`);
  }

  const db = requireDb();
  const now = new Date();

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.priorReturnLines)
      .where(eq(schema.priorReturnLines.id, lineId))
      .for('update');
    if (!existing) throw new HttpError(404, `Unknown return line: ${lineId}`);

    // Recomputed rather than trusted: a line mapped before the namespace existed
    // carries no key, and a reviewer's decision should still be remembered.
    const key =
      existing.mappingFingerprint ??
      lineTypeFingerprint(existing.schedule as RenditionScheduleKey, existing.type);

    // A correction is specifically the machine being wrong: something read this
    // line, and a person read it differently. Confirming what the model already
    // said is agreement, not a correction, and counting it as one would make the
    // model look worse the more often it was right.
    const corrected =
      existing.mappingSource !== null &&
      existing.mappingSource !== 'human' &&
      existing.categoryKey !== body.categoryKey;

    const mapping = mapFromHuman(body.categoryKey, key, body.rationale ?? null);
    const set = {
      categoryKey: mapping.categoryKey,
      mappingSource: mapping.source,
      mappingStatus: mapping.status,
      mappingConfidence: mapping.confidence,
      mappingRationale: mapping.rationale,
      mappingFingerprint: key,
      mappedBy: reviewer,
      mappedAt: now,
    };

    await tx
      .update(schema.priorReturnLines)
      .set({ ...set, isCorrected: corrected })
      .where(eq(schema.priorReturnLines.id, lineId));

    let applied = 1;
    if (body.applyToMatching && key) {
      const siblings = await tx
        .update(schema.priorReturnLines)
        .set({
          ...set,
          mappingRationale: `${mapping.rationale} Applied from a line with the same wording, settled by a reviewer.`,
        })
        .where(
          and(
            eq(schema.priorReturnLines.documentId, existing.documentId),
            eq(schema.priorReturnLines.mappingFingerprint, key),
            ne(schema.priorReturnLines.id, lineId),
            // Another reviewer's confirmed reading is not ours to overwrite.
            sql`(${schema.priorReturnLines.mappingStatus} is null or ${schema.priorReturnLines.mappingStatus} <> 'confirmed')`,
          ),
        )
        .returning({ id: schema.priorReturnLines.id });
      applied += siblings.length;
    }

    let remembered = false;
    let memoryConflict = false;
    if (body.remember && key) {
      const [document] = await tx
        .select({ engagementId: schema.priorDocuments.engagementId })
        .from(schema.priorDocuments)
        .where(eq(schema.priorDocuments.id, existing.documentId));

      const outcome = await rememberDecision(tx, {
        fingerprint: key,
        // The filer's own words, so the memory row reads like the thing it is.
        sampleDescription: `Schedule ${existing.schedule}: ${existing.type}`,
        categoryKey: body.categoryKey,
        lifeClassOverride: null,
        engagementId: document?.engagementId ?? null,
        reviewer,
        now,
      });
      remembered = outcome.remembered;
      memoryConflict = outcome.conflict;
    }

    return {
      lineId,
      categoryKey: body.categoryKey,
      corrected,
      applied,
      remembered,
      memoryConflict,
    };
  });
}

export function mappedPriorLineDto(row: PriorReturnLineRow): MappedPriorLine {
  return {
    id: row.id,
    documentId: row.documentId,
    schedule: row.schedule as RenditionScheduleKey,
    type: row.type,
    yearAcquired: row.yearAcquired,
    historicalCost: row.historicalCost,
    goodFaithEstimate: row.goodFaithEstimate,
    sourcePage: row.sourcePage,
    mapping: {
      categoryKey: row.categoryKey,
      confidence: row.mappingConfidence ?? 0,
      rationale: row.mappingRationale ?? '',
      // A line nothing has read yet is 'ai'/'needs-review' by default rather
      // than a fourth null state the UI has to special-case. The rationale is
      // empty, which is what says nothing has looked at it.
      source: (row.mappingSource as LineMappingSource | null) ?? 'ai',
      status: (row.mappingStatus as ClassificationStatus | null) ?? 'needs-review',
      fingerprint: row.mappingFingerprint,
    },
    mappedBy: row.mappedBy,
    mappedAt: row.mappedAt ? row.mappedAt.toISOString() : null,
    isCorrected: row.isCorrected,
  };
}

export interface MappedPriorDocument {
  document: PriorDocumentRow;
  lines: MappedPriorLine[];
  basis: MappedBasis;
}

/**
 * The return as read, plus what it rolls up to.
 *
 * The rollup is the point of the whole feature: reported cost by category and
 * year, on the same grain the register is classified to, so the two can finally
 * be subtracted from one another. What could not be placed is carried
 * explicitly and adds back to the reported total, so a gap in our reading can
 * never be mistaken for a gap in the client's filing.
 */
export async function fetchMappedDocument(documentId: string): Promise<MappedPriorDocument> {
  const db = requireDb();
  const [document] = await db
    .select()
    .from(schema.priorDocuments)
    .where(eq(schema.priorDocuments.id, documentId));
  if (!document) throw new HttpError(404, `Unknown prior document: ${documentId}`);

  const rows = await db
    .select()
    .from(schema.priorReturnLines)
    .where(eq(schema.priorReturnLines.documentId, documentId))
    .orderBy(
      schema.priorReturnLines.schedule,
      schema.priorReturnLines.type,
      schema.priorReturnLines.yearAcquired,
    );

  return {
    document,
    lines: rows.map(mappedPriorLineDto),
    basis: rollupMapped(
      rows.map((row) => ({
        schedule: row.schedule,
        type: row.type,
        yearAcquired: row.yearAcquired,
        historicalCost: row.historicalCost,
        goodFaithEstimate: row.goodFaithEstimate,
        categoryKey: row.categoryKey,
        mappingStatus: row.mappingStatus,
      })),
    ),
  };
}

/** What a mapping is called, for a UI that should not know about key strings. */
export { lineMappingLabel };
