import { eq, sql } from 'drizzle-orm';
import {
  aiUnavailableReason,
  isAiConfigured,
  proposeMapping,
  proposeVerifiedMapping,
} from '@tangible/ai';
import { parseWorkbook, type ParsedWorkbook } from '@tangible/far';
import type { SheetSummary } from '@tangible/types';
import { downloadFarFile } from '@/lib/far-storage';
import { HttpError, handle } from '@/lib/route';
import { farFileDto, fetchFarFile } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { fileId } = await params;
    const row = await fetchFarFile(fileId);

    const summaries = row.sheetSummaries as SheetSummary[] | null;
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
      const bytes = await downloadFarFile(row.storagePath);
      workbook = parseWorkbook(bytes);
    } catch {
      workbook = null;
    }

    let result;
    try {
      result = workbook
        ? await proposeVerifiedMapping(workbook, summaries, { filename: row.originalFilename })
        : await proposeMapping(summaries, { filename: row.originalFilename });
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
      .where(eq(schema.farFiles.id, fileId))
      .returning();

    return farFileDto(updated!);
  });
}
