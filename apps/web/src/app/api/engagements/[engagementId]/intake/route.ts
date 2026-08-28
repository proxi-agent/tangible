import { createHash, randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { isAiConfigured, peekDocument, triageFiles, type TriageFileInput } from '@tangible/ai';
import { parseWorkbook, summarizeWorkbook } from '@tangible/far';
import { FAR_REQUEST_MAX_BYTES, FAR_UPLOAD_MAX_BYTES } from '@tangible/types';
import { mediaTypeFor } from '@/lib/priors';
import { HttpError, handle } from '@/lib/route';
import { uploadFarFile } from '@/lib/far-storage';
import { intakeFileDto } from '@/lib/intake';
import { requireEngagementScope, requirePortalRole } from '@/lib/viewer';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MAX_FILES = 20;

/**
 * The drop zone that takes everything the client sent.
 *
 * Every file is stored first — a drop is client evidence whether or not
 * anybody can read it yet — then triaged in one model call over the whole
 * batch, because the files explain each other. Nothing is routed here: the
 * rows come back as proposals, and each one waits for a person to confirm
 * which pipeline it enters. A file the workbook parser chokes on is not a
 * failure at this stage — plenty of legitimate drops are PDFs — it simply
 * carries no sheet evidence into triage.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    // Sending a register is an act, not a read: what lands here becomes the
    // return. A colleague forwarded the report link should not be able to.
    await requirePortalRole('admin');
    await fetchEngagement(engagementId);

    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      throw new HttpError(400, "Send files as multipart form-data under the 'files' field.");
    }
    if (files.length > MAX_FILES) {
      throw new HttpError(
        400,
        `That is ${files.length} files; the limit per drop is ${MAX_FILES}.`,
      );
    }
    for (const file of files) {
      if (file.size === 0) throw new HttpError(400, `"${file.name}" is empty.`);
      if (file.size > FAR_UPLOAD_MAX_BYTES) {
        throw new HttpError(
          400,
          `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${FAR_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`,
        );
      }
    }

    /**
     * Twenty files each under the per-file ceiling is still twenty files, and
     * every one of them is read into memory below. The per-file check alone
     * permits a drop no serverless platform would have accepted.
     *
     * The ceiling is genuinely different in the two places this runs, so the
     * check is too. Deployed, the platform rejects the body at the edge and
     * this line mostly documents why; on a laptop there is no such limit and
     * capping at the platform's number would refuse ten-megabyte registers
     * that work perfectly well today.
     */
    const cap =
      process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
        ? FAR_REQUEST_MAX_BYTES
        : FAR_UPLOAD_MAX_BYTES;
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > cap) {
      throw new HttpError(
        413,
        `That drop totals ${(total / 1024 / 1024).toFixed(1)} MB across ${files.length} files; ` +
          `one drop can carry ${(cap / 1024 / 1024).toFixed(1)} MB. Send them in smaller batches — ` +
          `triage reads whichever files arrive together, so keep related ones in the same drop.`,
      );
    }

    const staged = await Promise.all(
      files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const id = randomUUID();
        const safeName = file.name.replace(/[^\w.-]+/g, '_');
        const storagePath = `${engagementId}/intake/${id}/${safeName}`;
        await uploadFarFile(storagePath, bytes, file.type || null);

        // Sniff, don't judge: sheet names and header cells are triage
        // evidence, and a file that will not open as a workbook is routed on
        // its name — the model is told exactly which case it is in.
        let sheets: TriageFileInput['sheets'] = null;
        try {
          const summaries = summarizeWorkbook(parseWorkbook(bytes));
          if (summaries.length > 0) {
            sheets = summaries.map((sheet) => ({
              name: sheet.name,
              rowCount: sheet.rowCount,
              headerCells:
                sheet.detectedHeaderRow !== null
                  ? (sheet.preview[sheet.detectedHeaderRow] ?? [])
                      .map((cell) => cell ?? '')
                      .filter((cell) => cell !== '')
                  : [],
            }));
          }
        } catch {
          sheets = null;
        }

        // The first look: a PDF or image gets read once so triage can judge
        // it by its own first page instead of its filename. Failure is fine —
        // a peek that errors leaves the file exactly where it was before
        // peeks existed, judged by name with confidence told to say so.
        let peek: TriageFileInput['peek'] = null;
        const mediaType = sheets === null ? mediaTypeFor(file.name) : null;
        if (mediaType !== null && isAiConfigured()) {
          try {
            peek = (
              await peekDocument({
                filename: file.name,
                mediaType,
                data: Buffer.from(bytes).toString('base64'),
              })
            ).parsed;
          } catch {
            peek = null;
          }
        }

        return { id, file, bytes, storagePath, sheets, peek };
      }),
    );

    let decisions: Awaited<ReturnType<typeof triageFiles>>['decisions'] = staged.map(() => null);
    let model: string | null = null;
    if (isAiConfigured()) {
      try {
        const result = await triageFiles(
          staged.map((entry) => ({
            filename: entry.file.name,
            byteSize: entry.file.size,
            sheets: entry.sheets,
            peek: entry.peek,
          })),
        );
        decisions = result.decisions;
        model = result.model;
      } catch {
        // Triage failing is not the drop failing: the rows land without a
        // proposal and the person routes them by hand.
      }
    }

    const db = requireDb();
    const rows = await db
      .insert(schema.intakeFiles)
      .values(
        staged.map((entry, index) => ({
          id: entry.id,
          engagementId,
          originalFilename: entry.file.name,
          storagePath: entry.storagePath,
          byteSize: entry.file.size,
          checksum: createHash('sha256').update(entry.bytes).digest('hex'),
          contentType: entry.file.type || null,
          sheetNames: entry.sheets ? entry.sheets.map((sheet) => sheet.name) : null,
          peek: entry.peek,
          proposedRoute: decisions[index]?.route ?? null,
          proposedConfidence: decisions[index]?.confidence ?? null,
          proposedReason: decisions[index]?.reason ?? null,
          triageModel: model,
        })),
      )
      .returning();

    return { items: rows.map(intakeFileDto) };
  });
}

export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    await fetchEngagement(engagementId);

    const db = requireDb();
    const rows = await db
      .select()
      .from(schema.intakeFiles)
      .where(eq(schema.intakeFiles.engagementId, engagementId))
      .orderBy(desc(schema.intakeFiles.createdAt));

    return { items: rows.map(intakeFileDto) };
  });
}
