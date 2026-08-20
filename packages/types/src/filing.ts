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

/**
 * How the return physically reached the district.
 *
 * Recorded because the proof of timely filing depends on it. Tax Code 1.08
 * makes a properly addressed, postmarked return timely on the postmark date,
 * so a mailed rendition's evidence is the postmark and — where it was sent
 * certified — the receipt number. An e-filed one has a confirmation, a
 * hand-delivered one has a stamped copy and nothing else. Come the penalty
 * argument under 22.28, "we filed in April" is worth nothing next to "certified
 * article 7020 1290 0001 2345 6789, postmarked April 14".
 */
export const FILING_METHODS = [
  'certified-mail',
  'mail',
  'efile',
  'email',
  'hand-delivered',
] as const;

export const FilingMethodSchema = z.enum(FILING_METHODS);
export type FilingMethod = (typeof FILING_METHODS)[number];

export const FILING_RECORD_STATUSES = [
  /** The return that stands for this site and year. */
  'filed',
  /** Replaced by a later filing for the same site and year — an amendment. */
  'superseded',
  /** Recorded in error. Kept, because a rendition record is evidence. */
  'void',
] as const;

export const FilingRecordStatusSchema = z.enum(FILING_RECORD_STATUSES);
export type FilingRecordStatus = (typeof FILING_RECORD_STATUSES)[number];

/**
 * A rendition that was actually filed, frozen as it went out.
 *
 * Everything else in this app is derived from the register as it stands right
 * now, which is correct until the moment a document is sworn to. After that the
 * register keeps moving — a late invoice, a corrected cost, a disposal nobody
 * had recorded — and the form on screen quietly stops being the form that was
 * filed. Three things then break at once: there is no answer to "what did we
 * render", 22.28's penalty turns on a figure nobody can reproduce, and next
 * season's comparison is against a document we hold no copy of.
 *
 * So this freezes the *inputs* — the rendition, the party, the signer — rather
 * than the printed output. They are pure data, the builders that turn them into
 * paper are pure functions, and a frozen input re-renders through whatever the
 * current renderer is. Freezing the output instead would mean two copies of
 * every number and a slow drift between them. What that costs is that a later
 * form revision re-renders the same content on a different sheet, which is why
 * the revision and the checksum of the PDF that was actually filled are
 * recorded alongside: the record can then say so out loud.
 */
export const RenditionFilingSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  /** The site this return was for. A filing is always one account's. */
  locationId: z.string(),
  locationLabel: z.string(),
  /** The account as it stood when filed, which the district may later change. */
  accountId: z.string().nullable(),
  taxYear: z.number().int(),
  jurisdictionId: z.string().nullable(),

  status: FilingRecordStatusSchema,
  basis: RenditionBasisSchema,
  filedByAgent: z.boolean(),
  method: FilingMethodSchema,
  /** ISO date. The postmark or submission date, not when somebody typed it in. */
  filedOn: z.string(),
  /** Certified article number, e-file confirmation — whatever proves it went. */
  confirmation: z.string().nullable(),
  note: z.string().nullable(),

  /** What the form said, kept as columns so a list needs no unpacking. */
  totalHistoricalCost: z.number(),
  totalGoodFaithEstimate: z.number().nullable(),
  scheduleValue: z.number(),
  /** Assets on the schedules — the property sworn to, not the register slice. */
  assetCount: z.number().int().nonnegative(),

  /** The revision and checksum of the PDF that was filled at the time. */
  formRevision: z.string(),
  formSha256: z.string(),

  recordedBy: z.string().nullable(),
  recordedAt: z.string(),
  voidedBy: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
});

export type RenditionFiling = z.infer<typeof RenditionFilingSchema>;

/**
 * A filing with the frozen document itself, for reproducing the paper.
 *
 * Split from the summary because the document is large and every list of
 * filings would otherwise carry a full rendition per row.
 */
export const RenditionFilingRecordSchema = RenditionFilingSchema.extend({
  rendition: RenditionSchema,
  /**
   * The register rows this return was built from, by id.
   *
   * Not the same as what reached a schedule: the rendition sets some of them
   * aside and says why. This is the provenance — which rows produced this
   * document — and `assetCount` is the narrower figure, the property actually
   * reported.
   */
  assetIds: z.array(z.string()),
});

export type RenditionFilingRecord = z.infer<typeof RenditionFilingRecordSchema>;

/**
 * Record that a return went out.
 *
 * The rendition itself is not sent: it is rebuilt server-side from the
 * engagement and frozen there. A client that posted its own numbers could
 * record a filing that never matched anything the app would have produced,
 * which is the one thing this record exists to rule out.
 */
export const RecordFilingRequestSchema = z.object({
  locationId: z.string(),
  basis: RenditionBasisSchema.default('cost'),
  filedByAgent: z.boolean().default(true),
  method: FilingMethodSchema,
  /** ISO date (YYYY-MM-DD). Defaults to today on the client, never here. */
  filedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.'),
  confirmation: z
    .string()
    .trim()
    .max(120)
    .nullish()
    .transform((v) => (v ? v : null)),
  note: z
    .string()
    .trim()
    .max(1000)
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type RecordFilingRequest = z.infer<typeof RecordFilingRequestSchema>;

/** Marking a recorded filing as never having happened. */
export const VoidFilingRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Say why, so the record explains itself.').max(500),
});

export type VoidFilingRequest = z.infer<typeof VoidFilingRequestSchema>;
