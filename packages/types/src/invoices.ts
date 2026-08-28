import { z } from 'zod';

/**
 * The invoice behind a capitalized line.
 *
 * The doc calls non-assessable cost the largest single leakage category, and it
 * is the only one a fixed asset register cannot see at any level of care. A
 * register row says `PACKAGING LINE — $340,000` because that is what the
 * accounting entry was. Texas assesses the machine. The freight, the millwright
 * labour, the concrete pad, the PLC programming, the two-year service contract
 * and the sales tax are all inside that number and none of them is tangible
 * personal property at that address on January 1.
 *
 * So this record exists to hold **what the invoice says**, at line grain, with
 * the same discipline as the rendition extractor: transcribe, do not compute;
 * never invent. What each line *means* for tax is a separate decision made by
 * jurisdiction rules that a person can read and argue with, and it is stored
 * separately from what the document says so that re-reading the document does
 * not silently rewrite anyone's conclusion.
 *
 * The one thing this shape adds over the rendition extractor is **per-field
 * confidence**. A rendition is a form with printed totals, so it can be checked
 * by whether it foots. An invoice has no such internal check — vendors lay them
 * out however they like, and the same $12,400 can be a line item, a subtotal, a
 * credit or a page header depending on where it sits. Confidence is therefore
 * the only handle on quality, and it is what routes an extraction to review
 * rather than into a client's savings number.
 */

/**
 * What a line is, for tax.
 *
 * Deliberately three-valued. "Unclear" is the answer for a line the rules do
 * not recognize, and it is not the same as assessable: a $46,000 line reading
 * "PROJECT SERVICES" may be entirely labour or entirely machine, and defaulting
 * it either way is a guess with money on it. Unclear lines stay in the invoice,
 * stay out of the split, and are what a preparer is shown first.
 */
export const AssessabilityTreatmentSchema = z.enum(['assessable', 'non-assessable', 'unclear']);
export type AssessabilityTreatment = z.infer<typeof AssessabilityTreatmentSchema>;

/**
 * One line as the document prints it, plus how well it was read.
 *
 * `confidence` is about the *reading*, not about the tax treatment — whether
 * the description and amount on this row are what the page says. The treatment
 * carries its own confidence through the rule that produced it.
 */
export const ExtractedInvoiceLineSchema = z.object({
  /** The vendor's own wording, verbatim. Never normalized on the way in. */
  description: z.string(),
  /** The extended amount for this line, as printed. */
  amount: z.number().nullable(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  /** A part or model number where the line prints one — the strongest identity signal on an invoice. */
  partNumber: z.string().nullable(),
  sourcePage: z.number().int().nullable(),
  /** How confidently this row was read, 0 to 1. */
  confidence: z.number().min(0).max(1),
});
export type ExtractedInvoiceLine = z.infer<typeof ExtractedInvoiceLineSchema>;

export const ExtractedInvoiceSchema = z.object({
  vendorName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  /** As printed. Not normalized to ISO — a date we could not parse is still evidence. */
  invoiceDate: z.string().nullable(),
  /** Who it was billed to, for checking this invoice belongs to this client. */
  billedTo: z.string().nullable(),
  /** The purchase order it references, where it prints one. */
  purchaseOrder: z.string().nullable(),
  lines: z.array(ExtractedInvoiceLineSchema),
  /**
   * The invoice total as **printed**, never summed from the lines. The same
   * rule as the rendition extractor, for the same reason: summing the lines
   * makes the document foot by construction and proves nothing about whether
   * the lines were read correctly. Here it is doing more work than usual, since
   * an invoice has no other internal check at all.
   */
  statedTotal: z.number().nullable(),
  /** Freight, tax and discount lines are often printed below the total rather than in it. */
  statedTax: z.number().nullable(),
  statedFreight: z.number().nullable(),
  currency: z.string().nullable(),
  /** What could not be read, in the model's own words. Named gaps are cheap; filled ones are not. */
  unreadable: z.array(z.string()),
});
export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

// ---------------------------------------------------------------------------
// What the record holds once a line has been read and ruled on
// ---------------------------------------------------------------------------

export const InvoiceLineRecordSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  lineNumber: z.number().int(),
  description: z.string(),
  amount: z.number().nullable(),
  quantity: z.number().nullable(),
  unitPrice: z.number().nullable(),
  partNumber: z.string().nullable(),
  sourcePage: z.number().int().nullable(),
  readConfidence: z.number(),
  treatment: AssessabilityTreatmentSchema,
  /** Why, in a sentence a preparer can repeat to a district. */
  treatmentReason: z.string().nullable(),
  /** The statute or rule the reason rests on, where there is one. */
  treatmentAuthority: z.string().nullable(),
  /** 'rule' | 'human' — nothing else decides a treatment. */
  treatmentSource: z.string(),
  treatmentConfidence: z.number(),
  /** True once a person has changed the treatment this rule produced. */
  isCorrected: z.boolean(),
});
export type InvoiceLineRecord = z.infer<typeof InvoiceLineRecordSchema>;

export const InvoiceDocumentSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  originalFilename: z.string(),
  byteSize: z.number().int(),
  contentType: z.string().nullable(),
  /** 'uploaded' | 'extracting' | 'extracted' | 'needs-review' | 'accepted' | 'failed'. */
  status: z.string(),
  error: z.string().nullable(),
  vendorName: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: z.string().nullable(),
  purchaseOrder: z.string().nullable(),
  statedTotal: z.number().nullable(),
  /** The lines added up. Kept beside the stated total rather than replacing it. */
  derivedTotal: z.number().nullable(),
  /** The weakest field on the document, which is what decides whether it is trusted. */
  extractionConfidence: z.number().nullable(),
  extractionModel: z.string().nullable(),
  unreadable: z.array(z.string()),
  uploadedBy: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type InvoiceDocument = z.infer<typeof InvoiceDocumentSchema>;

/** Which register lines this invoice paid for, and how much of it each one carries. */
export const InvoiceAssetLinkSchema = z.object({
  documentId: z.string(),
  assetId: z.string(),
  assetDescription: z.string().nullable(),
  assetTag: z.string().nullable(),
  bookedCost: z.number().nullable(),
  /**
   * This asset's share of the invoice, 0 to 1.
   *
   * One invoice routinely covers several capitalized lines, and the
   * non-assessable content of it is not attributable to any one of them from
   * the document alone. Where an invoice is linked to one asset the share is 1
   * and the split is a measurement. Where it is linked to several the share is
   * an allocation, and every finding built on it says so.
   */
  share: z.number().min(0).max(1),
  /** 'suggested' | 'confirmed' — a matcher proposed it, or a person agreed. */
  status: z.string(),
  /** Why the matcher proposed it, when it did. */
  reason: z.string().nullable(),
});
export type InvoiceAssetLink = z.infer<typeof InvoiceAssetLinkSchema>;

export const InvoiceDetailSchema = z.object({
  document: InvoiceDocumentSchema,
  lines: z.array(InvoiceLineRecordSchema),
  links: z.array(InvoiceAssetLinkSchema),
  /** What the split comes to today: booked, assessable, and what came out. */
  assessableCost: z.number().nullable(),
  nonAssessableCost: z.number(),
  unclearCost: z.number(),
});
export type InvoiceDetail = z.infer<typeof InvoiceDetailSchema>;

export const InvoiceListSchema = z.object({
  engagementId: z.string(),
  documents: z.array(
    InvoiceDocumentSchema.extend({
      lineCount: z.number().int(),
      linkCount: z.number().int(),
      nonAssessableCost: z.number(),
      unclearCost: z.number(),
      unclearLines: z.number().int(),
    }),
  ),
  /** Register lines with no invoice against them, biggest first — where to look next. */
  uncovered: z.array(
    z.object({
      assetId: z.string(),
      description: z.string().nullable(),
      originalCost: z.number().nullable(),
      acquisitionYear: z.number().int().nullable(),
      vendor: z.string().nullable(),
    }),
  ),
  coveredCost: z.number(),
  registerCost: z.number(),
});
export type InvoiceList = z.infer<typeof InvoiceListSchema>;
