import { z } from 'zod';
import { FindingDispositionStatusSchema, FindingSourceSchema } from './findings.js';

/**
 * Rendition filing: turning a classified register into Form 50-144.
 *
 * This is the end of the pipeline and the part that carries legal weight. A
 * rendition is a sworn statement of what the taxpayer owned on January 1, it is
 * signed under penalty of perjury, and a wrong one costs a 10% penalty (Tax
 * Code 22.28) or 50% if the district calls it fraud (22.29). So the model here
 * is deliberately explicit about three things the form itself leaves implicit:
 *
 *   - **Which basis is being filed on.** Tax Code 22.01(a)(5) lets the owner
 *     give either a good faith estimate of market value *or* the historical
 *     cost and year acquired. These are not equivalent, and the choice has
 *     consequences that outlast the filing — see `RenditionBasis`.
 *   - **What is deliberately absent.** Property classified off the rendition is
 *     listed with its reason rather than silently dropped, because "why is this
 *     not on here" is the first question anyone reviewing it will ask.
 *   - **What still blocks filing.** A rendition that cannot be filed yet should
 *     say what is missing, not render a form with holes in it.
 */

export const RENDITION_BASES = [
  /**
   * Historical cost and year acquired, per asset. The district applies its own
   * schedules to reach value.
   *
   * This is the default, for reasons that have nothing to do with convenience.
   * A good faith estimate can be demanded in writing within 21 days (22.07) and
   * has to be supportable; cost and year are facts from the client's own books.
   * And under 22.24(e) it is the *estimate* that drags an agent-filed rendition
   * into notarization — filing on cost avoids that entirely.
   */
  'cost',
  /**
   * A good faith estimate of market value. Worth choosing when the schedules
   * overstate what the property is actually worth — genuinely obsolete
   * equipment, mainly — and worth the notarization and the support obligation
   * that come with it.
   */
  'estimate',
] as const;

export const RenditionBasisSchema = z.enum(RENDITION_BASES);
export type RenditionBasis = (typeof RENDITION_BASES)[number];

/**
 * The schedules of Form 50-144 (rev. Oct 2025). Letters are the form's, not
 * ours, so that a reviewer holding the paper can follow along.
 */
export const RENDITION_SCHEDULES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export const RenditionScheduleKeySchema = z.enum(RENDITION_SCHEDULES);
export type RenditionScheduleKey = (typeof RENDITION_SCHEDULES)[number];

/**
 * One line of a schedule. Schedule E is filed by type *and year acquired*,
 * which is why the year is part of the line rather than of the asset.
 */
export const RenditionLineSchema = z.object({
  /** The form's own property-type wording. */
  type: z.string(),
  /** Null on schedules the form does not break down by year. */
  yearAcquired: z.number().int().nullable(),
  historicalCost: z.number(),
  /** Only populated when filing on the estimate basis. */
  goodFaithEstimate: z.number().nullable(),
  assetCount: z.number().int().nonnegative(),
  /** Our category keys behind this line, for drill-down. */
  categoryKeys: z.array(z.string()),
});

export type RenditionLine = z.infer<typeof RenditionLineSchema>;

export const RenditionScheduleSchema = z.object({
  key: RenditionScheduleKeySchema,
  title: z.string(),
  /** What the form asks for, in the form's own terms. */
  instruction: z.string(),
  lines: z.array(RenditionLineSchema),
  totalCost: z.number(),
  totalEstimate: z.number().nullable(),
});

export type RenditionSchedule = z.infer<typeof RenditionScheduleSchema>;

/** Property left off the form on purpose, with the reason. */
export const RenditionExclusionSchema = z.object({
  categoryKey: z.string(),
  label: z.string(),
  reason: z.string(),
  assetCount: z.number().int().nonnegative(),
  originalCost: z.number(),
});

export type RenditionExclusion = z.infer<typeof RenditionExclusionSchema>;

/** Something that has to be settled before this can be signed and sent. */
export const FILING_BLOCKER_SEVERITIES = ['blocking', 'warning'] as const;
export const FilingBlockerSeveritySchema = z.enum(FILING_BLOCKER_SEVERITIES);
export type FilingBlockerSeverity = (typeof FILING_BLOCKER_SEVERITIES)[number];

export const FilingBlockerSchema = z.object({
  key: z.string(),
  severity: FilingBlockerSeveritySchema,
  message: z.string(),
  /** What clears it. */
  resolution: z.string(),
});

export type FilingBlocker = z.infer<typeof FilingBlockerSchema>;

/** The statutory calendar for one tax year, with what each date governs. */
export const FilingDeadlineSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** ISO date. */
  date: z.string(),
  basis: z.string(),
});

export type FilingDeadline = z.infer<typeof FilingDeadlineSchema>;

/**
 * A committed finding, the decision standing against it, and what that decision
 * did to this form.
 *
 * Everything else on a rendition is derived — register in, schedules out. This
 * is the one place a human judgement reaches the paper, so it travels *on* the
 * document rather than being folded silently into the totals. A Schedule E that
 * is $54,300 lighter than the register has to be able to say who decided that,
 * on what day, and under which section.
 *
 * `effectOnForm` is populated even when the answer is "nothing", because that is
 * the common case and the surprising one: most accepted findings describe
 * property the register or the classification already keeps off the form, and a
 * blank there would read as an oversight rather than as an answer.
 */
export const RenditionDecisionSchema = z.object({
  source: FindingSourceSchema,
  key: z.string(),
  title: z.string(),
  /** The year the set was committed for. A prior year, for a comparison. */
  taxYear: z.number().int(),
  /** Null where the finding was committed and nobody has decided it yet. */
  status: FindingDispositionStatusSchema.nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().datetime().nullable(),
  /** What the finding claimed when it was committed. */
  cost: z.number(),
  /** What this actually took off the schedules, on the register as it stands. */
  removedCost: z.number(),
  removedAssetCount: z.number().int().nonnegative(),
  effectOnForm: z.string(),
});

export type RenditionDecision = z.infer<typeof RenditionDecisionSchema>;

export const RenditionSchema = z.object({
  engagementId: z.string(),
  clientName: z.string(),
  taxYear: z.number().int(),
  jurisdictionId: z.string().nullable(),
  jurisdictionName: z.string().nullable(),
  accountId: z.string().nullable(),
  sicCode: z.string().nullable(),
  generatedAt: z.string().datetime(),

  basis: RenditionBasisSchema,
  /** True when filed by us as the client's appointed agent (Form 50-162). */
  filedByAgent: z.boolean(),

  schedules: z.array(RenditionScheduleSchema),
  exclusions: z.array(RenditionExclusionSchema),
  /** Committed findings and what they did here. Empty until a set is committed. */
  decisions: z.array(RenditionDecisionSchema),

  totalHistoricalCost: z.number(),
  /** Total good faith estimate, when filing on that basis. */
  totalGoodFaithEstimate: z.number().nullable(),
  /** What the district's schedules produce — shown alongside, never filed as a GFE. */
  scheduleValue: z.number(),

  /**
   * True when the whole rendition qualifies for the simplified path: total
   * value under $20,000 goes on Schedule A, where the form makes the detail
   * optional. Worth detecting — it turns a 200-line filing into three fields.
   */
  qualifiesForScheduleA: z.boolean(),

  notarization: z.object({
    required: z.boolean(),
    reason: z.string(),
  }),

  blockers: z.array(FilingBlockerSchema),
  deadlines: z.array(FilingDeadlineSchema),
});

export type Rendition = z.infer<typeof RenditionSchema>;

export const RenditionRequestSchema = z.object({
  basis: RenditionBasisSchema.default('cost'),
  filedByAgent: z.boolean().default(true),
});

export type RenditionRequest = z.infer<typeof RenditionRequestSchema>;
