import { count, desc, eq, inArray } from 'drizzle-orm';
import {
  PRIOR_DOCUMENT_KINDS,
  PRIOR_UPLOAD_EXTENSIONS,
  FAR_UPLOAD_MAX_BYTES,
  type PriorDocumentKind,
} from '@tangible/types';
import { HttpError, handle } from '@/lib/route';
import { ingestPrior } from '@/lib/ingest';
import { mediaTypeFor, priorDocumentDto } from '@/lib/priors';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Upload last year's rendition or an assessment notice. The pipeline itself —
 * store first, extract second — lives in {@link ingestPrior}, shared with
 * multi-file intake routing; this route is the HTTP validation in front.
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
    return ingestPrior(
      engagementId,
      { filename: file.name, bytes, contentType: file.type || null },
      kind,
    );
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
      .select()
      .from(schema.priorDocuments)
      .where(eq(schema.priorDocuments.engagementId, engagementId))
      .orderBy(desc(schema.priorDocuments.createdAt));

    // Counted in a second grouped query rather than a correlated subselect: an
    // engagement holds a handful of documents a season, and a typed aggregate
    // is worth more here than saving one round trip.
    const counts = new Map<string, number>();
    if (rows.length > 0) {
      const grouped = await db
        .select({
          documentId: schema.priorReturnLines.documentId,
          lineCount: count(),
        })
        .from(schema.priorReturnLines)
        .where(
          inArray(
            schema.priorReturnLines.documentId,
            rows.map((row) => row.id),
          ),
        )
        .groupBy(schema.priorReturnLines.documentId);
      for (const row of grouped) counts.set(row.documentId, row.lineCount);
    }

    return {
      items: rows.map((row) => priorDocumentDto(row, counts.get(row.id) ?? 0)),
    };
  });
}
