import { createHash, randomUUID } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import {
  PRIOR_DOCUMENT_KINDS,
  PRIOR_UPLOAD_EXTENSIONS,
  FAR_UPLOAD_MAX_BYTES,
  type PriorDocumentKind,
} from '@tangible/types';
import { HttpError, handle } from '@/lib/route';
import { uploadFarFile } from '@/lib/far-storage';
import { mediaTypeFor, priorDocumentDto, runExtraction } from '@/lib/priors';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Upload last year's rendition or an assessment notice.
 *
 * Stores the original in the private bucket first and extracts second, the same
 * order the register intake uses and for the same reason: a document the model
 * chokes on is still preserved and visible as `failed` with the reason on it,
 * rather than vanishing along with the attempt to read it.
 *
 * Extraction runs inline. It is one call on one document a couple of times a
 * season, which does not justify a job queue — but it is a slow call on a
 * scanned form, hence the raised duration.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const { engagement, client } = await fetchEngagement(engagementId);

    const form = await request.formData();
    const file = form.get('file');
    const kind = String(form.get('kind') ?? 'rendition') as PriorDocumentKind;

    if (!(PRIOR_DOCUMENT_KINDS as readonly string[]).includes(kind)) {
      throw new HttpError(
        400,
        `Unknown document kind "${kind}" — expected one of ${PRIOR_DOCUMENT_KINDS.join(', ')}.`,
      );
    }
    if (!(file instanceof File)) {
      throw new HttpError(400, "Send the document as multipart form-data under the 'file' field.");
    }
    if (file.size === 0) throw new HttpError(400, 'The uploaded file is empty.');
    if (file.size > FAR_UPLOAD_MAX_BYTES) {
      throw new HttpError(
        400,
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${FAR_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`,
      );
    }
    if (!mediaTypeFor(file.name)) {
      throw new HttpError(
        400,
        `Unsupported file type for "${file.name}" — accepted: ${PRIOR_UPLOAD_EXTENSIONS.join(', ')}.`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const id = randomUUID();
    const safeName = file.name.replace(/[^\w.-]+/g, '_');
    const storagePath = `${engagementId}/priors/${id}/${safeName}`;
    await uploadFarFile(storagePath, bytes, file.type || null);

    const db = requireDb();
    const [row] = await db
      .insert(schema.priorDocuments)
      .values({
        id,
        engagementId,
        kind,
        originalFilename: file.name,
        storagePath,
        byteSize: file.size,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        contentType: file.type || null,
        status: 'uploaded',
      })
      .returning();
    if (!row) throw new Error('Failed to record the uploaded document.');

    return runExtraction({
      documentId: row.id,
      clientName: client.name,
      expectedTaxYear: engagement.taxYear,
      expectedAccountId: engagement.accountId,
    });
  });
}

export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);

    const db = requireDb();
    const rows = await db
      .select({
        document: schema.priorDocuments,
        lineCount: sql<number>`(
          select count(*)::int from prior_return_lines l
          where l.document_id = ${schema.priorDocuments.id}
        )`,
      })
      .from(schema.priorDocuments)
      .where(eq(schema.priorDocuments.engagementId, engagementId))
      .orderBy(desc(schema.priorDocuments.createdAt));

    return { items: rows.map((r) => priorDocumentDto(r.document, r.lineCount ?? 0)) };
  });
}
