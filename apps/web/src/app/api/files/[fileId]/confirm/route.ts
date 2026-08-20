import { eq, sql } from 'drizzle-orm';
import { applyMapping, parseWorkbook } from '@tangible/far';
import { ConfirmMappingRequestSchema, type NormalizationResult } from '@tangible/types';
import { handle } from '@/lib/route';
import { downloadFarFile } from '@/lib/far-storage';
import { fetchFarFile } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const INSERT_CHUNK = 500;
const SKIPPED_SHOWN = 50;

/**
 * Confirm a mapping and normalize: re-read the stored original, apply the
 * human-confirmed mapping deterministically, and replace this file's assets
 * wholesale in one transaction. Re-confirming with a corrected mapping is
 * therefore always safe — there is no partial state to reconcile.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  return handle(async (): Promise<NormalizationResult> => {
    const { fileId } = await params;
    const { mapping } = ConfirmMappingRequestSchema.parse(await request.json());
    const row = await fetchFarFile(fileId);

    const bytes = await downloadFarFile(row.storagePath);
    const workbook = parseWorkbook(bytes);
    const { assets: drafts, skipped } = applyMapping(workbook, mapping);

    const warningCount = drafts.filter((d) => d.warnings.length > 0).length;
    const totalCost = drafts.reduce((sum, d) => sum + (d.originalCost ?? 0), 0);

    const db = requireDb();
    await db.transaction(async (tx) => {
      // Serialize confirms of the same file. Two overlapping requests — the file
      // open in two tabs, a double submit, a retry after a timeout whose first
      // attempt actually landed — would each delete only the rows their own
      // snapshot could see and then both insert a full set, silently doubling
      // every asset and every total derived from them.
      await tx.execute(sql`select id from far_files where id = ${fileId} for update`);

      await tx.delete(schema.assets).where(eq(schema.assets.farFileId, fileId));
      for (let i = 0; i < drafts.length; i += INSERT_CHUNK) {
        const chunk = drafts.slice(i, i + INSERT_CHUNK);
        await tx.insert(schema.assets).values(
          chunk.map((draft) => ({
            ...draft,
            engagementId: row.engagementId,
            farFileId: fileId,
          })),
        );
      }
      await tx
        .update(schema.farFiles)
        .set({
          confirmedMapping: mapping,
          status: 'normalized',
          error: null,
          assetCount: drafts.length,
          updatedAt: new Date(),
        })
        .where(eq(schema.farFiles.id, fileId));
    });

    return {
      inserted: drafts.length,
      skipped: skipped.slice(0, SKIPPED_SHOWN),
      skippedCount: skipped.length,
      warningCount,
      totalCost,
    };
  });
}
