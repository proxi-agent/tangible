import { eq, sql } from 'drizzle-orm';
import {
  aiUnavailableReason,
  isAiConfigured,
  proposeMapping,
  proposeVerifiedMapping,
} from '@tangible/ai';
import { parseWorkbook, type ParsedWorkbook } from '@tangible/far';
import type { SheetSummary } from '@tangible/types';
import { answeredAsks, syncAsks } from '@/lib/asks';
import { hintsForFile } from '@/lib/mapping-memory';
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

    // The return leg of the asks loop: answers collected since the last
    // proposal go back in as fact, so re-proposing after the client replies is
    // how an answer becomes a mapping.
    const answers = await answeredAsks(fileId);

    /**
     * What the firm has already settled about these headers, deduped to a
     * vocabulary. Conflicted rows are held back: a header two reviewers read
     * differently is exactly the one the model should decide for itself from
     * the rows, and the review grid shows the disagreement to a person anyway.
     */
    const hints = await hintsForFile(row);
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
      const context = { filename: row.originalFilename, answers, memory };
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
      .where(eq(schema.farFiles.id, fileId))
      .returning();

    await syncAsks(fileId, result.proposal.asks ?? []);

    return farFileDto(updated!);
  });
}
