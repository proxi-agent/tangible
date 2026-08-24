import { z } from 'zod';
import { ClassificationStatusSchema } from './classification.js';
import { RenditionScheduleKeySchema } from './filing.js';

/**
 * What the client filed last year, and what the district said back.
 *
 * This is the missing half of every comparison in the product. Until now the
 * only "before" available was the assessed total on the public roll — one
 * number, in the four Texas counties whose rolls we hold, and nowhere else. It
 * says what the district concluded and nothing at all about how the client got
 * there, which is why three of the five findings in the savings report are
 * `screening` rather than `measured`: we can see that an asset *would* be
 * cheaper on the right schedule, but not that the client actually rendered it
 * on the wrong one.
 *
 * A prior rendition closes that. It says, in the taxpayer's own filing, what
 * cost was reported under which property type and which year acquired.
 *
 * **The shape is lines, not assets.** Form 50-144 is filed in aggregate:
 * Schedule E is property type by year acquired, and the others are single
 * totals. A return does not enumerate assets and cannot be made to, so the
 * comparison happens at the grain the form actually uses — our classified
 * register rolled up to (type, year) against their reported (type, year).
 * Modelling this as per-asset values would invent a precision the document does
 * not contain.
 *
 * Some filers attach a detail schedule listing every asset. When that happens it
 * is a gift, and it still arrives as lines — just a great many of them, one per
 * asset, which the same shape holds without any special case.
 */

// ---------------------------------------------------------------------------
// What extraction produces
// ---------------------------------------------------------------------------

/**
 * One reported line, as the form states it.
 *
 * Every number here is **what the document says**, never what we think it should
 * say. A line that reads implausibly is kept verbatim and flagged, because the
 * whole value of this record is that it is evidence of what was filed — and a
 * return with an arithmetic error in it is itself a finding worth having.
 */
export const PriorReturnLineSchema = z.object({
  schedule: RenditionScheduleKeySchema,
  /** The form's own property-type wording, verbatim. Mapped to our vocabulary separately. */
  type: z.string(),
  /** Null on the schedules the form does not break down by year. */
  yearAcquired: z.number().int().nullable(),
  /** Historical cost as reported. Null when the filer used the estimate basis only. */
  historicalCost: z.number().nullable(),
  /** Good faith estimate as reported. Null when filed on cost, which is the common case. */
  goodFaithEstimate: z.number().nullable(),
  /** Where on the document this came from, so a disputed figure can be checked. */
  sourcePage: z.number().int().nullable(),
});

export type PriorReturnLine = z.infer<typeof PriorReturnLineSchema>;

/** A schedule's lines plus the total the form itself prints for it. */
export const PriorReturnScheduleSchema = z.object({
  key: RenditionScheduleKeySchema,
  lines: z.array(PriorReturnLineSchema),
  /**
   * The total printed on the form for this schedule, read independently of the
   * lines. Reading both is what makes the footing check possible: if we derived
   * the total by summing the lines it would foot by construction and prove
   * nothing about whether the lines were read correctly.
   */
  statedTotal: z.number().nullable(),
});

export type PriorReturnSchedule = z.infer<typeof PriorReturnScheduleSchema>;

export const ExtractedRenditionSchema = z.object({
  /** The owner name as filed, for checking we are looking at the right client's form. */
  ownerName: z.string().nullable(),
  /** The district's account number as filed. */
  accountId: z.string().nullable(),
  taxYear: z.number().int().nullable(),
  /** The appraisal district named on the form, in its own words. */
  districtName: z.string().nullable(),
  /**
   * Which basis the filer used. 22.01(a)(5) allows either, and which one they
   * chose changes what a comparison against our schedule value even means.
   */
  basis: z.enum(['cost', 'estimate', 'both', 'unknown']),
  schedules: z.array(PriorReturnScheduleSchema),
  /** The grand total printed on the form, again read independently of the parts. */
  statedFormTotal: z.number().nullable(),
  /** True when the document is a signed filing rather than an unsigned draft. */
  isSigned: z.boolean(),
  /**
   * Anything the extractor could not read with confidence — a smudged figure, a
   * handwritten annotation, a page that did not scan. Named rather than guessed
   * at, because a filled-in gap in a filed return is a fabricated fact.
   */
  unreadable: z.array(z.string()),
});

export type ExtractedRendition = z.infer<typeof ExtractedRenditionSchema>;

// ---------------------------------------------------------------------------
// Whether to believe it
// ---------------------------------------------------------------------------

export const FOOTING_SEVERITIES = [
  /** The document contradicts itself, or we misread it. Either way, do not rely on it. */
  'error',
  /** Worth a look before this is used as a baseline, but not disqualifying. */
  'warning',
] as const;

export const FootingSeveritySchema = z.enum(FOOTING_SEVERITIES);
export type FootingSeverity = (typeof FOOTING_SEVERITIES)[number];

export const FootingIssueSchema = z.object({
  severity: FootingSeveritySchema,
  /** Stable identifier, so the UI can group and the tests can assert on it. */
  code: z.string(),
  message: z.string(),
  /** Set when the issue belongs to one schedule. */
  schedule: RenditionScheduleKeySchema.nullable(),
  /** The two figures that disagree, where the issue is an arithmetic one. */
  expected: z.number().nullable(),
  actual: z.number().nullable(),
});

export type FootingIssue = z.infer<typeof FootingIssueSchema>;

/**
 * The extraction's own correctness check.
 *
 * A filed tax form carries its own proof: the lines of each schedule sum to that
 * schedule's printed total, and the schedule totals sum to the form's. Reading
 * both the parts and the stated totals independently turns that into a test the
 * extraction has to pass — the same trick the HCAD guide's double-printed SIC
 * tables allowed, and for the same reason. A model that misreads $185,000 as
 * $18,500 produces a return that does not add up, and it says so instead of
 * quietly becoming the baseline every later finding is measured against.
 *
 * A discrepancy is **not** grounds for discarding the document. Real forms
 * contain real arithmetic errors, and a prior return that does not foot is a
 * finding in its own right. What it is grounds for is refusing to treat the
 * figures as settled without a person looking — which is what `status` decides.
 */
export const PRIOR_RETURN_STATUSES = [
  /** Extracted, footed, and nothing contradicts itself. Usable as a baseline. */
  'verified',
  /** Extracted, but something does not add up. A person has to look before it counts. */
  'discrepant',
  /** A person reviewed it and accepted the figures, discrepancies and all. */
  'accepted',
  /** Extraction failed or produced nothing usable. */
  'failed',
] as const;

export const PriorReturnStatusSchema = z.enum(PRIOR_RETURN_STATUSES);
export type PriorReturnStatus = (typeof PRIOR_RETURN_STATUSES)[number];

export const FootingResultSchema = z.object({
  status: PriorReturnStatusSchema,
  issues: z.array(FootingIssueSchema),
  /** Sum of the lines we read, across every schedule. */
  derivedTotal: z.number(),
  /** What the form says its total is. Null when that figure could not be read. */
  statedTotal: z.number().nullable(),
  /** Lines successfully read, as a scale for the checks above. */
  lineCount: z.number().int().nonnegative(),
});

export type FootingResult = z.infer<typeof FootingResultSchema>;

// ---------------------------------------------------------------------------
// The assessment notice
// ---------------------------------------------------------------------------

/**
 * What the district concluded, from the notice rather than the roll.
 *
 * The warehouse already holds assessed values for four Texas counties, so for
 * those this is corroboration. Everywhere else it is the only source there is —
 * and even in Harris it carries two things the roll does not: the protest
 * deadline actually printed on the notice, and the district's own breakdown
 * where it gives one.
 */
export const ExtractedNoticeSchema = z.object({
  ownerName: z.string().nullable(),
  accountId: z.string().nullable(),
  taxYear: z.number().int().nullable(),
  /** The date printed on the notice itself — the day the 41.44 clock starts. As printed. */
  noticeDate: z.string().nullable(),
  districtName: z.string().nullable(),
  appraisedValue: z.number().nullable(),
  assessedValue: z.number().nullable(),
  /** Prior-year value where the notice prints one, which most do. */
  priorYearValue: z.number().nullable(),
  /** As printed. The statutory date is computable; the printed one is what binds. */
  protestDeadline: z.string().nullable(),
  /** Set when the notice says the value was set without a rendition on file. */
  renditionPenaltyApplied: z.boolean().nullable(),
  unreadable: z.array(z.string()),
});

export type ExtractedNotice = z.infer<typeof ExtractedNoticeSchema>;

export const PRIOR_DOCUMENT_KINDS = ['rendition', 'notice'] as const;
export const PriorDocumentKindSchema = z.enum(PRIOR_DOCUMENT_KINDS);
export type PriorDocumentKind = (typeof PRIOR_DOCUMENT_KINDS)[number];

/** Extensions the intake accepts. Renditions and notices arrive as scans far more often than not. */
export const PRIOR_UPLOAD_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg'] as const;

// ---------------------------------------------------------------------------
// What the filer's wording means in our vocabulary
// ---------------------------------------------------------------------------

/**
 * A rendition is filed in the taxpayer's own words. "Mach & Equip", "Shop
 * Equipment", "Telephone / Network Equipment" — nobody files against our
 * category table, and the wording is stored verbatim on the way in precisely so
 * that deciding what it means stays a separate, visible, arguable step.
 *
 * This is the step. It is the join that turns a stack of prior-year lines into
 * something comparable with a classified register, and until it exists the
 * document can be read but not used.
 *
 * Two things make it different from classifying an asset, and both are worth
 * knowing before reading the rules:
 *
 *   - **The schedule letter is not a hint, it is the form's own statement.**
 *     Schedule D is licensed vehicles because the form says Schedule D is
 *     licensed vehicles. Four of the six schedules decide themselves and never
 *     reach a model.
 *   - **A line is a bucket, not a thing.** One line can cover several of our
 *     categories — "Furniture, Fixtures & Equipment" is three — and no amount of
 *     judgement can split a number the form printed as one. That answer has a
 *     name here rather than being forced into a category it half fits.
 */
export const LINE_MAPPING_SOURCES = [
  /** The form's schedule letter settled it. No model, no reviewer, no judgement. */
  'schedule',
  /** A reviewer settled this exact wording before — on this client or another. */
  'memory',
  'ai',
  'human',
] as const;

export const LineMappingSourceSchema = z.enum(LINE_MAPPING_SOURCES);
export type LineMappingSource = (typeof LINE_MAPPING_SOURCES)[number];

/**
 * The line blends categories and cannot be split.
 *
 * Not a failure and not an "unsure" — a definite finding about the filing. A
 * lumped line means the district received no basis for putting that cost on one
 * schedule rather than another, and applied its own judgement instead. The cost
 * is carried through every rollup as explicitly unplaceable, because quietly
 * assigning it to whichever category the wording leans toward would invent a
 * comparison the document does not support.
 */
export const MIXED_LINE_KEY = 'mixed';

export const PriorLineMappingSchema = z.object({
  /**
   * A classification key, {@link MIXED_LINE_KEY}, or null when nothing was
   * decided. Null is a real state and the queue shows it as one.
   */
  categoryKey: z.string().nullable(),
  confidence: z.number(),
  rationale: z.string(),
  source: LineMappingSourceSchema,
  status: ClassificationStatusSchema,
  /** The memory key this wording folds to, whether or not it hit. */
  fingerprint: z.string().nullable(),
});

export type PriorLineMapping = z.infer<typeof PriorLineMappingSchema>;

/** One extracted line plus what we decided its wording means. */
export const MappedPriorLineSchema = PriorReturnLineSchema.extend({
  id: z.string(),
  documentId: z.string(),
  mapping: PriorLineMappingSchema,
  mappedBy: z.string().nullable(),
  mappedAt: z.string().datetime().nullable(),
  isCorrected: z.boolean(),
});

export type MappedPriorLine = z.infer<typeof MappedPriorLineSchema>;

export const UpdateLineMappingRequestSchema = z.object({
  categoryKey: z.string(),
  /** Apply to every other line on this return whose wording folds the same way. */
  applyToMatching: z.boolean().default(true),
  /** Carry the decision to future returns that use these words. */
  remember: z.boolean().default(true),
  rationale: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateLineMappingRequest = z.infer<typeof UpdateLineMappingRequestSchema>;

export const LineMappingRunResultSchema = z.object({
  considered: z.number().int().nonnegative(),
  /** Settled by the schedule letter alone. */
  fromSchedule: z.number().int().nonnegative(),
  fromMemory: z.number().int().nonnegative(),
  fromAi: z.number().int().nonnegative(),
  autoAccepted: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  /** Distinct questions actually put to the model, after folding and memory. */
  distinctSent: z.number().int().nonnegative(),
  model: z.string().nullable(),
  aiUnavailable: z.boolean(),
});

export type LineMappingRunResult = z.infer<typeof LineMappingRunResultSchema>;

// ---------------------------------------------------------------------------
// What the app hands the browser
// ---------------------------------------------------------------------------

/**
 * A stored document, as every screen sees it.
 *
 * `status` is deliberately wider than {@link PRIOR_RETURN_STATUSES}: a row
 * exists from the moment the bytes land in the bucket, which is before anything
 * has been read and therefore before any of the four verdicts can apply.
 */
export const PRIOR_DOCUMENT_STATUSES = ['uploaded', ...PRIOR_RETURN_STATUSES] as const;

export const PriorDocumentStatusSchema = z.enum(PRIOR_DOCUMENT_STATUSES);
export type PriorDocumentStatus = (typeof PRIOR_DOCUMENT_STATUSES)[number];

export const PriorDocumentSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  kind: PriorDocumentKindSchema,
  originalFilename: z.string(),
  byteSize: z.number().int().nonnegative(),
  status: PriorDocumentStatusSchema,
  /** Why extraction failed, in the words of whatever failed. Null when it did not. */
  error: z.string().nullable(),
  /**
   * The year and account **the document itself claims**, kept apart from the
   * engagement's own. They disagree more often than anyone expects — a client
   * sends last year's form, or one location's account — and silently trusting
   * either one would compare the wrong return against the wrong register.
   */
  documentTaxYear: z.number().int().nullable(),
  documentAccountId: z.string().nullable(),
  extracted: z.union([ExtractedRenditionSchema, ExtractedNoticeSchema]).nullable(),
  footing: FootingResultSchema.nullable(),
  statedTotal: z.number().nullable(),
  derivedTotal: z.number().nullable(),
  extractionModel: z.string().nullable(),
  lineCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PriorDocument = z.infer<typeof PriorDocumentSchema>;

/** What a reviewer's single decision actually moved. */
export const LineMappingDecisionResultSchema = z.object({
  lineId: z.string(),
  categoryKey: z.string(),
  /** The reviewer overruled a reading that was already there, rather than filling a blank. */
  corrected: z.boolean(),
  /** Lines settled by this one decision, including the line it was made on. */
  applied: z.number().int().nonnegative(),
  /** The wording was written to memory and will replay on the next return. */
  remembered: z.boolean(),
  /** Memory already held a different answer for these words; both are now on the record. */
  memoryConflict: z.boolean(),
});

export type LineMappingDecisionResult = z.infer<typeof LineMappingDecisionResultSchema>;
