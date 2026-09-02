import 'server-only';
import { eq, sql } from 'drizzle-orm';
import {
  aiUnavailableReason,
  isAiConfigured,
  proposeMapping,
  proposeVerifiedMapping,
} from '@tangible/ai';
import {
  applyMapping,
  harvestHeaderDecisions,
  headersFromWorkbook,
  parseWorkbook,
  type ParsedWorkbook,
} from '@tangible/far';
import type { FarFileRow } from '@tangible/db';
import type {
  AnalysisRun,
  FarFile,
  FarMapping,
  NormalizationResult,
  SheetSummary,
} from '@tangible/types';
import { answeredAsks, syncAsks } from '@/lib/asks';
import { applyImportBatch } from '@/lib/asset-graph';
import { downloadFarFile } from '@/lib/far-storage';
import { HttpError } from '@/lib/http';
import { hintsForFile, rememberHeaderDecisions } from '@/lib/mapping-memory';
import { requestRun } from '@/lib/runs';
import { farFileDto, fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The two halves of a register becoming assets — proposing a mapping, and
 * confirming one — with no HTTP request in front of either.
 *
 * Lifted out of the route handlers for the same reason `ingestRegister` was
 * lifted out of the upload route: there are two callers now. A person clicking
 * through the mapping screen is one, and the autopilot that carries a client's
 * drop the rest of the way is the other. The moment those become two copies of
 * "how a mapping is applied" they start to differ in exactly the details that
 * matter — what gets harvested into header memory, which actor the import
 * batch records, whether a run is asked for at all.
 */

/** Skipped rows returned as examples; the count is reported in full. */
const SKIPPED_SHOWN = 50;

export interface ConfirmMappingInput {
  file: FarFileRow;
  mapping: FarMapping;
  /**
   * Who settled it. Written onto the import batch and onto the run, so a
   * mapping the autopilot confirmed stays distinguishable from one a preparer
   * confirmed without anybody having to remember which files were which.
   */
  actor: string | null;
}

export interface ConfirmMappingResult {
  normalization: NormalizationResult;
  /**
   * The run this confirm asked for, when one could be queued. The caller
   * schedules the work: a request handler hands it to `after`, and the
   * autopilot — already running behind a response — simply awaits it.
   */
  run: AnalysisRun | null;
}

/**
 * Ask the model what these columns mean.
 *
 * Everything the proposal is allowed to know arrives here: the answers the
 * client has already given, and the headers this firm has already settled.
 * Conflicted headers are held back on purpose — a header two reviewers read
 * differently is the one the model should decide from the rows, and the one a
 * person should be shown.
 */
export async function proposeForFile(file: FarFileRow): Promise<FarFile> {
  const summaries = file.sheetSummaries as SheetSummary[] | null;
  if (!summaries) {
    throw new HttpError(409, 'This file has no parsed sheets to map — re-upload it first.');
  }
  if (!isAiConfigured()) {
    throw new HttpError(
      503,
      `AI proposals are off. ${aiUnavailableReason()} Map the columns manually, or add a key to .env.`,
    );
  }

  // The verified loop needs the actual rows, not the preview: it applies the
  // proposal and foots the result. If the stored bytes cannot be re-read —
  // storage hiccup, stale path — fall back to the single-shot proposal
  // rather than failing a request the preview alone could still serve.
  let workbook: ParsedWorkbook | null = null;
  try {
    workbook = parseWorkbook(await downloadFarFile(file.storagePath));
  } catch {
    workbook = null;
  }

  // The return leg of the asks loop: answers collected since the last
  // proposal go back in as fact, so re-proposing after the client replies is
  // how an answer becomes a mapping.
  const answers = await answeredAsks(file.id);

  const hints = await hintsForFile(file);
  const memory = [
    ...new Map(
      hints
        .filter((hint) => !hint.conflicted)
        .map((hint) => [
          `${hint.header}\u0000${hint.field}`,
          { header: hint.header, field: hint.field, confirmations: hint.confirmations },
        ]),
    ).values(),
  ];

  let result;
  try {
    const context = { filename: file.originalFilename, answers, memory };
    result = workbook
      ? await proposeVerifiedMapping(workbook, summaries, context)
      : await proposeMapping(summaries, context);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `The mapping proposal failed: ${message}`);
  }

  const db = requireDb();
  const [updated] = await db
    .update(schema.farFiles)
    .set({
      proposal: result.proposal,
      proposalModel: result.model,
      // Decided against the row as it stands now, not as it stood before the
      // model call: a confirm that landed during those seconds has already
      // normalized this file, and rewriting it back to 'proposed' would erase
      // that. A proposal only ever advances a file still awaiting a mapping.
      status: sql`case when ${schema.farFiles.status} = 'parsed' then 'proposed' else ${schema.farFiles.status} end`,
      updatedAt: new Date(),
    })
    .where(eq(schema.farFiles.id, file.id))
    .returning();

  await syncAsks(file.id, result.proposal.asks ?? []);

  return farFileDto(updated!);
}

/**
 * Confirm a mapping and fold the result into the client's asset graph.
 *
 * Re-read the stored original, apply the confirmed mapping deterministically,
 * then compare the rows against what the client's graph already holds rather
 * than replacing them. Two things follow from that, and both of them are the
 * point of the change.
 *
 * A corrected mapping no longer costs the classification work. The assets those
 * decisions were made about are the same durable rows before and after, so
 * fixing a header row does not send a reviewer back through five hundred lines.
 *
 * And an upload of next year's register produces a history instead of a second
 * copy of the company. What appeared, what stopped appearing, what got cheaper
 * and what moved counties are all recorded as events on assets that have been
 * there the whole time.
 */
export async function confirmMapping(input: ConfirmMappingInput): Promise<ConfirmMappingResult> {
  const { file, mapping, actor } = input;
  const { engagement } = await fetchEngagement(file.engagementId);

  const bytes = await downloadFarFile(file.storagePath);
  const workbook = parseWorkbook(bytes);
  const { assets: drafts, skipped } = applyMapping(workbook, mapping);

  const warningCount = drafts.filter((d) => d.warnings.length > 0).length;
  const totalCost = drafts.reduce((sum, d) => sum + (d.originalCost ?? 0), 0);

  const batch = await applyImportBatch({
    engagementId: file.engagementId,
    clientId: engagement.clientId,
    taxYear: engagement.taxYear,
    farFileId: file.id,
    mapping,
    drafts,
    skippedCount: skipped.length,
    actor,
  });

  /**
   * The confirm is the moment these headers were settled — the proposal was a
   * guess and the grid was a draft — so the headers are harvested here, from
   * the workbook rather than the preview, which is how a column past the
   * preview's fortieth is learned from at all.
   *
   * Best-effort for the same reason the run is: the assets are already in the
   * graph, and a memory write that failed must not fail an import that
   * worked. The next confirm of the same header will teach it again.
   */
  let learned: { headers: number; conflicts: number } | undefined;
  try {
    const remembered = await rememberHeaderDecisions({
      decisions: harvestHeaderDecisions(headersFromWorkbook(workbook, mapping), mapping),
      farFileId: file.id,
      reviewer: actor,
      now: new Date(),
    });
    learned = { headers: remembered.remembered, conflicts: remembered.conflicts };
  } catch (error) {
    console.error('[files] imported, but the header memory was not updated', file.id, error);
  }

  const db = requireDb();
  await db
    .update(schema.farFiles)
    .set({
      confirmedMapping: mapping,
      status: 'normalized',
      error: null,
      assetCount: batch.assetCount,
      updatedAt: new Date(),
    })
    .where(eq(schema.farFiles.id, file.id));

  /**
   * A confirmed register is the event the client is actually waiting on, so
   * this is where the report gets asked for. Best-effort on purpose: a run
   * that could not be queued must not undo an import that succeeded — the
   * assets are in the graph either way, and the next request or the reaper
   * will produce the report.
   */
  let run: AnalysisRun | null = null;
  try {
    run = await requestRun(file.engagementId, 'upload', actor);
  } catch (error) {
    console.error('[files] imported, but the report run could not be queued', file.id, error);
  }

  return {
    run,
    normalization: {
      inserted: batch.assetCount,
      skipped: skipped.slice(0, SKIPPED_SHOWN),
      skippedCount: skipped.length,
      warningCount,
      totalCost,
      batchId: batch.batchId,
      newCount: batch.newCount,
      matchedCount: batch.matchedCount,
      changedCount: batch.changedCount,
      absentCount: batch.absentCount,
      learned,
    },
  };
}
