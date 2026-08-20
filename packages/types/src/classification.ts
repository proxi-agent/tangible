import { z } from 'zod';
import { AssetSchema } from './far.js';

/**
 * Classification: deciding which jurisdiction schedule each asset is valued on.
 *
 * This is where the money is. The same $20,000 of 2022 equipment is worth
 * $2,600 on Harris County's personal-computer schedule and $14,284 on the
 * ten-year machinery schedule — a 5.5x swing decided entirely by which row an
 * asset lands in. A register's own category column is the client's bookkeeping
 * vocabulary ("IT Equipment", "Shop"), not a district schedule, so something has
 * to translate.
 *
 * Three things do, in order of authority:
 *
 *   memory — a person already decided this exact description, on some earlier
 *            engagement. Deterministic, free, and the reason the system gets
 *            better with every client.
 *   ai     — Claude reads the description against the district's own category
 *            definitions and returns a class with an honest confidence.
 *   human  — a reviewer decides, and that decision becomes memory.
 *
 * Nothing here is silently trusted: a low-confidence answer is queued rather
 * than applied, an asset with nothing to classify on gets a null category and a
 * stated reason rather than a plausible guess, and a description two people
 * classified differently stops auto-applying until someone settles it.
 */

export const CLASSIFICATION_SOURCES = ['memory', 'ai', 'human'] as const;
export const ClassificationSourceSchema = z.enum(CLASSIFICATION_SOURCES);
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

export const CLASSIFICATION_STATUSES = [
  /** Confident enough to stand without a reviewer, and reversible if wrong. */
  'auto-accepted',
  /** Queued for a person — low confidence, no description, or a conflicted memory. */
  'needs-review',
  /** A person decided. The only status that writes back to memory. */
  'confirmed',
] as const;
export const ClassificationStatusSchema = z.enum(CLASSIFICATION_STATUSES);
export type ClassificationStatus = (typeof CLASSIFICATION_STATUSES)[number];

export const AssetClassificationSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  engagementId: z.string(),
  /**
   * A key from the jurisdiction's category table, or null when the engine had
   * nothing to go on. Null is a real state and the queue shows it as one.
   */
  categoryKey: z.string().nullable(),
  /** An explicit life class, where the asset is not valued on its category's default. */
  lifeClassOverride: z.number().int().nullable(),
  /** 0–1. What produced it depends on `source`; the UI shows both together. */
  confidence: z.number().min(0).max(1),
  /** Why this class — the model's reasoning, the memory that matched, or a reviewer's note. */
  rationale: z.string().nullable(),
  source: ClassificationSourceSchema,
  status: ClassificationStatusSchema,
  /** Which model answered, kept so a bad batch is attributable. */
  model: z.string().nullable(),
  /** The memory key this asset hashes to, whether or not it hit. */
  fingerprint: z.string().nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type AssetClassification = z.infer<typeof AssetClassificationSchema>;

/** A queue row: the decision plus the asset it was made about. */
export const ClassificationQueueItemSchema = z.object({
  classification: AssetClassificationSchema,
  asset: AssetSchema,
  /** How many other assets in this engagement share the same fingerprint. */
  siblingCount: z.number().int().nonnegative(),
});

export type ClassificationQueueItem = z.infer<typeof ClassificationQueueItemSchema>;

/** What a classification run did, in the terms an operator asks about. */
export const ClassificationRunResultSchema = z.object({
  /** Assets the run looked at (unclassified, or all of them on a re-run). */
  considered: z.number().int().nonnegative(),
  /** Decided from a prior human decision — no model call, no cost. */
  fromMemory: z.number().int().nonnegative(),
  fromAi: z.number().int().nonnegative(),
  /** Nothing to classify on: no description, no category, no GL account. */
  unclassifiable: z.number().int().nonnegative(),
  autoAccepted: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  /** Distinct descriptions actually sent to the model, after deduplication. */
  distinctSent: z.number().int().nonnegative(),
  aiCalls: z.number().int().nonnegative(),
  model: z.string().nullable(),
  /**
   * True when the run had questions for the model but no API key. Memory still
   * ran and the rest went to the queue — but the reason has to be said, or a
   * queue full of unanswered rows looks like the model refusing them.
   */
  aiUnavailable: z.boolean(),
  /** Batches that failed; their assets stay unclassified and the run reports it. */
  failedBatches: z.number().int().nonnegative(),
  /**
   * Distinct descriptions this run stopped short of, because a single run is
   * capped. They stay unclassified and the next run picks them up — said out
   * loud, because a truncated run that reports success reads as full coverage.
   */
  deferred: z.number().int().nonnegative(),
});

export type ClassificationRunResult = z.infer<typeof ClassificationRunResultSchema>;

export const ClassificationQuerySchema = z.object({
  status: ClassificationStatusSchema.optional(),
  source: ClassificationSourceSchema.optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ClassificationQuery = z.infer<typeof ClassificationQuerySchema>;

/** Engagement-level counts, so the card can be honest before you open the queue. */
export const ClassificationStatsSchema = z.object({
  assetCount: z.number().int().nonnegative(),
  classifiedCount: z.number().int().nonnegative(),
  unclassifiedCount: z.number().int().nonnegative(),
  autoAcceptedCount: z.number().int().nonnegative(),
  needsReviewCount: z.number().int().nonnegative(),
  confirmedCount: z.number().int().nonnegative(),
  fromMemoryCount: z.number().int().nonnegative(),
});

export type ClassificationStats = z.infer<typeof ClassificationStatsSchema>;

/**
 * A reviewer's decision. `remember` defaults on: the whole point of the review
 * queue is that a decision made once is never made again, on this engagement or
 * any later one.
 */
export const UpdateClassificationRequestSchema = z.object({
  categoryKey: z.string().trim().min(1),
  lifeClassOverride: z.number().int().nullable().optional(),
  rationale: z.string().trim().max(2000).nullable().optional(),
  remember: z.boolean().default(true),
  /** Apply the same decision to every asset in this engagement with the same fingerprint. */
  applyToMatching: z.boolean().default(true),
});

export type UpdateClassificationRequest = z.infer<typeof UpdateClassificationRequestSchema>;

export const ClassificationDecisionResultSchema = z.object({
  classification: AssetClassificationSchema,
  /** How many sibling rows the same decision was applied to, including this one. */
  applied: z.number().int().positive(),
  remembered: z.boolean(),
  /**
   * Set when this decision contradicted an existing memory for the same text.
   * The memory keeps the newer answer but stops auto-applying until the
   * disagreement is settled — a silent overwrite would let one mistake
   * propagate across every future client.
   */
  memoryConflict: z.boolean(),
});

export type ClassificationDecisionResult = z.infer<typeof ClassificationDecisionResultSchema>;

// ---------------------------------------------------------------------------
// Valuation, which is what classification is for
// ---------------------------------------------------------------------------

export const CategoryValuationSchema = z.object({
  categoryKey: z.string(),
  label: z.string(),
  /** Exclusions carry cost but no rendered value; the UI reads them differently. */
  kind: z.enum(['schedule', 'exclusion']),
  assetCount: z.number().int().nonnegative(),
  originalCost: z.number(),
  marketValue: z.number(),
  /** Assets already at their schedule floor — fully depreciated in the district's own model. */
  flooredCount: z.number().int().nonnegative(),
});

export type CategoryValuation = z.infer<typeof CategoryValuationSchema>;

export const ValuationGapSchema = z.object({
  reason: z.string(),
  count: z.number().int().nonnegative(),
  originalCost: z.number(),
});

export type ValuationGap = z.infer<typeof ValuationGapSchema>;

/**
 * The engagement run through the district's own arithmetic. Everything here is
 * derived — no stored totals — so it can never drift from the classifications
 * and schedules it came from.
 */
/**
 * The line of business the machinery life was read from.
 *
 * Texas keys machinery life to what the business does rather than to the
 * machine, so this single field moves the machinery total by a third or more —
 * SIC 3599 puts Acme's machinery on fifteen years instead of the category's
 * ten-year placeholder, which is $108,178 on one small register. A number that
 * large cannot be applied silently, so every surface that values machinery
 * reports which life it used.
 *
 * Shared between the valuation and the savings report deliberately: they are the
 * internal working view and the client-facing document of the same arithmetic,
 * and the two disagreeing about it is worse than either being wrong alone.
 */
export const MachinerySicSchema = z.object({
  code: z.string(),
  description: z.string(),
  machineryLife: z.number().int(),
  /** The placeholder it replaced, for the size of the correction. */
  defaultLife: z.number().int(),
});

export type MachinerySic = z.infer<typeof MachinerySicSchema>;

export const EngagementValuationSchema = z.object({
  jurisdictionId: z.string().nullable(),
  taxYear: z.number().int(),
  /**
   * Null means no SIC was set and machinery fell back to the ten-year
   * placeholder — a real difference in the numbers, so this says which applied
   * rather than letting a placeholder pass for a published life.
   */
  sic: MachinerySicSchema.nullable(),
  /** Null when no schedule is published for this jurisdiction; nothing is guessed. */
  schedule: z
    .object({
      taxYear: z.number().int(),
      title: z.string(),
      url: z.string(),
      pages: z.string(),
      /** True when we valued against a year other than the engagement's. */
      isFallbackYear: z.boolean(),
    })
    .nullable(),
  assetCount: z.number().int().nonnegative(),
  /** Assets with a usable classification — the only ones that could be valued. */
  valuedCount: z.number().int().nonnegative(),
  needsReviewCount: z.number().int().nonnegative(),
  unclassifiedCount: z.number().int().nonnegative(),
  originalCost: z.number(),
  marketValue: z.number(),
  flooredCount: z.number().int().nonnegative(),
  flooredMarketValue: z.number(),
  /** Assets the register marks disposed, excluded from the totals above. */
  disposedCount: z.number().int().nonnegative(),
  disposedOriginalCost: z.number(),
  /**
   * Assets classified as not belonging on this rendition at all, also excluded
   * from the totals above. This is the number a pitch leads with: cost the
   * client has been rendering that they did not have to.
   */
  excludedCount: z.number().int().nonnegative(),
  excludedOriginalCost: z.number(),
  byCategory: z.array(CategoryValuationSchema),
  gaps: z.array(ValuationGapSchema),
});

export type EngagementValuation = z.infer<typeof EngagementValuationSchema>;
