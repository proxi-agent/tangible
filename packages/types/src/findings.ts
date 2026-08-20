import { z } from 'zod';
import { FindingEffectSchema, FindingEvidenceSchema, FindingKindSchema } from './savings.js';

/**
 * A committed finding set: what we told a client, on a date, and what we decided
 * to do about each line of it.
 *
 * The savings report and the register comparison are both derived on read, and
 * they stay that way. That is the right behaviour for a working view — settling
 * one more row in the classification queue should move the number immediately,
 * and a cached report that silently disagreed with the decisions under it would
 * be worse than no report. Nothing here replaces that.
 *
 * What derived-on-read cannot do is hold a decision. Three things need one:
 *
 *   - **A report handed to a prospect is a statement.** It went out on a date,
 *     with particular numbers, computed from a register as it stood that
 *     morning. Regenerating it next month produces a different document, and
 *     "what did we actually claim" stops being answerable — which matters most
 *     in exactly the case you would want it, when the district asks.
 *   - **A finding is a question to a client, and the answer has to live
 *     somewhere.** "Is this $96,000 of software separately stated on the
 *     invoice?" gets asked once. Re-deriving the report forgets that it was
 *     asked, forgets the answer, and asks again.
 *   - **Rejection is information.** A finding the client looked at and declined
 *     to pursue should not come back looking new next quarter, and the reason
 *     they declined is worth more than the finding was.
 *
 * So: committing is a deliberate act, distinct from viewing. It snapshots the
 * whole report and every finding in it, and it never happens as a side effect
 * of someone opening a page.
 *
 * **Dispositions outlive the sets they were made on.** This is the same shape as
 * the line-mapping work: the derived thing is disposable and the human decision
 * is not. A disposition is keyed on (engagement, source, finding key) rather
 * than on a finding row, so committing a fresh set after new assets land
 * replays every decision already made onto the findings that survived, and only
 * genuinely new findings arrive undecided.
 *
 * A disposition also records the figures it was decided against. Accepting a
 * $96,000 position is not consent to a $184,000 one, and a set that quietly
 * carried the old decision onto the new number would be putting words in the
 * client's mouth — so the carried decision arrives flagged instead.
 */

/** Which analysis produced a set. Also the namespace a disposition lives in. */
export const FINDING_SOURCES = [
  /** `analyzeSavings` over the classified register. */
  'savings',
  /** `compareRegister` over a mapped prior return. */
  'register-comparison',
] as const;

export const FindingSourceSchema = z.enum(FINDING_SOURCES);
export type FindingSource = (typeof FINDING_SOURCES)[number];

/**
 * What was decided about a finding. There is deliberately no `open` member:
 * undecided is the absence of a record, not a decision someone made, and
 * writing a row to say "nobody has looked at this yet" would make the two
 * indistinguishable a month later.
 */
export const FINDING_DISPOSITIONS = [
  /** We are taking this position. It belongs in the filing and in the fee. */
  'accepted',
  /** Looked at and dropped. The note is the part worth keeping. */
  'rejected',
  /** Asked; waiting on the client. The normal state of a screening finding. */
  'pending-client',
] as const;

export const FindingDispositionStatusSchema = z.enum(FINDING_DISPOSITIONS);
export type FindingDispositionStatus = (typeof FINDING_DISPOSITIONS)[number];

export const FindingDispositionSchema = z.object({
  status: FindingDispositionStatusSchema,
  note: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().datetime(),
  /**
   * What the finding claimed when the decision was made. Kept so a decision
   * carried onto a later set can be checked against what it was made about,
   * rather than assumed to still apply.
   */
  decidedCost: z.number().nullable(),
  decidedValue: z.number().nullable(),
  /**
   * True when this decision was made against a different set and the numbers
   * have moved since. The decision still stands — it is the client's, not
   * ours to revoke — but it is shown as needing a second look.
   */
  isCarried: z.boolean(),
  hasMovedSinceDecision: z.boolean(),
});

export type FindingDisposition = z.infer<typeof FindingDispositionSchema>;

/**
 * One finding as committed. A near-copy of what the engine produced, kept as
 * rows rather than left inside the report blob because these are the things
 * that get decided about, listed, filtered and counted.
 */
export const StoredFindingSchema = z.object({
  id: z.string(),
  setId: z.string(),
  engagementId: z.string(),
  source: FindingSourceSchema,
  /** Stable across runs of the same analysis. What a disposition is keyed on. */
  key: z.string(),
  /** Position within the set, so a committed report reads back in its own order. */
  ordinal: z.number().int().nonnegative(),

  title: z.string(),
  kind: FindingKindSchema,
  effect: FindingEffectSchema,
  /** Original cost involved. Always a number, even where value is not. */
  cost: z.number(),
  /** Value effect on the district's tables. Null when nothing could price it. */
  value: z.number().nullable(),
  assetCount: z.number().int().nonnegative(),

  summary: z.string(),
  basis: z.string(),
  assumption: z.string().nullable(),

  /** Register rows behind the claim. */
  evidence: z.array(FindingEvidenceSchema),
  /** `ComparisonCell` snapshots — the return's side. Empty for savings findings. */
  cells: z.array(z.unknown()),

  disposition: FindingDispositionSchema.nullable(),
});

export type StoredFinding = z.infer<typeof StoredFindingSchema>;

/**
 * The headline the set is listed by. Each analysis answers a different question
 * — a savings report ends in an annual number, a comparison ends in the gap
 * between two positions — so the label travels with the figure instead of a
 * column called `total` meaning two things.
 */
export const FindingSetHeadlineSchema = z.object({
  label: z.string(),
  value: z.number().nullable(),
  caveat: z.string().nullable(),
});

export type FindingSetHeadline = z.infer<typeof FindingSetHeadlineSchema>;

export const FindingSetSummarySchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  source: FindingSourceSchema,
  /** The return a comparison was run against. Null for a savings set. */
  priorDocumentId: z.string().nullable(),
  taxYear: z.number().int(),
  label: z.string().nullable(),
  committedBy: z.string().nullable(),
  committedAt: z.string().datetime(),

  findingCount: z.number().int().nonnegative(),
  savingCount: z.number().int().nonnegative(),
  exposureCount: z.number().int().nonnegative(),
  decidedCount: z.number().int().nonnegative(),
  totalCost: z.number(),
  totalValue: z.number().nullable(),
  headline: FindingSetHeadlineSchema,

  /**
   * True when the register, the classifications or the return's mapping have
   * moved since this was committed. Not an error and not a reason to hide the
   * set — a statement made in March is still what was said in March — but a
   * reader deciding whether to send it needs to know it is behind.
   */
  isStale: z.boolean(),
});

export type FindingSetSummary = z.infer<typeof FindingSetSummarySchema>;

export const FindingSetSchema = FindingSetSummarySchema.extend({
  findings: z.array(StoredFindingSchema),
  /**
   * The whole report exactly as the engine produced it — `SavingsReport` or
   * `RegisterComparison`. The findings are the part that gets worked; this is
   * the part that makes the document reproducible, including the coverage
   * caveats and the schedule year, which are what a total means nothing
   * without.
   */
  report: z.unknown(),
});

export type FindingSet = z.infer<typeof FindingSetSchema>;

export const CommitFindingsRequestSchema = z.object({
  source: FindingSourceSchema,
  /** Required for a comparison, rejected for a savings set. */
  priorDocumentId: z.string().uuid().nullable().optional(),
  /** A name for this run — "sent to Dana, 14 March". Optional and free text. */
  label: z.string().trim().max(200).nullable().optional(),
});

export type CommitFindingsRequest = z.infer<typeof CommitFindingsRequestSchema>;

export const UpdateFindingDispositionRequestSchema = z.object({
  /** Null clears the decision back to undecided, which deletes the record. */
  status: FindingDispositionStatusSchema.nullable(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateFindingDispositionRequest = z.infer<
  typeof UpdateFindingDispositionRequestSchema
>;

/**
 * What a decision returns. The set travels with the row because the header's
 * decided count moves on every one of these, and re-fetching the whole set to
 * learn that one number went up by one is a round trip for nothing.
 */
export const FindingDecisionResultSchema = z.object({
  finding: StoredFindingSchema,
  set: FindingSetSummarySchema,
});

export type FindingDecisionResult = z.infer<typeof FindingDecisionResultSchema>;
