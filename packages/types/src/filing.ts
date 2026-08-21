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

/**
 * The two extensions Tax Code 22.23(b) describes, which are not the same thing.
 *
 * The first sentence: on written request made before the deadline, the chief
 * appraiser **shall** extend to May 15. That is the owner's by right — the date
 * it buys is real the moment a timely request goes out, and the district
 * writing back is confirmation, not permission.
 *
 * The second: he **may** extend a further fifteen days for good cause shown in
 * writing. That is discretion. A deadline moved on the strength of a request
 * nobody has answered is a deadline somebody will miss, so an additional
 * request moves nothing until it is granted.
 */
export const EXTENSION_KINDS = ['standard', 'additional'] as const;

export const ExtensionKindSchema = z.enum(EXTENSION_KINDS);
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

export const EXTENSION_STATUSES = [
  /** Sent, no answer yet. Whether it moves the deadline depends on the kind. */
  'requested',
  /** The district said yes. */
  'granted',
  /** The district said no — for an additional request, the likely answer. */
  'denied',
  /** Replaced by a later request of the same kind for the same site and year. */
  'superseded',
  /** Recorded in error. Kept, for the same reason a void filing is kept. */
  'void',
] as const;

export const ExtensionStatusSchema = z.enum(EXTENSION_STATUSES);
export type ExtensionStatus = (typeof EXTENSION_STATUSES)[number];

/**
 * An extension request, as sent and as answered.
 *
 * Recorded for the same reason the filing is: come a 22.28 penalty argument,
 * "we asked for an extension" is worth nothing next to "certified article
 * 7020 1290 0001 2345 6789, postmarked April 13, for account 2349508". The
 * district's own answer may never arrive in writing, and under the first
 * sentence of 22.23(b) it does not have to — which makes our copy of the
 * request the whole of the evidence.
 */
export const RenditionExtensionSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  locationId: z.string(),
  locationLabel: z.string(),
  accountId: z.string().nullable(),
  taxYear: z.number().int(),

  kind: ExtensionKindSchema,
  status: ExtensionStatusSchema,

  /** ISO date the written request went out — the postmark, under 1.08. */
  requestedOn: z.string(),
  method: FilingMethodSchema,
  confirmation: z.string().nullable(),
  /** The good cause stated. Required for an additional request. */
  reason: z.string().nullable(),
  note: z.string().nullable(),

  /** ISO date this extension buys. May 15 observed, or the day the district named. */
  extendedTo: z.string(),

  /** When the district answered, and what it said. Null while outstanding. */
  answeredOn: z.string().nullable(),
  answerNote: z.string().nullable(),

  /**
   * Whether this request actually moves the deadline right now.
   *
   * Derived on read rather than stored, because it is a statement about three
   * things that move independently: the kind, the answer, and whether the
   * request beat the original due date. A standard request sent on April 16
   * is recorded — it is evidence either way — and buys nothing, because
   * 22.23(b) only obliges the chief appraiser where the request came first.
   */
  inForce: z.boolean(),
  /** Why it does or does not stand, in one sentence a person can act on. */
  standing: z.string(),
});

export type RenditionExtension = z.infer<typeof RenditionExtensionSchema>;

/**
 * Record that an extension request went out.
 *
 * `extendedTo` is not sent for a standard request — the date is May 15 observed
 * and the server takes it from the same statutory calendar every other deadline
 * comes from. An additional request must name it, because the day is whatever
 * the district granted and that is not ours to compute.
 */
export const RecordExtensionRequestSchema = z
  .object({
    locationId: z.string(),
    kind: ExtensionKindSchema.default('standard'),
    method: FilingMethodSchema,
    /** ISO date (YYYY-MM-DD). Defaults to today on the client, never here. */
    requestedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.'),
    /** ISO date. Required for an additional request, ignored for a standard one. */
    extendedTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.')
      .nullish()
      .transform((v) => v ?? null),
    confirmation: z
      .string()
      .trim()
      .max(120)
      .nullish()
      .transform((v) => (v ? v : null)),
    reason: z
      .string()
      .trim()
      .max(1000)
      .nullish()
      .transform((v) => (v ? v : null)),
    note: z
      .string()
      .trim()
      .max(1000)
      .nullish()
      .transform((v) => (v ? v : null)),
  })
  .refine((body) => body.kind !== 'additional' || body.reason !== null, {
    path: ['reason'],
    message:
      'An additional extension is granted only for good cause shown in writing (22.23(b)), so say what it was.',
  })
  .refine((body) => body.kind !== 'additional' || body.extendedTo !== null, {
    path: ['extendedTo'],
    message: 'Say which day the district granted — an additional extension runs to a date it names.',
  });

export type RecordExtensionRequest = z.infer<typeof RecordExtensionRequestSchema>;

/** The district's answer to a request already on file. */
export const AnswerExtensionRequestSchema = z.object({
  outcome: z.enum(['granted', 'denied', 'void']),
  /** ISO date the district answered. Not required to void — that is our own act. */
  answeredOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.')
    .nullish()
    .transform((v) => v ?? null),
  note: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v ? v : null)),
});

export type AnswerExtensionRequest = z.infer<typeof AnswerExtensionRequestSchema>;

// ---------------------------------------------------------------------------
// The district's answer
// ---------------------------------------------------------------------------

export const NOTICE_STATUSES = [
  /** The notice we are working to for this site and year. */
  'active',
  /** Replaced by a later notice for the same site and year — a corrected one. */
  'superseded',
  /** Recorded in error. Kept, for the same reason a void filing is kept. */
  'void',
] as const;

export const NoticeStatusSchema = z.enum(NOTICE_STATUSES);
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

/**
 * The dates and flags a protest window is decided from.
 *
 * Split out from the row so the rules in `@tangible/filing` can be given
 * exactly what they read and nothing else — which is what makes them testable
 * against a date rather than against a database.
 */
export const AssessmentNoticeFactsSchema = z.object({
  taxYear: z.number().int(),
  status: NoticeStatusSchema,
  /** ISO date printed on the notice. Under 1.07 this is presumed to be delivery. */
  noticedOn: z.string(),
  /** ISO date it actually arrived, where somebody recorded it. The better fact. */
  deliveredOn: z.string().nullable(),
  /** The protest deadline the notice itself prints, where it prints one. */
  printedDeadline: z.string().nullable(),
  /** Set where the notice says the 22.28 rendition penalty was applied. */
  renditionPenaltyApplied: z.boolean().nullable(),
  /** ISO date a protest went in, which closes the window whatever the date said. */
  protestFiledOn: z.string().nullable(),
});

export type AssessmentNoticeFacts = z.infer<typeof AssessmentNoticeFactsSchema>;

/**
 * When the protest window closes, and what that is worth saying about.
 *
 * Three dates rather than one, because they disagree and the disagreement is
 * the useful part. A district that prints a flat May 15 on a notice mailed on
 * April 28 has given a shorter window than 41.44 requires; a printed date later
 * than the statute allows usually means our delivery date is wrong. Either way
 * `deadline` is the shorter of the two — a tool whose job is not missing
 * deadlines does not get to pick the generous reading.
 */
export const ProtestStandingSchema = z.object({
  /** The day to work to. The shorter of what the statute gives and what was printed. */
  deadline: z.string(),
  /** 41.44's own answer: the later of May 15 and thirty days from delivery. */
  statutoryDeadline: z.string(),
  /** What the notice printed, where it printed anything. */
  printedDeadline: z.string().nullable(),
  /**
   * 22.30(b)'s thirty days to ask for the rendition penalty to be waived.
   *
   * Null unless a penalty was applied. Separate from the protest deadline
   * because it has no May 15 floor under it and so routinely closes first —
   * which is how a firm protests a value in time and loses the penalty anyway.
   */
  waiverDeadline: z.string().nullable(),
  /** Whether there is still time to protest. False once protested, too. */
  open: z.boolean(),
  /** Which date applies and why, in prose somebody can act on. */
  standing: z.string(),
});

export type ProtestStanding = z.infer<typeof ProtestStandingSchema>;

/** Something the notice says that is worth reading against what we filed. */
export const NoticeCheckSchema = z.object({
  key: z.string(),
  severity: z.enum(['critical', 'warning', 'note']),
  message: z.string(),
});

export type NoticeCheck = z.infer<typeof NoticeCheckSchema>;

/**
 * A notice of appraised value, as it arrived.
 *
 * The season did not end when the return went out. Under 25.19 the chief
 * appraiser delivers this by May 1 for personal property, and it is the first
 * time anybody finds out whether the filing worked. Everything expensive about
 * a BPP engagement happens in the four weeks after it: 41.44 gives the later of
 * May 15 and thirty days to protest, and a value nobody protested is the value
 * the client pays on for the year.
 *
 * Recorded per site and year for the same reason a filing is — the notice comes
 * addressed to an account, and an account belongs to a site. Recording a
 * corrected notice supersedes the earlier one rather than editing it.
 */
export const AssessmentNoticeSchema = AssessmentNoticeFactsSchema.extend({
  id: z.string(),
  engagementId: z.string(),
  locationId: z.string(),
  /** The label and account as they read when the notice was recorded. */
  locationLabel: z.string(),
  accountId: z.string().nullable(),
  /** The district as the notice names itself, where that was typed in. */
  districtName: z.string().nullable(),

  /** What the district concluded. Null where the notice does not print it. */
  appraisedValue: z.number().nullable(),
  assessedValue: z.number().nullable(),
  /** The prior year figure most notices print alongside. */
  priorYearValue: z.number().nullable(),

  note: z.string().nullable(),
  protestNote: z.string().nullable(),

  recordedBy: z.string().nullable(),
  recordedAt: z.string(),
  voidedBy: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),

  /** Derived on read: which clock applies, and what to do about it. */
  protest: ProtestStandingSchema,
  /** Derived on read: what this notice says against what we filed. */
  checks: z.array(NoticeCheckSchema),
});

export type AssessmentNotice = z.infer<typeof AssessmentNoticeSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.');
const optionalIsoDate = isoDate.nullish().transform((v) => v ?? null);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

/**
 * Record a notice that arrived.
 *
 * Every figure is optional and the date on the notice is not, because the date
 * is what starts the clock and the figures are what a protest would be about.
 * A notice typed in from the envelope on the day it lands — date only — is
 * worth more than one recorded in full a week after the window closed.
 */
export const RecordNoticeRequestSchema = z.object({
  locationId: z.string(),
  noticedOn: isoDate,
  deliveredOn: optionalIsoDate,
  printedDeadline: optionalIsoDate,
  districtName: optionalText(160),
  appraisedValue: z.number().nonnegative().nullish().transform((v) => v ?? null),
  assessedValue: z.number().nonnegative().nullish().transform((v) => v ?? null),
  priorYearValue: z.number().nonnegative().nullish().transform((v) => v ?? null),
  renditionPenaltyApplied: z.boolean().nullish().transform((v) => v ?? null),
  note: optionalText(1000),
});

export type RecordNoticeRequest = z.infer<typeof RecordNoticeRequestSchema>;

/**
 * Write down that a protest went in, or take back a row recorded in error.
 *
 * Kept apart the way an extension's denial is kept apart from its void: "we
 * protested this value" and "this notice was never ours" are different facts,
 * and only the first one closes a window.
 */
export const UpdateNoticeRequestSchema = z
  .object({
    outcome: z.enum(['protested', 'void']),
    /** ISO date the protest was filed. Not required to void — that is our own act. */
    protestFiledOn: optionalIsoDate,
    note: optionalText(1000),
  })
  .refine((body) => body.outcome !== 'protested' || body.protestFiledOn !== null, {
    path: ['protestFiledOn'],
    message: 'Say which day the protest went in — 41.44 makes the date the condition of a hearing.',
  })
  .refine((body) => body.outcome !== 'void' || body.note !== null, {
    path: ['note'],
    message: 'Say why this notice is being taken back.',
  });

export type UpdateNoticeRequest = z.infer<typeof UpdateNoticeRequestSchema>;

/**
 * Where one of an engagement's returns stands.
 *
 * Three states, and they are the three answers to "can this go out today":
 * filed already, ready to go, or held up by something. Nothing here is a
 * judgement about quality — a return is `ready` when the record gate would
 * accept it, which is the same test {@link RecordFilingRequestSchema} is put
 * through, not a separate opinion about whether it is any good.
 */
export const SEASON_RETURN_STATUSES = ['filed', 'ready', 'blocked'] as const;

export const SeasonReturnStatusSchema = z.enum(SEASON_RETURN_STATUSES);
export type SeasonReturnStatus = (typeof SEASON_RETURN_STATUSES)[number];

export const SeasonReturnSchema = z.object({
  locationId: z.string(),
  label: z.string(),
  accountId: z.string().nullable(),
  /**
   * The district this return goes to — the site's own where it names one, else
   * the engagement's. On the board because a season is where two of them would
   * first be visible together, and a return filed with the wrong district is
   * not a late return, it is a return the right district never received.
   */
  jurisdictionId: z.string().nullable(),
  status: SeasonReturnStatusSchema,

  /** Held property at this site, and what the register says it cost. */
  assetCount: z.number().int().nonnegative(),
  registerCost: z.number(),
  /**
   * What the draft would file today, which is not the register total: the
   * rendition sets aside property disposed of before January 1, intangibles,
   * and anything an accepted finding removed.
   */
  renderedCost: z.number(),

  /**
   * What is stopping it, in the record gate's own words. Empty when nothing is.
   *
   * Keyed rather than prose so a season above one engagement can count them.
   * The messages name sites and interpolate counts, so the same defect on two
   * returns reads as two sentences — right for a row somebody is working, and
   * useless for the question of how many returns one fix would release.
   */
  blockers: z.array(FilingBlockerSchema),
  /** Things worth reading before signing, but which do not stop a filing. */
  warnings: z.number().int().nonnegative(),

  /**
   * The deadline this return is actually working to, and how long is left.
   *
   * Per return rather than per engagement, because an extension is per account:
   * one site's request under 22.23(b) buys that site until May 15 and says
   * nothing about the one next door. A board that printed the statutory April
   * date against every row would be wrong about every extended one, and wrong
   * in the direction that makes people file early for no reason.
   */
  dueOn: z.string(),
  daysToDue: z.number().int(),
  /** The extension moving that date, where one stands. */
  extension: RenditionExtensionSchema.nullable(),

  /** The return that stands for this site and year, where one went out. */
  filing: RenditionFilingSchema.nullable(),
  /**
   * The district's answer, where it has arrived.
   *
   * On the board rather than on a screen of its own because the board is the
   * only place that already knows what went out for this site — and the two
   * facts are only worth anything together. A notice on its own is a number in
   * the post; a notice beside the return it answers is either a value that
   * matches the district's own schedule or a protest with an argument in it.
   *
   * Null covers two different things and the board says which: no notice has
   * come yet, or one came and nobody recorded it. Under 25.19 personal-property
   * notices go out by May 1, so after that date the second reading gets likelier
   * every week.
   */
  notice: AssessmentNoticeSchema.nullable(),
  /**
   * What the register has done since this was filed, as a difference in cost.
   *
   * Null unless filed. A non-zero figure is not by itself a defect — it says
   * the draft no longer reproduces the filed document, which is the question
   * behind "do we owe an amendment", not the answer to it.
   */
  driftedBy: z.number().nullable(),
});

export type SeasonReturn = z.infer<typeof SeasonReturnSchema>;

/**
 * Every return an engagement owes and where each one stands.
 *
 * The thing an engagement is missing without this is a season. Each screen
 * before it answers about one document — this draft, this filing, this site —
 * and none of them answers "what still has to go out, and by when", which is
 * the question a filer actually holds in their head between January and April.
 *
 * Rows are the union of what is owed and what was filed, deliberately. A site
 * whose property has all been disposed of since the return went out owes
 * nothing now and still has a filing standing against it; dropping it because
 * the register no longer holds property there would quietly retire a document
 * the district is still working from.
 */
export const FilingSeasonSchema = z.object({
  taxYear: z.number().int(),
  /**
   * The statutory calendar for this tax year, before anybody asks for anything.
   *
   * Kept alongside the per-return dates rather than replaced by them: the
   * engagement-wide fact is what an extension is measured against, and a row
   * that says May 15 means nothing to a reader who cannot see it started as
   * April 15.
   */
  dueOn: z.string(),
  extendedDueOn: z.string(),
  /** Days from today to the statutory deadline. Negative once it has passed. */
  daysToDue: z.number().int(),

  returns: z.array(SeasonReturnSchema),

  /** Held property on no return at all, because its site is unresolved. */
  unplacedCount: z.number().int().nonnegative(),
  unplacedCost: z.number(),
});

export type FilingSeason = z.infer<typeof FilingSeasonSchema>;

/**
 * One return on the practice board, carrying who it is for.
 *
 * The same row the engagement board renders, plus the client. Above one
 * engagement the site label stops identifying anything — half the firms in
 * Texas have a "Main Office" — so the client has to travel with it.
 */
export const PracticeReturnSchema = SeasonReturnSchema.extend({
  clientId: z.string(),
  clientName: z.string(),
  engagementId: z.string(),
  taxYear: z.number().int(),

  /**
   * Other returns in the book covering this same site and year. Zero normally.
   *
   * Sites hang off the client rather than the engagement, so opening a second
   * engagement for a client mid-season gives both of them the same sites — and
   * both then owe a return for each. Under 22.01 a taxpayer renders an account
   * once for a year, so two drafts for one site is not two returns; it is one
   * return with a second draft of it, and only a view above the engagement can
   * see that, because the two drafts live under different engagements.
   */
  alsoOn: z.number().int().nonnegative(),
});

export type PracticeReturn = z.infer<typeof PracticeReturnSchema>;

/**
 * One defect, and every return it is holding.
 *
 * The thing a practice knows that no engagement page can. A return blocked on
 * "no Form 50-162 on file with this district" is one client's problem; the same
 * key standing against fourteen returns is an afternoon that releases fourteen
 * returns, and it is invisible from inside any one of them. Ranked by what it
 * holds rather than by severity, because everything here is blocking already.
 */
export const SeasonHoldSchema = z.object({
  key: z.string(),
  /**
   * One return's wording of it, as an example rather than a summary.
   *
   * The messages interpolate counts and site names, so there is no single true
   * sentence for a defect standing against fourteen returns. Showing one real
   * one is honest; synthesising a general one would invent a sentence the
   * record gate never says.
   */
  message: z.string(),
  resolution: z.string(),
  returns: z.number().int().positive(),
  clients: z.number().int().positive(),
  /** Rendered cost sitting behind it. */
  cost: z.number(),
});

export type SeasonHold = z.infer<typeof SeasonHoldSchema>;

/**
 * The season across every client, for one tax year.
 *
 * The view above an engagement, which the app did not have. A firm filing the
 * five-to-a-hundred returns this is built for cannot work a season by opening
 * clients one at a time, and the two questions it actually has — what crosses a
 * deadline next, and what is holding the rest up — are both questions about the
 * whole book rather than any one engagement.
 */
export const PracticeSeasonSchema = z.object({
  taxYear: z.number().int(),
  dueOn: z.string(),
  extendedDueOn: z.string(),
  daysToDue: z.number().int(),

  /** Tax years with an engagement on them, newest first, for the year picker. */
  years: z.array(z.number().int()),

  clientCount: z.number().int().nonnegative(),
  engagementCount: z.number().int().nonnegative(),

  returns: z.array(PracticeReturnSchema),
  holds: z.array(SeasonHoldSchema),

  /** Held property on no return at all, summed across the book. */
  unplacedCount: z.number().int().nonnegative(),
  unplacedCost: z.number(),
});

export type PracticeSeason = z.infer<typeof PracticeSeasonSchema>;
