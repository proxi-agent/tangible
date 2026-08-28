import { z } from 'zod';

/**
 * Deleting a client, and proving it happened.
 *
 * The outreach promise — "we delete your data on request" — is the reason this
 * exists. It has to be a real cascade rather than an archived flag: a client
 * who asks for deletion is not asking to be hidden from a list. What survives
 * is a receipt with no client data in it beyond the name, which is the thing
 * you can send back to them.
 */

/** What a deletion would destroy, counted before anyone confirms it. */
export const DeletionCountsSchema = z.object({
  engagements: z.number().int(),
  locations: z.number().int(),
  assets: z.number().int(),
  /** Registers, prior returns and intake drops together — every uploaded file row. */
  documents: z.number().int(),
  /** Objects in the private upload bucket, which are removed after the rows. */
  storageObjects: z.number().int(),
  findings: z.number().int(),
  filedRenditions: z.number().int(),
  notices: z.number().int(),
  protests: z.number().int(),
  correctionMotions: z.number().int(),
  appointments: z.number().int(),
  /**
   * Rows in the cross-client classification memory that were learned from this
   * client's register. They carry a verbatim sample of the client's own
   * description text, so the promise does not hold unless they go too.
   */
  memoryRows: z.number().int(),
  /**
   * Sign-ins that stop working.
   *
   * The only count on this list a person outside the firm feels directly: each
   * row is somebody at the client who can open the portal today and cannot
   * tomorrow. Worth reading before confirming, because it is the one part of a
   * deletion that produces a phone call.
   */
  portalLogins: z.number().int(),
  /**
   * Assistant turns that named this client.
   *
   * The assistant answers over the record, so a turn can quote register lines,
   * a filed position, or a finding — all confidential under Tax Code 22.27.
   * They hang off a conversation rather than off the client, so no cascade
   * reaches them and the sweep has to name them.
   */
  assistantTurns: z.number().int(),
});
export type DeletionCounts = z.infer<typeof DeletionCountsSchema>;

/** The preview a person reads before typing the client's name to confirm. */
export const DeletionPreviewSchema = z.object({
  clientId: z.string().uuid(),
  clientName: z.string(),
  status: z.string(),
  counts: DeletionCountsSchema,
  /** What the operator should weigh — consequences, not obstacles. */
  warnings: z.array(z.string()),
});
export type DeletionPreview = z.infer<typeof DeletionPreviewSchema>;

/** Confirmation is the client's own name, typed. A checkbox is too easy to click. */
export const DeleteClientRequestSchema = z.object({
  confirmName: z.string().min(1),
});
export type DeleteClientRequest = z.infer<typeof DeleteClientRequestSchema>;

/**
 * What is left afterwards: the name, the counts, and the date. No client data.
 *
 * Written after the rows are gone and the bucket is swept, so its storage
 * numbers are what actually happened rather than what was planned. Never
 * edited — a receipt that can be revised is not a receipt.
 */
export const DeletionReceiptSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  clientName: z.string(),
  counts: DeletionCountsSchema,
  storageRemoved: z.number().int(),
  /**
   * Objects the bucket would not give up. Named so a failed sweep is visible
   * rather than rounded down to success — the rows are gone either way.
   */
  storageFailed: z.array(z.string()),
  deletedAt: z.string().datetime(),
});
export type DeletionReceipt = z.infer<typeof DeletionReceiptSchema>;
