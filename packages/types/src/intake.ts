import { z } from 'zod';

/**
 * Multi-file intake: the drop zone that takes everything the client sent.
 *
 * A client's reply to "send us your fixed asset register" is rarely one clean
 * workbook. It is a register, a PDF of last year's rendition, an appraisal
 * notice, and a photo of a forklift. Triage decides which pipeline each file
 * belongs to — and the decision is the human's: the model proposes a route
 * with its reasons, and nothing moves until a person confirms it.
 */
export const INTAKE_ROUTES = ['register', 'rendition', 'notice', 'other'] as const;

export const IntakeRouteSchema = z.enum(INTAKE_ROUTES);
export type IntakeRoute = z.infer<typeof IntakeRouteSchema>;

export const INTAKE_STATUSES = ['triaged', 'routed', 'dismissed', 'failed'] as const;

/**
 * What a quick read of a PDF or image actually says about itself.
 *
 * Triage used to judge scans by filename alone — honest, but blind: a
 * scanner's "SKM_C368.pdf" is unroutable even when its first page says
 * "Notice of Appraised Value" over an account number. The peek is the model
 * reading the document once, cheaply, and reporting only what is printed;
 * routing stays a separate judgment, made over the whole batch, and the human
 * still confirms it.
 */
export const DocumentPeekSchema = z.object({
  /** What the document calls itself — its printed title or heading. */
  title: z.string().nullable(),
  /** A form number where one is printed (e.g. "50-144"). */
  formNumber: z.string().nullable(),
  /** Who issued or filed it, as printed. */
  issuer: z.string().nullable(),
  accountId: z.string().nullable(),
  taxYear: z.number().int().nullable(),
  /** One sentence on what the document is. */
  summary: z.string(),
});
export type DocumentPeek = z.infer<typeof DocumentPeekSchema>;

export const IntakeFileSchema = z.object({
  id: z.string().uuid(),
  engagementId: z.string().uuid(),
  originalFilename: z.string(),
  byteSize: z.number().int(),
  contentType: z.string().nullable(),
  /** Sheet names when the file opened as a workbook; null for PDFs and files that would not open. */
  sheetNames: z.array(z.string()).nullable(),
  proposedRoute: IntakeRouteSchema.nullable(),
  proposedConfidence: z.number().nullable(),
  proposedReason: z.string().nullable(),
  triageModel: z.string().nullable(),
  /** What the document said about itself, when it was peeked; null for workbooks and failed reads. */
  peek: DocumentPeekSchema.nullable(),
  status: z.enum(INTAKE_STATUSES),
  /** Set once routed: which pipeline, and the id of the row it became there. */
  routedKind: z.enum(['register', 'rendition', 'notice']).nullable(),
  routedId: z.string().uuid().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type IntakeFile = z.infer<typeof IntakeFileSchema>;
