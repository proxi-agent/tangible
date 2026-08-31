import { z } from 'zod';
import { DetectionSignalSchema } from './savings.js';

/* ── The rules repository ────────────────────────────────────────────────────
 *
 * A depreciation table and a detector are both *rules*: a written position
 * about how a taxpayer's property should be treated, which someone will have to
 * defend to an appraiser. Incumbent products fail here in a boring, expensive
 * way — the tables go quietly stale, nobody notices for a season, and every
 * return filed in between is wrong in the same direction.
 *
 * The fix is not more care. It is making a rule unable to exist in the codebase
 * without saying, in the type system, four things:
 *
 *   - what authority it rests on (a statute or the assessor's own guide);
 *   - the dates it is in effect between, so a stale one is a computable fact
 *     rather than a thing a person has to remember to check;
 *   - which jurisdictions and tax years it covers, because "Harris County's
 *     tables" applied to a Denton account is the same class of error;
 *   - who wrote it and who approved it.
 *
 * The last pair is why `approvedBy` is nullable rather than optional. A rule
 * may sit in the repo unapproved — that is how a drafted schedule arrives — but
 * the release gate refuses to ship one, and a nullable field makes the
 * unapproved state something the code can see instead of something the author
 * forgot to fill in.
 */

export const RuleProvenanceSchema = z.object({
  /** Stable and namespaced: `valuation:tx-harris:2026`, `detector:ghost-assets`. */
  ruleId: z.string(),
  /** How a person says it, for the dashboard and the approval record. */
  title: z.string(),
  /**
   * The authority. A statute where one exists — "Tex. Tax Code 22.01(a)" — and
   * the district's own published guide where the rule is arithmetic rather than
   * law. Never empty: a rule with no citation is a preference.
   */
  citation: z.string().min(1),
  source: z
    .object({
      title: z.string(),
      url: z.string().nullable(),
      /** Page or section within the source, where the source is a document. */
      pages: z.string().nullable(),
    })
    .nullable(),
  /**
   * The window this rule is correct for, as ISO dates. `effectiveTo` is null
   * for a rule with no published end — the common case for a statute, and the
   * reason staleness has to be judged against the *tax year* scope as well.
   */
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  /** Jurisdiction ids this rule applies to. Null means every jurisdiction. */
  jurisdictions: z.array(z.string()).nullable(),
  /** Tax years this rule applies to. Null means every year in the window. */
  taxYears: z.array(z.number().int()).nullable(),
  authoredBy: z.string(),
  authoredAt: z.string(),
  /** Null until a person with standing has signed off. The gate reads this. */
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  notes: z.string().nullable(),
});

export type RuleProvenance = z.infer<typeof RuleProvenanceSchema>;

/**
 * What the dashboard prints for one rule: its provenance, plus the two facts
 * about it that are not in the provenance — whether anything tests it, and
 * whether it is still in effect today.
 */
export const RuleStatusSchema = z.object({
  provenance: RuleProvenanceSchema,
  /**
   * `rate` joined `valuation` and `detector` when the adopted tax rates became
   * committed data. It is a third kind rather than a second `valuation`
   * because the gate treats it differently in one place: a depreciation table
   * out of its effective window is a block — valuing 2027 property on the 2026
   * guide is the silent-wrong-number failure this harness exists for — where a
   * rate table out of its window is the ordinary case, since prior years are
   * exactly what a 25.25 correction or a late protest prices.
   */
  kind: z.enum(['valuation', 'rate', 'detector']),
  /** Goldens covering this rule. Zero is the state the gate complains about. */
  goldenCount: z.number().int().nonnegative(),
  /** Labeled decisions carrying this rule's key. Only detectors accumulate these. */
  labelCount: z.number().int().nonnegative(),
  inEffect: z.boolean(),
  /** Why not, where `inEffect` is false — expired, or not yet begun. */
  staleReason: z.string().nullable(),
});

export type RuleStatus = z.infer<typeof RuleStatusSchema>;

/* ── Labels ──────────────────────────────────────────────────────────────────
 *
 * A label is one reviewer's answer about one flagged row, paired with the
 * signals that were showing when they answered. The pairing is the whole point:
 * the engine will be retuned, and a decision recorded against weights nobody
 * can reconstruct teaches nothing. `finding_row_decisions` has stamped the
 * signals and the score at decision time since the review queue was built, for
 * exactly this — the queue is a labeling pipeline wearing a workflow.
 */

export const EvalVerdictSchema = z.enum(['correct', 'incorrect', 'abstain']);
export type EvalVerdict = z.infer<typeof EvalVerdictSchema>;

export const EvalLabelSchema = z.object({
  rowKey: z.string(),
  findingKey: z.string(),
  assetId: z.string(),
  engagementId: z.string(),
  /** Where the property sits, which is what makes precision comparable. */
  jurisdictionId: z.string().nullable(),
  taxYear: z.number().int().nullable(),
  verdict: EvalVerdictSchema,
  decidedAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedByAudience: z.enum(['firm', 'client']),
  /** The score the row carried when the decision was made, not today's. */
  confidenceScore: z.number().nullable(),
  confidenceTier: z.enum(['high', 'medium', 'low']).nullable(),
  signals: z.array(DetectionSignalSchema),
  decidedValue: z.number().nullable(),
  decidedTaxAtRisk: z.number().nullable(),
  /** The rules version that produced the row, so a label can be aged out. */
  rulesVersion: z.string().nullable(),
});

export type EvalLabel = z.infer<typeof EvalLabelSchema>;

/* ── Metrics ─────────────────────────────────────────────────────────────────
 *
 * Precision is measurable from labels and recall is not, and the two are kept
 * apart here rather than reported side by side as if they were the same kind of
 * number.
 *
 * Precision is: of the rows we put in front of a reviewer, what share did they
 * accept. Every accepted or rejected decision is one observation, and there is
 * nothing to guess.
 *
 * Recall would be: of the positions that were really there, what share did we
 * find. Nothing in a register knows that. A row we never flagged produces no
 * decision, so no quantity of labels can measure it. Recall is therefore
 * reported only against goldens — a fixture register where the full expected
 * set is declared by hand — and `recall` is absent from this shape on purpose.
 */

export const FindingMetricsSchema = z.object({
  findingKey: z.string(),
  /** Null in the roll-up across every jurisdiction. */
  jurisdictionId: z.string().nullable(),
  /** Decisions that count toward precision: accepted plus rejected. */
  judged: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  incorrect: z.number().int().nonnegative(),
  /** Sent to the client, or parked. Real work, and not evidence either way. */
  abstained: z.number().int().nonnegative(),
  /** correct / judged. Null below the minimum sample — see `MIN_JUDGED`. */
  precision: z.number().nullable(),
  /**
   * The half-width of the 95% Wilson interval. A precision of 1.00 on four
   * rows and one of 0.94 on three hundred are different claims, and a
   * dashboard that prints only the point estimate hides which is which.
   */
  interval: z.number().nullable(),
  /** Dollars behind the accepted rows, and behind the rejected ones. */
  correctValue: z.number(),
  incorrectValue: z.number(),
  /** Against the 200–500 per finding type the harness is aiming at. */
  labeled: z.number().int().nonnegative(),
  target: z.number().int().nonnegative(),
});

export type FindingMetrics = z.infer<typeof FindingMetricsSchema>;

/**
 * Does a 0.8 mean 0.8. One bin per confidence band, holding what the engine
 * claimed and what reviewers actually did. Calibration is the property that
 * makes the confidence floor a usable product control: a client who sets their
 * portal to "high confidence only" is trusting this table.
 */
export const CalibrationBinSchema = z.object({
  lower: z.number(),
  upper: z.number(),
  judged: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  /** Mean claimed score in the bin. */
  expected: z.number().nullable(),
  /** Share actually accepted. */
  observed: z.number().nullable(),
});

export type CalibrationBin = z.infer<typeof CalibrationBinSchema>;

/**
 * Precision at each candidate confidence floor, with what it costs.
 *
 * The threshold is already a product control — it is the number behind the
 * portal's confidence filter and behind which rows reach the queue. This sweep
 * is what turns setting it into a decision with a price: at 0.6 precision is
 * this and you drop that many true positives worth that many dollars.
 */
export const ThresholdPointSchema = z.object({
  threshold: z.number(),
  judged: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  precision: z.number().nullable(),
  /** Share of all accepted rows still above the floor. */
  keptCorrectShare: z.number().nullable(),
  /** Dollars of accepted work the floor would have hidden. */
  droppedCorrectValue: z.number(),
});

export type ThresholdPoint = z.infer<typeof ThresholdPointSchema>;

export const QualityReportSchema = z.object({
  generatedAt: z.string(),
  labelCount: z.number().int().nonnegative(),
  judgedCount: z.number().int().nonnegative(),
  /** Precision across everything judged. The one number on the front page. */
  precision: z.number().nullable(),
  /** Per finding key, rolled up across jurisdictions. */
  byFinding: z.array(FindingMetricsSchema),
  /** Per finding key per jurisdiction — the grain the phase asks for. */
  byFindingJurisdiction: z.array(FindingMetricsSchema),
  calibration: z.array(CalibrationBinSchema),
  thresholds: z.array(ThresholdPointSchema),
  /** Engagements and reviewers behind the labels, so a reader can weigh them. */
  engagementCount: z.number().int().nonnegative(),
  reviewerCount: z.number().int().nonnegative(),
});

export type QualityReport = z.infer<typeof QualityReportSchema>;

/* ── Goldens and the gate ────────────────────────────────────────────────────
 *
 * Two kinds, because two different things go wrong.
 *
 * A valuation golden is one asset and the value the district's own arithmetic
 * produces for it. It is the guard against a depreciation table going stale or
 * being mistyped, and it is the only test in this product that a taxpayer could
 * check against their own assessment notice.
 *
 * A detector golden is a small register and the findings that should come off
 * it. It is the guard against a detector's threshold drifting: an asset that
 * must be flagged, an asset that must not be, and the reason for each.
 */

export const GoldenBasisSchema = z.enum(['assessment-notice', 'published-schedule']);
export type GoldenBasis = z.infer<typeof GoldenBasisSchema>;

export const GoldenOutcomeSchema = z.object({
  id: z.string(),
  kind: z.enum(['valuation', 'detector']),
  jurisdictionId: z.string().nullable(),
  taxYear: z.number().int().nullable(),
  passed: z.boolean(),
  /** What went wrong, in the reviewer's terms rather than a diff. */
  detail: z.string(),
});

export type GoldenOutcome = z.infer<typeof GoldenOutcomeSchema>;

export const GateResultSchema = z.object({
  ok: z.boolean(),
  ranAt: z.string(),
  goldensRun: z.number().int().nonnegative(),
  goldensFailed: z.number().int().nonnegative(),
  /** Every reason the gate is closed, each a sentence a person can act on. */
  failures: z.array(z.string()),
  /** Things that are wrong but not blocking, so they are said rather than hidden. */
  warnings: z.array(z.string()),
  outcomes: z.array(GoldenOutcomeSchema),
});

export type GateResult = z.infer<typeof GateResultSchema>;

/**
 * What the quality screen is handed.
 *
 * The firm's own decisions and the client's are scored separately and both are
 * carried, because they answer different questions. The firm's number is "is
 * the detector right"; the client's is "does the taxpayer want to make this
 * argument", and a detector can be right about a machine the controller has
 * decided not to fight over.
 */
export const QualityViewSchema = z.object({
  report: QualityReportSchema,
  clientReport: QualityReportSchema,
  rules: z.array(RuleStatusSchema),
  gate: GateResultSchema,
  engagements: z.array(
    z.object({
      id: z.string(),
      clientName: z.string(),
      taxYear: z.number().int(),
      labels: z.number().int().nonnegative(),
    }),
  ),
});

export type QualityView = z.infer<typeof QualityViewSchema>;

/* ── Offline rule authoring ──────────────────────────────────────────────────
 *
 * Adding a county today means a person reading a PDF and typing several hundred
 * numbers into a TypeScript file. That is slow, and worse, it is the kind of
 * work where a transcription error produces a plausible number rather than an
 * obvious one.
 *
 * So a model reads the guide and drafts the rule. Three things keep that from
 * becoming "the AI decides what your property is worth". The model's output is
 * *data* — tables and citations, never code and never a valuation. The draft is
 * checked against invariants that hold for every published schedule, so a
 * hallucinated cell fails arithmetic rather than review. And the artifact is a
 * source file a person reads, edits and commits: nothing reaches a client
 * because a model produced it, and runtime valuation never calls a model at all.
 */

export const ScheduleDraftCellSchema = z.object({
  year: z.number().int(),
  value: z.number(),
});

export const ScheduleDraftSchema = z.object({
  /** The id the module will carry, e.g. 'tx-dallas'. */
  jurisdictionId: z.string(),
  jurisdictionName: z.string(),
  taxYear: z.number().int(),
  /** Everything the provenance record needs that only the document can supply. */
  title: z.string(),
  citation: z.string(),
  sourceTitle: z.string(),
  sourceUrl: z.string().nullable(),
  sourcePages: z.string().nullable(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  /** Year acquired → cost index factor, as published. */
  indexFactors: z.array(ScheduleDraftCellSchema),
  /** Life class in years → the percent-good column for it. */
  percentGood: z.array(
    z.object({ lifeClass: z.number().int(), cells: z.array(ScheduleDraftCellSchema) }),
  ),
  specialPercentGood: z.array(
    z.object({ schedule: z.string(), cells: z.array(ScheduleDraftCellSchema) }),
  ),
  sicProfiles: z.array(
    z.object({
      sic: z.string(),
      description: z.string(),
      machineryLife: z.number().int(),
      miscLife: z.number().int(),
      stateClass: z.string().nullable(),
    }),
  ),
  /**
   * Figures the document did not settle, in the model's own words.
   *
   * Required and load-bearing. A model asked to transcribe a table will fill a
   * gap rather than leave one, and a schedule with an invented cell is exactly
   * the failure this whole phase exists to catch. Anything listed here blocks
   * approval until a person reads that part of the guide themselves.
   */
  gaps: z.array(z.string()),
  /** What the model noticed that a reviewer should look at. */
  notes: z.string().nullable(),
});

export type ScheduleDraft = z.infer<typeof ScheduleDraftSchema>;

/** What the deterministic side says about a draft before anyone reads it. */
export const DraftReviewSchema = z.object({
  /** Whether the draft is even coherent enough to be worth a person's time. */
  ok: z.boolean(),
  /** Arithmetic that cannot be true of any published schedule. */
  problems: z.array(z.string()),
  /** True but worth a look — a thin table, an unusual life class. */
  observations: z.array(z.string()),
  /** The module a person would commit, and the goldens that would guard it. */
  scheduleModule: z.string(),
  goldenModule: z.string(),
});

export type DraftReview = z.infer<typeof DraftReviewSchema>;

/**
 * What the firm sends when it wants a district's guide drafted.
 *
 * `guideText` is pasted rather than fetched. A district's PDF sits behind a
 * portal as often as not, and the extraction is a person's job anyway — they
 * are the one who knows whether the table they copied is the whole table. It
 * also keeps the server from following a URL somebody typed.
 */
export const DraftScheduleRequestSchema = z.object({
  jurisdictionId: z
    .string()
    .regex(/^[a-z]{2}-[a-z-]+$/, 'A jurisdiction id looks like "tx-dallas".'),
  jurisdictionName: z.string().min(3),
  taxYear: z.number().int().min(2000).max(2100),
  sourceTitle: z.string().min(3),
  sourceUrl: z.string().url().nullable(),
  /** Enough of the guide to carry the tables. Short text means a partial draft. */
  guideText: z.string().min(200, 'That is too little text to contain a schedule.'),
});

export type DraftScheduleRequest = z.infer<typeof DraftScheduleRequestSchema>;

/** A draft and the verdict on it. Nothing is stored; the repo is the record. */
export const DraftScheduleResultSchema = z.object({
  draft: ScheduleDraftSchema,
  review: DraftReviewSchema,
  model: z.string(),
});

export type DraftScheduleResult = z.infer<typeof DraftScheduleResultSchema>;

/* ── The fitted model ────────────────────────────────────────────────────────
 *
 * Every confidence number in this product has, until now, been a sum of weights
 * somebody wrote down. That was the right way to start — a weight with a
 * sentence next to it is arguable, and a fitted number nobody can question is
 * not — but it was always meant to end. The review queue has been stamping each
 * decision with the signals that were showing when it was made, which is a
 * training set in the only form that is worth anything: real reviewers, under
 * the pressure of a return that had to be right, answering about specific
 * assets.
 *
 * What follows is that training set turned into coefficients, and — more
 * importantly — the evidence that the coefficients are better than the weights
 * they would replace. A model is adopted for a finding only when it beats the
 * hand rule out of fold on that finding's own labels. Everything here is
 * printed so a person can see which findings the engine has stopped guessing
 * about and which it has not.
 */

/**
 * One signal's weight, before and after the labels had their say.
 *
 * `prior` is the hand-authored weight translated into log-odds at the finding's
 * base rate, which is what makes the two numbers comparable at all: the rule
 * added its weights to a probability, and probabilities do not add. `fitted` is
 * where the labels moved it. A signal seen four times will show the two nearly
 * equal, and that is the shrinkage working rather than the fit failing.
 */
export const ModelFeatureSchema = z.object({
  code: z.string(),
  label: z.string(),
  prior: z.number(),
  fitted: z.number(),
  /** Labels in which this signal was present. */
  observations: z.number().int().nonnegative(),
  /** Of those, the ones a reviewer accepted. */
  accepted: z.number().int().nonnegative(),
});

export type ModelFeature = z.infer<typeof ModelFeatureSchema>;

/** What one finding's model knows, and whether anyone should be using it. */
export const FindingModelSchema = z.object({
  findingKey: z.string(),
  labels: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  /** Log-odds. `priorIntercept` is the hand-authored base rate, logit'd. */
  intercept: z.number(),
  priorIntercept: z.number(),
  features: z.array(ModelFeatureSchema),
  /** Whether this model is the one scoring rows today. */
  adopted: z.boolean(),
  /** Why, in a sentence — the same sentence whether it was adopted or not. */
  reason: z.string(),
  /**
   * Mean log loss out of fold, model against hand rule. Null where there were
   * too few labels to hold any out, which is most findings for a long while.
   */
  fittedLoss: z.number().nullable(),
  baselineLoss: z.number().nullable(),
  /** Out-of-fold reliability: what the model claimed against what happened. */
  reliability: z.array(CalibrationBinSchema),
});

export type FindingModel = z.infer<typeof FindingModelSchema>;

/**
 * Every finding's model, fitted together and adopted separately.
 *
 * Separately because the label counts are wildly uneven — a register throws off
 * hundreds of ghost rows and a handful of freeport ones — and a single adoption
 * switch would either hold the whole engine back for the rarest finding or
 * push a four-label model onto the queue.
 */
export const DetectionModelSchema = z.object({
  findings: z.array(FindingModelSchema),
  /** Finding keys whose fitted coefficients are in use. */
  adopted: z.array(z.string()),
  labels: z.number().int().nonnegative(),
  generatedAt: z.string(),
});

export type DetectionModel = z.infer<typeof DetectionModelSchema>;
