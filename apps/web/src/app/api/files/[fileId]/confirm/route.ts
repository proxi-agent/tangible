import { eq } from 'drizzle-orm';
import { applyMapping, parseWorkbook } from '@tangible/far';
import { ConfirmMappingRequestSchema, type NormalizationResult } from '@tangible/types';
import { handle } from '@/lib/route';
import { applyImportBatch } from '@/lib/asset-graph';
import { downloadFarFile } from '@/lib/far-storage';
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
