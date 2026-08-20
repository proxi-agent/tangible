import 'server-only';
import { eq } from 'drizzle-orm';
import type { PriorDocumentRow, PriorReturnLineRow } from '@tangible/db';
import { extractNotice, extractRendition, isAiConfigured } from '@tangible/ai';
import { verifyRendition } from '@tangible/filing';
import type {
  ExtractedNotice,
  ExtractedRendition,
  FootingResult,
  PriorDocumentKind,
} from '@tangible/types';
import { downloadFarFile } from '@/lib/far-storage';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Reading a prior filing into the engagement.
 *
 * Two steps that are deliberately separate: the model reads the document, and
 * then plain arithmetic checks whether what it read adds up. The check is only
 * worth something because it is independent — a schedule's printed total
 * against the sum of its own lines, both read from the page rather than one
 * derived from the other.
 *
 * A document that does not foot is stored anyway, with its discrepancies
 * named. Filers make arithmetic errors, and a prior return whose schedules do
 * not add up may be worth more than anything in the register. What a
 * discrepancy withholds is the right to be treated as a settled baseline until
 * someone has looked.
 */

const iso = (d: Date) => d.toISOString();

export interface PriorDocumentDto {
  id: string;
  engagementId: string;
  kind: PriorDocumentKind;
  originalFilename: string;
  byteSize: number;
  status: string;
  error: string | null;
  documentTaxYear: number | null;
  documentAccountId: string | null;
  extracted: ExtractedRendition | ExtractedNotice | null;
  footing: FootingResult | null;
  statedTotal: number | null;
  derivedTotal: number | null;
  extractionModel: string | null;
  lineCount: number;
  createdAt: string;
  updatedAt: string;
}

export function priorDocumentDto(row: PriorDocumentRow, lineCount = 0): PriorDocumentDto {
  return {
    id: row.id,
    engagementId: row.engagementId,
    kind: row.kind as PriorDocumentKind,
    originalFilename: row.originalFilename,
    byteSize: row.byteSize,
    status: row.status,
    error: row.error,
    documentTaxYear: row.documentTaxYear,
    documentAccountId: row.documentAccountId,
    extracted: (row.extracted as ExtractedRendition | ExtractedNotice | null) ?? null,
    footing: (row.footing as FootingResult | null) ?? null,
    statedTotal: row.statedTotal,
    derivedTotal: row.derivedTotal,
    extractionModel: row.extractionModel,
    lineCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function priorLineDto(row: PriorReturnLineRow) {
  return {
    id: row.id,
    schedule: row.schedule,
    type: row.type,
    yearAcquired: row.yearAcquired,
    historicalCost: row.historicalCost,
    goodFaithEstimate: row.goodFaithEstimate,
    sourcePage: row.sourcePage,
    categoryKey: row.categoryKey,
    isCorrected: row.isCorrected,
  };
}

/** Media types the providers read directly. Anything else never reaches a model. */
const MEDIA_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

export function mediaTypeFor(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  const extension = dot === -1 ? '' : filename.slice(dot).toLowerCase();
  return MEDIA_BY_EXTENSION[extension] ?? null;
}

export interface ExtractOptions {
  documentId: string;
  clientName: string | null;
  expectedTaxYear: number | null;
  expectedAccountId: string | null;
}

/**
 * Run extraction for a stored document and write down what came back.
 *
 * Every exit here leaves the row in a state that says what happened. A failed
 * extraction is `failed` with the reason on it rather than a row that silently
 * never finishes — the document is already in the bucket and a person can look
 * at it, which is the whole reason the upload stores before it parses.
 */
export async function runExtraction(options: ExtractOptions): Promise<PriorDocumentDto> {
  const db = requireDb();
  const [row] = await db
    .select()
    .from(schema.priorDocuments)
    .where(eq(schema.priorDocuments.id, options.documentId));
  if (!row) throw new Error(`Unknown prior document: ${options.documentId}`);

  if (!isAiConfigured()) {
    // Not a failure of the document. The row stays as uploaded so a later run
    // with a key configured picks it up, exactly like a failed classification
    // batch writing no row at all.
    return priorDocumentDto(row);
  }

  const mediaType = mediaTypeFor(row.originalFilename) ?? row.contentType;
  if (!mediaType || !Object.values(MEDIA_BY_EXTENSION).includes(mediaType)) {
    return finish(row.id, {
      status: 'failed',
      error: `Cannot read "${row.originalFilename}" — extraction needs a PDF or an image.`,
    });
  }

  const bytes = await downloadFarFile(row.storagePath);
  const document = {
    filename: row.originalFilename,
    mediaType,
    data: Buffer.from(bytes).toString('base64'),
  };

  try {
    if (row.kind === 'notice') {
      const { parsed, model } = await extractNotice(document, { clientName: options.clientName });
      return finish(row.id, {
        status: 'verified',
        extracted: parsed,
        extractionModel: model,
        documentTaxYear: parsed.taxYear,
        documentAccountId: parsed.accountId,
        statedTotal: parsed.assessedValue ?? parsed.appraisedValue ?? null,
      });
    }

    const { parsed, model } = await extractRendition(document, {
      clientName: options.clientName,
      expectedTaxYear: options.expectedTaxYear,
    });
    const footing = verifyRendition(parsed, {
      expectedTaxYear: options.expectedTaxYear,
      expectedAccountId: options.expectedAccountId,
    });

    // Lines are replaced wholesale: a re-extraction is a fresh reading of the
    // same page, and merging two readings would leave rows nobody can attribute
    // to either one.
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.priorReturnLines)
        .where(eq(schema.priorReturnLines.documentId, row.id));
      const lines = parsed.schedules.flatMap((schedule) =>
        schedule.lines.map((line) => ({
          documentId: row.id,
          schedule: schedule.key,
          type: line.type,
          yearAcquired: line.yearAcquired,
          historicalCost: line.historicalCost,
          goodFaithEstimate: line.goodFaithEstimate,
          sourcePage: line.sourcePage,
        })),
      );
      const CHUNK = 500;
      for (let i = 0; i < lines.length; i += CHUNK) {
        if (lines.length > 0)
          await tx.insert(schema.priorReturnLines).values(lines.slice(i, i + CHUNK));
      }
    });

    return finish(row.id, {
      status: footing.status,
      extracted: parsed,
      footing,
      extractionModel: model,
      documentTaxYear: parsed.taxYear,
      documentAccountId: parsed.accountId,
      statedTotal: footing.statedTotal,
      derivedTotal: footing.derivedTotal,
    });
  } catch (cause) {
    return finish(row.id, {
      status: 'failed',
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

async function finish(
  documentId: string,
  patch: Partial<{
    status: string;
    error: string | null;
    extracted: unknown;
    footing: unknown;
    extractionModel: string;
    documentTaxYear: number | null;
    documentAccountId: string | null;
    statedTotal: number | null;
    derivedTotal: number | null;
  }>,
): Promise<PriorDocumentDto> {
  const db = requireDb();
  const [updated] = await db
    .update(schema.priorDocuments)
    .set({ error: null, ...patch, updatedAt: new Date() })
    .where(eq(schema.priorDocuments.id, documentId))
    .returning();
  if (!updated) throw new Error(`Unknown prior document: ${documentId}`);

  const lines = await db
    .select({ id: schema.priorReturnLines.id })
    .from(schema.priorReturnLines)
    .where(eq(schema.priorReturnLines.documentId, documentId));

  return priorDocumentDto(updated, lines.length);
}
