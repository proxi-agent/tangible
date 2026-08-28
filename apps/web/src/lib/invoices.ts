import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { extractInvoice, isAiConfigured } from '@tangible/ai';
import { ruleLine, splitForAsset, splitInvoice, type SplitLine } from '@tangible/savings';
import type {
  ExtractedInvoice,
  InvoiceAssetLink,
  InvoiceDetail,
  InvoiceDocument,
  InvoiceLineRecord,
  InvoiceList,
} from '@tangible/types';
import { downloadFarFile, uploadFarFile } from '@/lib/far-storage';
import { HttpError } from '@/lib/route';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The invoice behind the capitalized line.
 *
 * This is the only detector in the product whose evidence does not come from
 * the register, and the pipeline reflects that. Four steps, each of which can
 * be inspected and none of which silently feeds the next:
 *
 *   1. **Read.** A vision model returns the vendor's lines verbatim with its own
 *      confidence per row. Nothing is interpreted here.
 *   2. **Rule.** A jurisdiction rule table decides what each line is for tax.
 *      Deterministic, readable, and arguable — which is what a position taken in
 *      front of an appraiser has to be.
 *   3. **Link.** A matcher proposes which register rows this invoice paid for.
 *      It proposes; it never decides. A misattributed invoice would move money
 *      from one asset to another and read as a saving either way.
 *   4. **Split.** Only confirmed links against extracted documents reach the
 *      engine, and the engine discounts what nobody has reviewed.
 *
 * The gate between 3 and 4 is the important one. Everything else in this
 * product can be wrong and produce a finding somebody argues with; a wrong link
 * produces a finding that looks exactly like a right one.
 */

const MEDIA_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function invoiceMediaTypeFor(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  return MEDIA_BY_EXTENSION[dot === -1 ? '' : filename.slice(dot).toLowerCase()] ?? null;
}

/**
 * When a reading is good enough to price without a person.
 *
 * Two ways to fail it, and they are different failures. A weak `confidence`
 * means we may have misread the page. A high `unclear` share means we read it
 * fine and the rules did not recognize what they saw — a $46,000 line saying
 * "PROJECT SERVICES" is not a reading problem, it is a question for the
 * controller. Both route to the same queue because both need the same thing:
 * somebody who can look at the document.
 */
const TRUST_CONFIDENCE = 0.7;
const TRUST_UNCLEAR_SHARE = 0.25;

type DocumentRow = typeof schema.invoiceDocuments.$inferSelect;
type LineRow = typeof schema.invoiceLines.$inferSelect;

export function invoiceDocumentDto(row: DocumentRow): InvoiceDocument {
  return {
    id: row.id,
    engagementId: row.engagementId,
    originalFilename: row.originalFilename,
    byteSize: row.byteSize,
    contentType: row.contentType,
    status: row.status,
    error: row.error,
    vendorName: row.vendorName,
    invoiceNumber: row.invoiceNumber,
    invoiceDate: row.invoiceDate,
    purchaseOrder: row.purchaseOrder,
    statedTotal: row.statedTotal,
    derivedTotal: row.derivedTotal,
    extractionConfidence: row.extractionConfidence,
    extractionModel: row.extractionModel,
    unreadable: (row.unreadable as string[] | null) ?? [],
    uploadedBy: row.uploadedBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function invoiceLineDto(row: LineRow): InvoiceLineRecord {
  return {
    id: row.id,
    documentId: row.documentId,
    lineNumber: row.lineNumber,
    description: row.description,
    amount: row.amount,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    partNumber: row.partNumber,
    sourcePage: row.sourcePage,
    readConfidence: row.readConfidence,
    treatment: row.treatment as InvoiceLineRecord['treatment'],
    treatmentReason: row.treatmentReason,
    treatmentAuthority: row.treatmentAuthority,
    treatmentSource: row.treatmentSource,
    treatmentConfidence: row.treatmentConfidence,
    isCorrected: row.isCorrected,
  };
}

/* -------------------------------------------------------------------------- */
/*  Read and rule                                                             */
/* -------------------------------------------------------------------------- */

/**
 * An invoice enters: store the original first, then read it.
 *
 * Same ordering as the register and the prior-year rendition, for the same
 * reason — a document the model chokes on is still preserved and visible as
 * `failed` with the reason on it, rather than vanishing. It also matters more
 * here than anywhere else: the invoice is the *only* evidence for the position
 * it supports, so a copy of it has to survive a bad extraction.
 */
export async function ingestInvoice(
  engagementId: string,
  upload: { filename: string; bytes: Uint8Array; contentType: string | null },
  context: { clientName: string | null; jurisdictionId: string | null; uploadedBy: string | null },
): Promise<InvoiceDocument> {
  if (!invoiceMediaTypeFor(upload.filename)) {
    throw new HttpError(
      400,
      `Cannot read "${upload.filename}" — reading an invoice needs a PDF or an image.`,
    );
  }

  const id = randomUUID();
  const safeName = upload.filename.replace(/[^\w.-]+/g, '_');
  const storagePath = `${engagementId}/invoices/${id}/${safeName}`;
  await uploadFarFile(storagePath, upload.bytes, upload.contentType);

  const db = requireDb();
  const [row] = await db
    .insert(schema.invoiceDocuments)
    .values({
      id,
      engagementId,
      originalFilename: upload.filename,
      storagePath,
      byteSize: upload.bytes.byteLength,
      checksum: createHash('sha256').update(upload.bytes).digest('hex'),
      contentType: upload.contentType,
      status: 'uploaded',
      uploadedBy: context.uploadedBy,
    })
    .returning();
  if (!row) throw new HttpError(500, 'Failed to record the uploaded invoice.');

  return runInvoiceExtraction(row.id, {
    clientName: context.clientName,
    jurisdictionId: context.jurisdictionId,
  });
}

export async function runInvoiceExtraction(
  documentId: string,
  context: { clientName: string | null; jurisdictionId: string | null },
): Promise<InvoiceDocument> {
  const db = requireDb();
  const [row] = await db
    .select()
    .from(schema.invoiceDocuments)
    .where(eq(schema.invoiceDocuments.id, documentId));
  if (!row) throw new HttpError(404, 'That invoice is not on this engagement.');

  if (!isAiConfigured()) {
    // Not a failure of the document — the file is stored and a later run with a
    // key configured picks it up. Same rule as the rendition pipeline.
    return invoiceDocumentDto(row);
  }

  const mediaType = invoiceMediaTypeFor(row.originalFilename) ?? row.contentType;
  if (!mediaType || !Object.values(MEDIA_BY_EXTENSION).includes(mediaType)) {
    return finish(row.id, {
      status: 'failed',
      error: `Cannot read "${row.originalFilename}" — reading an invoice needs a PDF or an image.`,
    });
  }

  const bytes = await downloadFarFile(row.storagePath);
  try {
    const { parsed, model } = await extractInvoice(
      {
        filename: row.originalFilename,
        mediaType,
        data: Buffer.from(bytes).toString('base64'),
      },
      { clientName: context.clientName },
    );
    return await recordExtraction(row, parsed, model, context.jurisdictionId);
  } catch (cause) {
    return finish(row.id, {
      status: 'failed',
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

async function recordExtraction(
  row: DocumentRow,
  parsed: ExtractedInvoice,
  model: string,
  jurisdictionId: string | null,
): Promise<InvoiceDocument> {
  const db = requireDb();
  const ruled = parsed.lines.map((line, index) => {
    const ruling = ruleLine(line.description, jurisdictionId);
    return {
      documentId: row.id,
      lineNumber: index + 1,
      description: line.description,
      amount: line.amount,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      partNumber: line.partNumber,
      sourcePage: line.sourcePage,
      readConfidence: line.confidence,
      treatment: ruling.treatment,
      treatmentReason: ruling.reason,
      treatmentAuthority: ruling.authority,
      treatmentSource: 'rule',
      treatmentConfidence: ruling.confidence,
      ruleId: ruling.ruleId,
    };
  });

  const split = splitInvoice(
    ruled.map((line) => ({
      description: line.description,
      amount: line.amount,
      treatment: line.treatment,
      readConfidence: line.readConfidence,
      treatmentConfidence: line.treatmentConfidence,
    })),
  );

  // Lines are replaced wholesale. A re-extraction is a fresh reading of the
  // same page, and merging two readings leaves rows nobody can attribute to
  // either — including, worse, a corrected treatment sitting on a description
  // the new reading no longer contains.
  await db.transaction(async (tx) => {
    await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.documentId, row.id));
    const CHUNK = 500;
    for (let i = 0; i < ruled.length; i += CHUNK) {
      await tx.insert(schema.invoiceLines).values(ruled.slice(i, i + CHUNK));
    }
  });

  const unclearShare = split.total > 0 ? split.unclear / split.total : 0;
  const trusted = split.confidence >= TRUST_CONFIDENCE && unclearShare <= TRUST_UNCLEAR_SHARE;

  const document = await finish(row.id, {
    status: parsed.lines.length === 0 ? 'needs-review' : trusted ? 'extracted' : 'needs-review',
    extracted: parsed,
    extractionModel: model,
    extractionConfidence: split.confidence,
    vendorName: parsed.vendorName,
    invoiceNumber: parsed.invoiceNumber,
    invoiceDate: parsed.invoiceDate,
    billedTo: parsed.billedTo,
    purchaseOrder: parsed.purchaseOrder,
    statedTotal: parsed.statedTotal,
    derivedTotal: split.total,
    unreadable: parsed.unreadable,
  });

  // Suggesting a link is cheap and reversible; making one is not. This proposes
  // and stops, which is why the split later refuses to count anything a person
  // has not agreed to.
  try {
    await suggestInvoiceLinks(row.id);
  } catch (cause) {
    console.error('[invoices] link suggestion failed', cause);
  }
  return document;
}

async function finish(
  id: string,
  patch: Partial<typeof schema.invoiceDocuments.$inferInsert>,
): Promise<InvoiceDocument> {
  const db = requireDb();
  const [row] = await db
    .update(schema.invoiceDocuments)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(schema.invoiceDocuments.id, id))
    .returning();
  return invoiceDocumentDto(row!);
}

/* -------------------------------------------------------------------------- */
/*  Link                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Which register rows this invoice probably paid for.
 *
 * Deliberately narrow. Three things an invoice and a register row can agree on
 * — the purchase order, the vendor, and the amount — and the matcher only
 * proposes where at least two of them line up. A vendor match alone would
 * propose every one of the forty lines a company bought from Grainger; an
 * amount match alone would pair a $12,400 invoice with an unrelated $12,400
 * desk in another department.
 *
 * Nothing here auto-confirms. The output is a queue.
 */
export async function suggestInvoiceLinks(documentId: string): Promise<number> {
  const db = requireDb();
  const [document] = await db
    .select()
    .from(schema.invoiceDocuments)
    .where(eq(schema.invoiceDocuments.id, documentId));
  if (!document) return 0;

  const total = document.statedTotal ?? document.derivedTotal;
  if (total === null || total <= 0) return 0;

  const assets = await db
    .select({
      assetId: schema.assetVersions.assetId,
      description: schema.assetVersions.description,
      originalCost: schema.assetVersions.originalCost,
      vendor: schema.assetVersions.vendor,
      acquisitionDate: schema.assetVersions.acquisitionDate,
    })
    .from(schema.assetVersions)
    .where(eq(schema.assetVersions.engagementId, document.engagementId));

  const invoiceVendor = fold(document.vendorName);
  const proposals: { assetId: string; reason: string; score: number }[] = [];
  for (const asset of assets) {
    if (asset.originalCost === null || asset.originalCost <= 0) continue;
    const reasons: string[] = [];
    let score = 0;

    const vendorMatch =
      invoiceVendor !== '' &&
      fold(asset.vendor) !== '' &&
      sharesWord(invoiceVendor, fold(asset.vendor));
    if (vendorMatch) {
      reasons.push(`vendor matches “${asset.vendor}”`);
      score += 0.4;
    }

    const gap = Math.abs(asset.originalCost - total) / Math.max(asset.originalCost, total);
    if (gap <= 0.005) {
      reasons.push('capitalized amount matches the invoice total');
      score += 0.5;
    } else if (gap <= 0.1) {
      // The common case for a machine whose entry also carries freight billed
      // separately, or a small credit applied after the fact.
      reasons.push(`capitalized amount is within ${Math.round(gap * 100)}% of the invoice`);
      score += 0.25;
    }

    if (document.purchaseOrder && asset.description) {
      const po = document.purchaseOrder.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (
        po.length >= 4 &&
        asset.description
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .includes(po)
      ) {
        reasons.push(`purchase order ${document.purchaseOrder} appears on the register line`);
        score += 0.5;
      }
    }

    if (reasons.length >= 2 && score >= 0.6) {
      proposals.push({ assetId: asset.assetId, reason: reasons.join('; '), score });
    }
  }

  if (proposals.length === 0) return 0;
  proposals.sort((a, b) => b.score - a.score);
  // Where several register rows fit, they are all proposed and each carries an
  // equal share — a phased project split across three capitalized lines is the
  // case this exists for. A person narrowing it to one raises that share to 1.
  const share = 1 / proposals.length;
  await db
    .insert(schema.invoiceAssetLinks)
    .values(
      proposals.map((p) => ({
        documentId,
        assetId: p.assetId,
        engagementId: document.engagementId,
        share,
        status: 'suggested',
        reason: p.reason,
      })),
    )
    .onConflictDoNothing();
  return proposals.length;
}

const fold = (value: string | null | undefined) =>
  (value ?? '')
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|the|and)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function sharesWord(a: string, b: string): boolean {
  const words = new Set(a.split(' ').filter((w) => w.length > 2));
  return b.split(' ').some((word) => word.length > 2 && words.has(word));
}

export async function setInvoiceLink(
  documentId: string,
  assetId: string,
  patch: { status?: string; share?: number; linkedBy?: string | null; reason?: string | null },
): Promise<void> {
  const db = requireDb();
  const [document] = await db
    .select({ engagementId: schema.invoiceDocuments.engagementId })
    .from(schema.invoiceDocuments)
    .where(eq(schema.invoiceDocuments.id, documentId));
  if (!document) throw new HttpError(404, 'That invoice is not on this engagement.');

  await db
    .insert(schema.invoiceAssetLinks)
    .values({
      documentId,
      assetId,
      engagementId: document.engagementId,
      share: patch.share ?? 1,
      status: patch.status ?? 'confirmed',
      reason: patch.reason ?? null,
      linkedBy: patch.linkedBy ?? null,
    })
    .onConflictDoUpdate({
      target: [schema.invoiceAssetLinks.documentId, schema.invoiceAssetLinks.assetId],
      set: {
        ...(patch.share === undefined ? {} : { share: patch.share }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.linkedBy === undefined ? {} : { linkedBy: patch.linkedBy }),
      },
    });
}

export async function removeInvoiceLink(documentId: string, assetId: string): Promise<void> {
  const db = requireDb();
  await db
    .delete(schema.invoiceAssetLinks)
    .where(
      and(
        eq(schema.invoiceAssetLinks.documentId, documentId),
        eq(schema.invoiceAssetLinks.assetId, assetId),
      ),
    );
}

/**
 * Change what a line is, by hand.
 *
 * Recorded as a correction rather than as a new ruling, and the source moves to
 * `human`, because the two facts a reader needs later are different: what the
 * rules said, and that somebody disagreed. A corrected line carries full
 * confidence — a preparer who has read the invoice is a better authority on it
 * than a regular expression.
 */
export async function correctInvoiceLine(
  lineId: string,
  patch: { treatment: string; reason: string | null; by: string | null },
): Promise<InvoiceLineRecord> {
  const db = requireDb();
  const [row] = await db
    .update(schema.invoiceLines)
    .set({
      treatment: patch.treatment,
      treatmentReason: patch.reason,
      treatmentSource: 'human',
      treatmentConfidence: 0.95,
      isCorrected: true,
      correctedBy: patch.by,
      correctedAt: new Date(),
    })
    .where(eq(schema.invoiceLines.id, lineId))
    .returning();
  if (!row) throw new HttpError(404, 'That line is not on this invoice.');
  return invoiceLineDto(row);
}

/** A person has read the document and stands behind what it says. */
export async function acceptInvoice(
  documentId: string,
  by: string | null,
): Promise<InvoiceDocument> {
  return finish(documentId, { status: 'accepted', reviewedBy: by, reviewedAt: new Date() });
}

/* -------------------------------------------------------------------------- */
/*  Split — what reaches the engine                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the invoices say about the register, in the shape the detector wants.
 *
 * Only **confirmed** links count. Not because a suggestion is usually wrong,
 * but because the cost of the rare wrong one is asymmetric: a misattributed
 * invoice produces a finding indistinguishable from a correct one, priced,
 * ranked and put in front of a tax director. Every other detector in the
 * product can be argued with from the register itself; this one cannot.
 */
export async function loadInvoiceSplits(engagementId: string) {
  const db = requireDb();
  const links = await db
    .select({
      link: schema.invoiceAssetLinks,
      document: schema.invoiceDocuments,
      bookedCost: schema.assetVersions.originalCost,
    })
    .from(schema.invoiceAssetLinks)
    .innerJoin(
      schema.invoiceDocuments,
      eq(schema.invoiceDocuments.id, schema.invoiceAssetLinks.documentId),
    )
    .innerJoin(
      schema.assetVersions,
      eq(schema.assetVersions.assetId, schema.invoiceAssetLinks.assetId),
    )
    .where(
      and(
        eq(schema.invoiceAssetLinks.engagementId, engagementId),
        eq(schema.invoiceAssetLinks.status, 'confirmed'),
      ),
    );
  if (links.length === 0) return [];

  const documentIds = [...new Set(links.map((l) => l.document.id))];
  const lines = await db
    .select()
    .from(schema.invoiceLines)
    .where(inArray(schema.invoiceLines.documentId, documentIds));

  const byDocument = new Map<string, SplitLine[]>();
  for (const line of lines) {
    const bucket = byDocument.get(line.documentId) ?? [];
    bucket.push({
      description: line.description,
      amount: line.amount,
      treatment: line.treatment as SplitLine['treatment'],
      readConfidence: line.readConfidence,
      treatmentConfidence: line.treatmentConfidence,
    });
    byDocument.set(line.documentId, bucket);
  }

  const perAsset = new Map<
    string,
    {
      bookedCost: number;
      reviewed: boolean;
      contributions: {
        documentLabel: string | null;
        share: number;
        nonAssessable: number;
        excluded: { label: string; amount: number }[];
        confidence: number;
      }[];
    }
  >();

  for (const { link, document, bookedCost } of links) {
    if (document.status === 'failed' || bookedCost === null) continue;
    const split = splitInvoice(byDocument.get(document.id) ?? []);
    if (split.nonAssessable <= 0) continue;
    const entry = perAsset.get(link.assetId) ?? {
      bookedCost,
      // Every invoice behind an asset has to have been accepted for the asset's
      // split to count as reviewed. One unchecked document among three is an
      // unchecked position.
      reviewed: true,
      contributions: [],
    };
    entry.reviewed = entry.reviewed && document.status === 'accepted';
    entry.contributions.push({
      documentLabel: document.vendorName
        ? `${document.vendorName}${document.invoiceNumber ? ` ${document.invoiceNumber}` : ''}`
        : document.originalFilename,
      share: link.share,
      nonAssessable: split.nonAssessable,
      excluded: split.excluded,
      confidence: split.confidence,
    });
    perAsset.set(link.assetId, entry);
  }

  return [...perAsset.entries()]
    .map(([assetId, entry]) => splitForAsset({ assetId, ...entry }))
    .filter((split): split is NonNullable<typeof split> => split !== null);
}

/* -------------------------------------------------------------------------- */
/*  Screens                                                                   */
/* -------------------------------------------------------------------------- */

/** How many register lines to name as uncovered. Enough to work, not a register dump. */
const UNCOVERED_SHOWN = 25;

export async function loadInvoices(engagementId: string): Promise<InvoiceList> {
  const db = requireDb();
  const [documents, links, assets] = await Promise.all([
    db
      .select()
      .from(schema.invoiceDocuments)
      .where(eq(schema.invoiceDocuments.engagementId, engagementId))
      .orderBy(desc(schema.invoiceDocuments.createdAt)),
    db
      .select()
      .from(schema.invoiceAssetLinks)
      .where(eq(schema.invoiceAssetLinks.engagementId, engagementId)),
    db
      .select({
        assetId: schema.assetVersions.assetId,
        description: schema.assetVersions.description,
        originalCost: schema.assetVersions.originalCost,
        acquisitionYear: schema.assetVersions.acquisitionYear,
        vendor: schema.assetVersions.vendor,
        isDisposed: schema.assetVersions.isDisposed,
      })
      .from(schema.assetVersions)
      .where(eq(schema.assetVersions.engagementId, engagementId)),
  ]);

  const lines =
    documents.length === 0
      ? []
      : await db
          .select()
          .from(schema.invoiceLines)
          .where(
            inArray(
              schema.invoiceLines.documentId,
              documents.map((d) => d.id),
            ),
          );

  const linesByDocument = new Map<string, LineRow[]>();
  for (const line of lines) {
    const bucket = linesByDocument.get(line.documentId) ?? [];
    bucket.push(line);
    linesByDocument.set(line.documentId, bucket);
  }
  const linkCounts = new Map<string, number>();
  for (const link of links) {
    linkCounts.set(link.documentId, (linkCounts.get(link.documentId) ?? 0) + 1);
  }

  const covered = new Set(links.map((l) => l.assetId));
  const live = assets.filter((a) => !a.isDisposed && (a.originalCost ?? 0) > 0);
  const registerCost = live.reduce((sum, a) => sum + (a.originalCost ?? 0), 0);
  const coveredCost = live
    .filter((a) => covered.has(a.assetId))
    .reduce((sum, a) => sum + (a.originalCost ?? 0), 0);

  return {
    engagementId,
    documents: documents.map((row) => {
      const own = linesByDocument.get(row.id) ?? [];
      const split = splitInvoice(
        own.map((line) => ({
          description: line.description,
          amount: line.amount,
          treatment: line.treatment as SplitLine['treatment'],
          readConfidence: line.readConfidence,
          treatmentConfidence: line.treatmentConfidence,
        })),
      );
      return {
        ...invoiceDocumentDto(row),
        lineCount: own.length,
        linkCount: linkCounts.get(row.id) ?? 0,
        nonAssessableCost: split.nonAssessable,
        unclearCost: split.unclear,
        unclearLines: own.filter((line) => line.treatment === 'unclear').length,
      };
    }),
    // Biggest first, because that is the order in which reading an invoice pays
    // for itself. A $2,000 line has no invoice worth chasing.
    uncovered: live
      .filter((a) => !covered.has(a.assetId))
      .sort((a, b) => (b.originalCost ?? 0) - (a.originalCost ?? 0))
      .slice(0, UNCOVERED_SHOWN)
      .map(({ assetId, description, originalCost, acquisitionYear, vendor }) => ({
        assetId,
        description,
        originalCost,
        acquisitionYear,
        vendor,
      })),
    coveredCost,
    registerCost,
  };
}

export async function loadInvoiceDetail(
  engagementId: string,
  documentId: string,
): Promise<InvoiceDetail> {
  const db = requireDb();
  const [document] = await db
    .select()
    .from(schema.invoiceDocuments)
    .where(
      and(
        eq(schema.invoiceDocuments.id, documentId),
        eq(schema.invoiceDocuments.engagementId, engagementId),
      ),
    );
  if (!document) throw new HttpError(404, 'That invoice is not on this engagement.');

  const [lines, links] = await Promise.all([
    db
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.documentId, documentId))
      .orderBy(asc(schema.invoiceLines.lineNumber)),
    db
      .select({
        link: schema.invoiceAssetLinks,
        description: schema.assetVersions.description,
        assetTag: schema.assetVersions.assetTag,
        originalCost: schema.assetVersions.originalCost,
      })
      .from(schema.invoiceAssetLinks)
      .innerJoin(
        schema.assetVersions,
        eq(schema.assetVersions.assetId, schema.invoiceAssetLinks.assetId),
      )
      .where(eq(schema.invoiceAssetLinks.documentId, documentId)),
  ]);

  const split = splitInvoice(
    lines.map((line) => ({
      description: line.description,
      amount: line.amount,
      treatment: line.treatment as SplitLine['treatment'],
      readConfidence: line.readConfidence,
      treatmentConfidence: line.treatmentConfidence,
    })),
  );

  const dtoLinks: InvoiceAssetLink[] = links.map(
    ({ link, description, assetTag, originalCost }) => ({
      documentId: link.documentId,
      assetId: link.assetId,
      assetDescription: description,
      assetTag,
      bookedCost: originalCost,
      share: link.share,
      status: link.status,
      reason: link.reason,
    }),
  );

  return {
    document: invoiceDocumentDto(document),
    lines: lines.map(invoiceLineDto),
    links: dtoLinks,
    assessableCost: split.total > 0 ? split.assessable + split.unclear : null,
    nonAssessableCost: split.nonAssessable,
    unclearCost: split.unclear,
  };
}
