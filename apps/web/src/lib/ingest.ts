import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { parseWorkbook, summarizeWorkbook } from '@tangible/far';
import type { FarFile, PriorDocumentKind, SheetSummary } from '@tangible/types';
import { uploadFarFile } from '@/lib/far-storage';
import { mediaTypeFor, runExtraction, type PriorDocumentDto } from '@/lib/priors';
import { farFileDto, fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';
import { engagementAccounts } from '@/lib/sites';

/**
 * The two intake pipelines, callable without an HTTP request in front.
 *
 * Extracted from the upload routes so multi-file intake can route a staged
 * file down exactly the pipeline a direct upload takes — same storage-first
 * ordering, same failure handling, same rows. A second copy of "how a
 * register enters the system" is how the two entrances drift apart.
 */

export interface IngestUpload {
  filename: string;
  bytes: Uint8Array;
  contentType: string | null;
}

/**
 * A register enters: store the original first, then parse. Order matters — a
 * workbook the parser chokes on is still preserved and visible as `failed`
 * with the reason, instead of vanishing.
 */
export async function ingestRegister(
  engagementId: string,
  upload: IngestUpload,
): Promise<FarFile> {
  const id = randomUUID();
  const safeName = upload.filename.replace(/[^\w.-]+/g, '_');
  const storagePath = `${engagementId}/${id}/${safeName}`;

  await uploadFarFile(storagePath, upload.bytes, upload.contentType);

  let sheetSummaries: SheetSummary[] | null = null;
  let status = 'parsed';
  let error: string | null = null;
  try {
    sheetSummaries = summarizeWorkbook(parseWorkbook(upload.bytes));
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
      originalFilename: upload.filename,
      storagePath,
      byteSize: upload.bytes.byteLength,
      checksum: createHash('sha256').update(upload.bytes).digest('hex'),
      contentType: upload.contentType,
      status,
      error,
      sheetSummaries,
    })
    .returning();

  return farFileDto(row!);
}

/**
 * A prior document enters: stored first for the same reason, then extraction
 * runs inline — one slow call on one document a couple of times a season.
 */
export async function ingestPrior(
  engagementId: string,
  upload: IngestUpload,
  kind: PriorDocumentKind,
): Promise<PriorDocumentDto> {
  const { engagement, client } = await fetchEngagement(engagementId);
  if (!mediaTypeFor(upload.filename)) {
    throw new Error(`Unsupported file type for "${upload.filename}".`);
  }

  const id = randomUUID();
  const safeName = upload.filename.replace(/[^\w.-]+/g, '_');
  const storagePath = `${engagementId}/priors/${id}/${safeName}`;
  await uploadFarFile(storagePath, upload.bytes, upload.contentType);

  const db = requireDb();
  const [row] = await db
    .insert(schema.priorDocuments)
    .values({
      id,
      engagementId,
      kind,
      originalFilename: upload.filename,
      storagePath,
      byteSize: upload.bytes.byteLength,
      checksum: createHash('sha256').update(upload.bytes).digest('hex'),
      contentType: upload.contentType,
      status: 'uploaded',
    })
    .returning();
  if (!row) throw new Error('Failed to record the uploaded document.');

  return runExtraction({
    documentId: row.id,
    clientName: client.name,
    expectedTaxYear: engagement.taxYear,
    expectedAccountIds: await engagementAccounts(engagement.id),
  });
}
