import { createHash, randomUUID } from 'node:crypto';
import { parseWorkbook, summarizeWorkbook } from '@tangible/far';
import { FAR_UPLOAD_EXTENSIONS, FAR_UPLOAD_MAX_BYTES, type SheetSummary } from '@tangible/types';
import { HttpError, handle } from '@/lib/route';
import { uploadFarFile } from '@/lib/far-storage';
import { farFileDto, fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Upload a FAR file: store the original in the private bucket first, then
 * parse. Order matters — a workbook the parser chokes on is still preserved
 * and visible as `failed` with the reason, instead of vanishing.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new HttpError(400, "Send the register as multipart form-data under the 'file' field.");
    }
    if (file.size === 0) throw new HttpError(400, 'The uploaded file is empty.');
    if (file.size > FAR_UPLOAD_MAX_BYTES) {
      throw new HttpError(
        400,
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${FAR_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`,
      );
    }
    const dot = file.name.lastIndexOf('.');
    const extension = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
    if (!(FAR_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new HttpError(
        400,
        `Unsupported file type "${extension || file.name}" — accepted: ${FAR_UPLOAD_EXTENSIONS.join(', ')}.`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = randomUUID();
    const safeName = file.name.replace(/[^\w.-]+/g, '_');
    const storagePath = `${engagementId}/${id}/${safeName}`;

    await uploadFarFile(storagePath, bytes, file.type || null);

    let sheetSummaries: SheetSummary[] | null = null;
    let status = 'parsed';
    let error: string | null = null;
    try {
      sheetSummaries = summarizeWorkbook(parseWorkbook(bytes));
      if (sheetSummaries.length === 0) {
        status = 'failed';
        error = 'The workbook contains no sheets.';
        sheetSummaries = null;
      }
    } catch (cause) {
      status = 'failed';
      error = cause instanceof Error ? cause.message : String(cause);
    }

    const db = requireDb();
    const [row] = await db
      .insert(schema.farFiles)
      .values({
        id,
        engagementId,
        originalFilename: file.name,
        storagePath,
        byteSize: file.size,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        contentType: file.type || null,
        status,
        error,
        sheetSummaries,
      })
      .returning();

    return farFileDto(row!);
  });
}
