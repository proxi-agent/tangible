import { z } from 'zod';
import { MachinerySicSchema } from './classification.js';

/**
 * The savings report: what the client is assessed, what the register actually
 * supports, and every dollar of the difference attributed to a named reason.
 *
 * This is the deliverable the whole product points at — the thing handed to a
 * prospect who has not agreed to anything yet. So it is built to be argued with
 * rather than admired. Three rules follow from that:
 *
 *   - **Every finding says how solid it is.** A number computed from data we
 *     hold reads differently from one that rests on an assumption about how the
 *     client rendered, which reads differently again from a question we cannot
 *     answer without asking them. Blending those three into one total is how a
 *     savings estimate becomes a number nobody can defend in a hearing.
 *   - **Every finding carries its evidence.** A line saying "$96,000 of software
 *     should come off" is worthless without the rows it came from; a controller
 *     will want to see them, and so will the district.
 *   - **Nothing unreviewed is counted.** Assets still in the classification
 *     queue are excluded and said out loud, because a savings figure inflated by
 *     unreviewed guesses is worse than no figure at all.
 */

export const FINDING_KINDS = [
  /** Computed from data we hold. The number is what it is. */
  'measured',
  /** Rests on a stated assumption about how the client rendered. */
  'modeled',
  /** A question we cannot answer from a register — worth real money, needs asking. */
  'screening',
] as const;

export const FindingKindSchema = z.enum(FINDING_KINDS);
export type FindingKind = (typeof FINDING_KINDS)[number];

/**
 * Which way a finding moves the client's position.
 *
 * Orthogonal to `FindingKind` on purpose, and the reason the two are separate
 * axes: an under-reported category is a real, well-evidenced, *measured*
 * finding that the client owes more than they filed. Folding that into the same
 * scale as a saving is how a report ends up quietly netting exposure against
 * relief and presenting the remainder as money saved.
 */
export const FINDING_EFFECTS = [
  /** Acting on it takes value off the return. */
  'saving',
  /** The client is under-reported and should hear it from us first. */
  'exposure',
  'neutral',
] as const;

export const FindingEffectSchema = z.enum(FINDING_EFFECTS);
export type FindingEffect = (typeof FINDING_EFFECTS)[number];

/** One row backing a finding, so the claim can be checked line by line. */
export const FindingEvidenceSchema = z.object({
  assetId: z.string(),
  /**
   * The register's own identifier for the row, where it had one. Our `assetId`
   * is a uuid we minted; it means nothing to the person who exported the file,
   * and a client asked to check a claim against it cannot. The tag is how they
   * find the line in their own system.
   */
  assetTag: z.string().nullable(),
  description: z.string().nullable(),
  acquisitionYear: z.number().int().nullable(),
  originalCost: z.number().nullable(),
  /** What the district's schedules produce for it, where that is computable. */
  scheduleValue: z.number().nullable(),
  categoryKey: z.string().nullable(),
});

export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

/* ── Per-asset finding rows ──────────────────────────────────────────────────
 *
 * A category total is a claim about a group; a row is a claim about a thing the
 * client owns. Only the second can be argued with, accepted, rejected, filtered
 * or exported, and everything a reviewer does happens at that grain — so the
 * engine emits rows and the category totals are read off them.
 *
 * Three numbers make a row reviewable rather than merely visible: what the
 * property is carrying on the return as it stands, what it should carry once
 * the finding is applied, and the tax between the two. The third is not a
 * separate fact — it is the second subtracted from the first at the blended
 * rate — but a reviewer deciding twenty rows in a morning should not have to do
 * that arithmetic twenty times.
 */

export const CONFIDENCE_TIERS = ['high', 'medium', 'low'] as const;
export const ConfidenceTierSchema = z.enum(CONFIDENCE_TIERS);
export type ConfidenceTier = (typeof CONFIDENCE_TIERS)[number];

/**
 * One reason a row was flagged, recorded rather than summarised away.
 *
 * The difference matters more than it looks. A finding that says "these 43
 * assets are disposed" cannot be audited, tuned, or learned from; a finding
 * that says "41 of them because the register carries a disposal date, 2 because
 * it carries only a flag" can be all three. It is also the only way the
 * detection basis at the top of a category page can be true rather than
 * written — the counts are a group-by over these, not prose someone maintained.
 *
 * `weight` is signed and is what the row's confidence is built from, so a
 * reader who disagrees with a score can see which signal to argue with.
 */
export const DetectionSignalSchema = z.object({
  code: z.string(),
  /** Plain language, addressed to the taxpayer, not to us. */
  label: z.string(),
  weight: z.number(),
  /** What this signal saw on this particular row. Null when the label says it all. */
  detail: z.string().nullable(),
});

export type DetectionSignal = z.infer<typeof DetectionSignalSchema>;

export const RowConfidenceSchema = z.object({
  tier: ConfidenceTierSchema,
  /** 0–1. Printed nowhere by default; the tier is what a person reads. */
  score: z.number().min(0).max(1),
  signals: z.array(DetectionSignalSchema),
  /**
   * Why this row, in one sentence a controller can forward. Assembled from the
   * signals rather than written per finding, so it cannot drift from them.
   */
  why: z.string(),
  /**
   * Where the number came from.
   *
   * Optional because every report committed before the engine had labels
   * carries no such field and must keep parsing, and absent means `rules`.
   * Worth recording rather than inferring: two rows with identical signals can
   * be scored differently in the same season, one by the hand-authored weights
   * and one by coefficients fitted after enough reviewers had answered, and a
   * disposition argued against the first should not be read as evidence about
   * the second.
   */
  basis: z.enum(['rules', 'fitted']).optional(),
});

export type RowConfidence = z.infer<typeof RowConfidenceSchema>;

/* ── The chain from cost to tax, and what a position on it is worth ──────────
 *
 * Two numbers used to stand in for a lot of arithmetic. `blendedTaxRate` meant
 * *assessment ratio × millage*, which is the millage in Texas because the ratio
 * is 1, and is out by a factor of six in Louisiana. `taxAtRisk` meant one year
 * of tax on a position assumed to be right, accepted, and applied to every year
 * anyone cares about.
 *
 * Both are unfolded here. The chain prints each step a district takes so a
 * controller can check the one they doubt, and expected recovery prints the
 * best case next to the three probabilities it is discounted by.
 */

export const RateBasisSchema = z.object({
  /** Share of market value that is assessed. Texas and Florida: 1. */
  assessmentRatio: z.number(),
  /** Tax per dollar of *assessed* value, blended across the overlapping units. */
  millage: z.number(),
});

export type RateBasis = z.infer<typeof RateBasisSchema>;

/**
 * One walk from cost to tax, in the order the district does it.
 *
 * Every step is nullable and nulls propagate rather than becoming zero: a row
 * with no acquisition year has no index factor, and printing 1.0 there would
 * assert a fact about a year nobody knows.
 */
export const TaxChainSchema = z.object({
  /**
   * What the district is asked to value: original cost, less anything inside it
   * identified as non-assessable. Equal to original cost on every row where no
   * invoice has been decomposed.
   */
  assessableCost: z.number().nullable(),
  indexFactor: z.number().nullable(),
  replacementCostNew: z.number().nullable(),
  /** 0–100, off the district's own table. */
  percentGood: z.number().nullable(),
  marketValue: z.number().nullable(),
  assessmentRatio: z.number(),
  assessedValue: z.number().nullable(),
  millage: z.number(),
  tax: z.number().nullable(),
});

export type TaxChain = z.infer<typeof TaxChainSchema>;

/** One prior year a position could still be taken to, and how likely that is. */
export const RecoveryYearSchema = z.object({
  taxYear: z.number().int(),
  tax: z.number(),
  probabilityOpen: z.number(),
  expected: z.number(),
});

export type RecoveryYear = z.infer<typeof RecoveryYearSchema>;

/**
 * What a position is worth once the odds are applied.
 *
 * Three probabilities, kept apart rather than multiplied into one number,
 * because they fail differently and a reader who distrusts one should not have
 * to distrust all three. Being right is the row's own confidence; being
 * accepted is a rate per finding kind; a prior year being reachable is a
 * property of the statute and of how long ago it was.
 */
export const ExpectedRecoverySchema = z.object({
  /** The sum. What the queue ranks on. */
  expected: z.number(),
  prospective: z.object({ tax: z.number(), expected: z.number() }),
  retroactive: z.object({
    /**
     * Which statutory route the prior years lean on. The Texas pair are the two
     * free 25.25 remedies; `fl-refund` is s. 197.182, F.S. A state nobody has
     * researched has no route and gets null, which prints as "current year
     * only" rather than as a citation somebody would have to defend.
     */
    route: z.enum(['c', 'c-1', 'fl-refund']).nullable(),
    years: z.array(RecoveryYearSchema),
    expected: z.number(),
  }),
  probabilityCorrect: z.number(),
  probabilityAccepted: z.number(),
  /** The best case, before any of the three are applied. */
  undiscounted: z.number(),
});

export type ExpectedRecovery = z.infer<typeof ExpectedRecoverySchema>;

/**
 * One asset under one finding: the reviewable unit.
 *
 * Extends the evidence row rather than replacing it, so everything already
 * reading `evidence` keeps working and gains fields rather than losing them.
 */
export const FindingRowSchema = FindingEvidenceSchema.extend({
  findingKey: z.string(),
  /**
   * Stable across re-analysis, because a decision has to outlive the run that
   * produced the row. Derived from the finding and the durable asset id — the
   * two things that do not change when a register is re-uploaded.
   */
  rowKey: z.string(),
  categoryLabel: z.string().nullable(),

  /**
   * What this asset is carrying on the return as it stands today. For a
   * measured finding that is the schedule value it would be rendered at; for a
   * screening finding it is what the register implies, which is exactly the
   * figure the question is about.
   */
  assessedAsFiled: z.number().nullable(),
  /** What it should carry once the finding is applied. Zero where it comes off. */
  correctedValue: z.number().nullable(),
  /** The difference. Null, never zero, where the amount is not yet settled. */
  valueRemoved: z.number().nullable(),
  /** `valueRemoved` at the blended rate: one year of tax riding on this row. */
  taxAtRisk: z.number().nullable(),
  /**
   * What the position is worth after the odds of winning it: this year plus
   * every prior year still reachable, each discounted by how sure we are, how
   * often a district concedes this kind of position, and how likely that year
   * can still be corrected. Null where the row has no priced value at all.
   *
   * This is the number the Top 25 queue ranks on, and it is deliberately
   * smaller than `taxAtRisk` on a weak row and larger on a strong old one —
   * which is the whole reason a queue beats a category list.
   */
  expectedRecovery: z.number().nullable(),
  /** The workings behind it. See {@link ExpectedRecoverySchema}. */
  recovery: ExpectedRecoverySchema.nullable(),
  /**
   * The waterfall, twice: what the district gets today, and what it gets if
   * this position is taken. Printed side by side so the disagreement is visible
   * at the step it happens on rather than only in the total.
   */
  chain: z.object({ asFiled: TaxChainSchema, asCorrected: TaxChainSchema }).nullable(),

  confidence: RowConfidenceSchema,

  /** Placement, for the reader who thinks in buildings. */
  locationId: z.string().nullable(),
  siteLabel: z.string().nullable(),
  jurisdictionName: z.string().nullable(),
  /**
   * The register's own department or cost centre column. Their word for it,
   * carried through untouched — a controller filters by the string their ERP
   * prints, not by anything we would rename it to.
   */
  costCenter: z.string().nullable(),
  /**
   * Whether the register carried anything documentary for this row — a serial
   * number, a disposal date, a vendor. Not proof, and never described as such:
   * it is the difference between a row someone can go and check and a row that
   * is only a description and a number.
   */
  evidencePresent: z.boolean(),
});

export type FindingRow = z.infer<typeof FindingRowSchema>;

/**
 * Which signals fired across a finding, with counts.
 *
 * Printed at the top of a category page so the first thing a reviewer reads is
 * how the group was detected rather than what it totals. A group-by over the
 * rows' own signals — there is no second list to maintain.
 */
export const DetectionBasisSchema = z.object({
  code: z.string(),
  label: z.string(),
  assetCount: z.number().int().nonnegative(),
  originalCost: z.number(),
});

export type DetectionBasis = z.infer<typeof DetectionBasisSchema>;

export const SavingsFindingSchema = z.object({
  key: z.string(),
  title: z.string(),
  kind: FindingKindSchema,
  /**
   * Market value this takes off the rendition. Null for screening findings —
   * the amount is unknown until someone answers the question, and inventing a
   * number for it would be the one dishonest thing in this report.
   */
  valueRemoved: z.number().nullable(),
  /**
   * The sum of the rows' expected recovery, and the one number that is quotable
   * on every finding including the screening ones.
   *
   * That is not a contradiction of `valueRemoved` being null above. Null there
   * means the *best case* is unknown until somebody answers a question — we
   * cannot say how much inventory qualifies for freeport. This is a different
   * quantity: what the position is worth once discounted by how likely it is to
   * be right and to be accepted, which for an unanswered question is small and
   * honest rather than unknown. A report that could only rank what it had
   * already priced would rank the easy findings and bury the large ones.
   */
  expectedRecovery: z.number().nullable(),
  /** Original cost of the assets involved: the scale, even where value is null. */
  originalCost: z.number(),
  assetCount: z.number().int().nonnegative(),
  summary: z.string(),
  /** The statutory or procedural hook. What makes this a real position. */
  basis: z.string(),
  /** For modeled findings, the assumption. For screening, what settles it. */
  assumption: z.string().nullable(),
  /**
   * The one question that settles a screening finding, addressed to the
   * taxpayer and phrased to be forwarded verbatim. Null on measured and
   * modeled findings: those are settled by the record, not by asking.
   *
   * It lives on the finding rather than in the UI because the engine is what
   * knows why the finding is unpriced — `assumption` says what would settle it
   * in the firm's own words, and this is the same thing said to the person who
   * holds the fact.
   */
  question: z.string().nullable(),
  /**
   * The printed sample: the largest rows, for a report that is read rather
   * than worked. Sliced from `rows` at emit time and never assembled
   * separately, so the two cannot disagree.
   */
  evidence: z.array(FindingEvidenceSchema),
  /**
   * Every asset under this finding, one row each. The population a reviewer
   * filters, decides and exports — uncapped, because a cap here would be a
   * silent limit on what a client is allowed to review.
   */
  rows: z.array(FindingRowSchema),
  /** How the group was detected, with counts. See {@link DetectionBasisSchema}. */
  detection: z.array(DetectionBasisSchema),
  /** How many rows sit in each tier. The shape of the finding at a glance. */
  confidenceMix: z.object({
    high: z.number().int().nonnegative(),
    medium: z.number().int().nonnegative(),
    low: z.number().int().nonnegative(),
  }),
});

export type SavingsFinding = z.infer<typeof SavingsFindingSchema>;

/** What the public roll says today, when the engagement is linked to an account. */
export const AssessedPositionSchema = z.object({
  accountId: z.string(),
  taxYear: z.number().int(),
  appraisedValue: z.number().nullable(),
  assessedValue: z.number().nullable(),
  renditionFiled: z.boolean().nullable(),
  ownerName: z.string().nullable(),
});

export type AssessedPosition = z.infer<typeof AssessedPositionSchema>;

/**
 * How much of the register this report actually speaks for. Printed on the
 * report itself: a total that quietly omits a third of the assets looks
 * complete, which makes it worse than one that admits the hole.
 */
export const SavingsCoverageSchema = z.object({
  assetCount: z.number().int().nonnegative(),
  /** Priced into the corrected position. */
  valuedCount: z.number().int().nonnegative(),
  /**
   * Settled, but deliberately outside the corrected position because they are
   * the findings — disposed and non-taxable rows. Counted separately so the
   * coverage line cannot read as though they went missing.
   */
  inFindingsCount: z.number().int().nonnegative(),
  needsReviewCount: z.number().int().nonnegative(),
  unclassifiedCount: z.number().int().nonnegative(),
  /** Assets that carry a classification but no cost or year to value from. */
  unvaluableCount: z.number().int().nonnegative(),
});

export type SavingsCoverage = z.infer<typeof SavingsCoverageSchema>;

/**
 * The three numbers of the leakage headline, at one grain.
 *
 * Kept as three numbers on purpose: a single dollarized total collapses under
 * the first sophisticated question, because it blends what was computed with
 * what was assumed and what is still only a question. Measured and modeled are
 * dollars of value; leads are a count, and deliberately never a dollar —
 * `leadCost` is the original cost *behind* the questions, printed as scale,
 * not as a saving.
 */
export const LeakageRowSchema = z.object({
  measuredValue: z.number(),
  modeledValue: z.number(),
  /** Screening findings with at least one asset at this grain. */
  leadCount: z.number().int().nonnegative(),
  /** Original cost behind the leads. The size of the question, not an answer. */
  leadCost: z.number(),
});

export const LeakageJurisdictionSchema = LeakageRowSchema.extend({
  /** Null for assets not yet placed at a site. */
  jurisdictionId: z.string().nullable(),
  jurisdictionName: z.string().nullable(),
  /** The client sites this row aggregates, for the reader who thinks in sites. */
  siteLabels: z.array(z.string()),
});

export const SavingsLeakageSchema = LeakageRowSchema.extend({
  /**
   * The same three numbers per jurisdiction, from each asset's placement.
   * Length 1 (or an all-null row) when nothing distinguishes jurisdictions —
   * the view should only render the split when there is a split to show.
   */
  byJurisdiction: z.array(LeakageJurisdictionSchema),
});

export type LeakageJurisdiction = z.infer<typeof LeakageJurisdictionSchema>;
export type SavingsLeakage = z.infer<typeof SavingsLeakageSchema>;

export const SavingsReportSchema = z.object({
  engagementId: z.string(),
  clientName: z.string(),
  taxYear: z.number().int(),
  jurisdictionId: z.string().nullable(),
  jurisdictionName: z.string().nullable(),
  generatedAt: z.string().datetime(),
  schedule: z
    .object({
      taxYear: z.number().int(),
      title: z.string(),
      url: z.string(),
      pages: z.string(),
      isFallbackYear: z.boolean(),
    })
    .nullable(),

  /** What the roll says today. Null when no account is linked yet. */
  assessed: AssessedPositionSchema.nullable(),

  /**
   * The line of business the machinery life was read from. Null means no SIC
   * was set and machinery fell back to the category's ten-year placeholder —
   * which is a real difference in the numbers, so the report says which applied
   * rather than letting a placeholder pass for a published life.
   */
  sic: MachinerySicSchema.nullable(),

  /** Value of settled, in-service, taxable assets on the district's schedules. */
  farImpliedValue: z.number(),
  /** Original cost behind that figure. */
  farOriginalCost: z.number(),

  findings: z.array(SavingsFindingSchema),
  /** Sum of `valueRemoved` across measured and modeled findings only. */
  totalValueRemoved: z.number(),

  /** The headline that survives diligence: measured, modeled, and leads apart. */
  leakage: SavingsLeakageSchema,

  exemption: z.object({
    label: z.string(),
    basis: z.string(),
    /** The exemption one location gets in one taxing unit. */
    amount: z.number(),
    /**
     * What the exemption is worth here, expressed as taxable value: the
     * difference between the corrected value and what the report ends up taxing.
     * Capped by the value there is to exempt, and larger than `amount` wherever
     * the exemption was granted more than once — by several units against their
     * own slices of a split account, or at several locations inside one unit.
     */
    applied: z.number(),
    /**
     * How the exemption was granted, where it was granted per unit rather than
     * subtracted once. Null means the report had no unit list to grant against
     * and fell back to a single subtraction, which understates it.
     */
    perUnit: z
      .object({
        /** Units that levy on the account, each granting the exemption once. */
        units: z.number(),
        /** The most separate locations claimed inside any one unit, per 11.145(c). */
        locations: z.number(),
      })
      .nullable(),
    caveat: z.string(),
  }),

  /** `farImpliedValue` less the exemption: what a corrected rendition supports. */
  proposedTaxableValue: z.number(),
  blendedTaxRate: z.number(),
  /**
   * The same rate as its two factors. `blendedTaxRate` stays because everything
   * already reads it and in Texas it is exactly `millage`; this is what makes
   * the chain printable, and what a second state will need.
   */
  rateBasis: RateBasisSchema,
  /**
   * Where that rate came from, said out loud on the report.
   *
   * Until the taxing-unit combination is loaded for an account, the rate is a
   * single county-wide constant — 2.5% for every Texas county — and every
   * headline on this report is that constant times a value. Measured against
   * the 2025 Harris roll the real value-weighted rate has a median of 2.13%
   * and sits below 2.5% for 90.6% of business accounts, so the constant
   * overstates the client's overpayment on nine accounts in ten. An
   * approximation in that direction is the one thing this product cannot print
   * silently, which is why the field is required rather than optional.
   */
  rateSource: z.object({
    /**
     * `prior-year` is its own kind rather than a species of `adopted` because
     * the rates move. Harris County's own levy went from 0.385290 to 0.380960
     * between 2025 and 2026, and every unit in the county sets its rate
     * separately each autumn — months after the spring in which the rendition
     * for that year is prepared. A report drafted for the coming season
     * therefore prices at the last table that exists, which is a good
     * approximation and is not what the governing bodies adopted.
     */
    kind: z.enum(['adopted', 'prior-year', 'estimated']),
    /** A few words for a badge: "adopted rates", "county-wide estimate". */
    label: z.string(),
    /** What a reader should do about it. */
    detail: z.string(),
  }),
  /**
   * The constants behind every expected-recovery figure on the report, printed
   * rather than buried. None of them are measured yet, and a reader who thinks
   * a district concedes disposals less often than we assume should be able to
   * see the assumption and say so.
   */
  recoveryModel: z.object({
    acceptanceIsPlaceholder: z.boolean(),
    acceptance: z.record(z.string(), z.number()),
    yearDecay: z.record(z.string(), z.number()),
    routes: z.record(z.string(), z.enum(['c', 'c-1', 'fl-refund']).nullable()),
    note: z.string(),
    /**
     * Where a learned rate came from, for the findings that have one.
     *
     * Optional because reports committed before the firm had any outcomes
     * carry no such thing, and a stored document must keep parsing. Absent and
     * empty mean the same to a reader: every acceptance rate on this report is
     * the built-in constant.
     *
     * `interval` is an approximate 95% band. It is on the report rather than
     * only on the firm's screen because a rate learned from six positions and
     * a rate learned from sixty are different claims, and the report is where
     * somebody argues with the number.
     */
    acceptanceEvidence: z
      .array(
        z.object({
          findingKey: z.string(),
          rate: z.number(),
          prior: z.number(),
          observations: z.number(),
          localObservations: z.number(),
          measured: z.boolean(),
          interval: z.tuple([z.number(), z.number()]),
          basis: z.string(),
        }),
      )
      .optional(),
  }),
  /** Sum of every row's expected recovery, across all findings. */
  totalExpectedRecovery: z.number(),
  /** Tax on the proposed position. */
  proposedTax: z.number(),
  /**
   * Assessed value less the proposed taxable value — the reduction being
   * argued for. Null until an account is linked, because without the roll
   * there is no "before" and a saving cannot be claimed against nothing.
   */
  valueReduction: z.number().nullable(),
  estimatedAnnualSaving: z.number().nullable(),

  coverage: SavingsCoverageSchema,
});

export type SavingsReport = z.infer<typeof SavingsReportSchema>;

/* ── The queue ───────────────────────────────────────────────────────────────
 *
 * A report organised by category is a report organised the way it was
 * *computed*. Nobody works it that way. A tax director with two hours before a
 * deadline wants the twenty-five decisions worth the most money, in order,
 * whatever bucket they came out of — and the category list is then what they
 * use to check coverage afterwards, not what they use to work.
 *
 * One rule shapes it beyond the ranking. A single detector having a good day
 * can fill a whole queue with near-identical rows, and twenty-five disposals in
 * a row is both boring and a bad use of a reviewer's judgement — the marginal
 * value of the twentieth is far below the first of something else. So no
 * finding type takes more than a share of the page, and what got held back is
 * said out loud rather than silently dropped.
 */

export const QueueItemSchema = z.object({
  /** 1-based, across the whole queue rather than the page. */
  rank: z.number().int().positive(),
  row: FindingRowSchema,
  findingTitle: z.string(),
  findingKind: FindingKindSchema,
  /** The question, for a row that belongs to a screening finding. */
  findingQuestion: z.string().nullable(),
  basis: z.string(),
});

export type QueueItem = z.infer<typeof QueueItemSchema>;

export const FindingQueueSchema = z.object({
  engagementId: z.string(),
  runId: z.string().nullable(),
  publishedAt: z.string().nullable(),
  items: z.array(QueueItemSchema),
  offset: z.number().int().nonnegative(),
  size: z.number().int().positive(),
  /** Undecided, priced rows across every finding — what the queue draws from. */
  eligible: z.number().int().nonnegative(),
  /** Expected recovery still waiting in the queue behind this page. */
  remainingRecovery: z.number(),
  /** Whether asking for the next page would return anything. */
  hasMore: z.boolean(),
  /**
   * Rows a detector was capped out of this page, by finding. Printed, because a
   * diversity rule that quietly hid the second-highest row on the report would
   * be the report lying about its own ordering.
   */
  heldBack: z.array(
    z.object({ findingKey: z.string(), findingTitle: z.string(), count: z.number().int() }),
  ),
  /** How much of the report has been worked, so the queue can say when it is done. */
  decided: z.number().int().nonnegative(),
  rateBasis: RateBasisSchema,
  jurisdictionName: z.string().nullable(),
});

export type FindingQueue = z.infer<typeof FindingQueueSchema>;
