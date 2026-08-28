import { eq } from 'drizzle-orm';
import { after } from 'next/server';
import { applyMapping, parseWorkbook } from '@tangible/far';
import { ConfirmMappingRequestSchema, type NormalizationResult } from '@tangible/types';
import { handle } from '@/lib/route';
import { applyImportBatch } from '@/lib/asset-graph';
import { downloadFarFile } from '@/lib/far-storage';
import { executeRun, requestRun } from '@/lib/runs';
import { fetchEngagement, fetchFarFile } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SKIPPED_SHOWN = 50;

/**
 * Confirm a mapping and fold the result into the client's asset graph.
 *
 * Re-read the stored original, apply the human-confirmed mapping
 * deterministically, then compare the rows against what the client's graph
 * already holds rather than replacing them. Two things follow from that, and
 * both of them are the point of the change.
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
export function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  return handle(async (): Promise<NormalizationResult> => {
    const { fileId } = await params;
    const { mapping } = ConfirmMappingRequestSchema.parse(await request.json());
    const row = await fetchFarFile(fileId);
    const { engagement } = await fetchEngagement(row.engagementId);

    const bytes = await downloadFarFile(row.storagePath);
    const workbook = parseWorkbook(bytes);
    const { assets: drafts, skipped } = applyMapping(workbook, mapping);

    const warningCount = drafts.filter((d) => d.warnings.length > 0).length;
    const totalCost = drafts.reduce((sum, d) => sum + (d.originalCost ?? 0), 0);

    const batch = await applyImportBatch({
      engagementId: row.engagementId,
      clientId: engagement.clientId,
      taxYear: engagement.taxYear,
      farFileId: fileId,
      mapping,
      drafts,
      skippedCount: skipped.length,
      actor: row.uploadedBy,
    });

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
      .where(eq(schema.farFiles.id, fileId));

    /**
     * A confirmed register is the event the client is actually waiting on, so
     * this is where the report gets made. It runs after the response, and the
     * mapping screen does not wait on it — the caller gets its normalization
     * summary immediately and the portal follows the run.
     *
     * Best-effort on purpose. A run that could not be queued must not undo an
     * import that succeeded: the assets are in the graph either way, and the
     * next request or the reaper will produce the report.
     */
    try {
      const run = await requestRun(row.engagementId, 'upload', row.uploadedBy);
      if (run.status === 'queued') after(() => executeRun(run.id));
    } catch (error) {
      console.error('[files] imported, but the report run could not be queued', fileId, error);
    }

    return {
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
    };
  });
}
