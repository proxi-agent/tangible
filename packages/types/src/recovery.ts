import { z } from 'zod';

/**
 * What was claimed, and what came back.
 *
 * The rest of the product answers "what is this worth" — a schedule value, an
 * expected recovery, a queue rank. All of it is a prediction, and until this
 * table exists none of it has ever been scored. A claim is the prediction
 * written down at the moment it was taken to a district; an outcome is what the
 * district did about it. The pair is the only thing in the system that can say
 * whether the model was right.
 *
 * That is also why the grain is one asset, one finding, one year, when a
 * district works at the account level. The reconciliation between those two
 * grains is `allocation`, and it is carried on every row rather than inferred,
 * because the difference between "the appraiser told us which arguments landed"
 * and "we split the settlement in proportion" is the difference between a
 * training label and an arithmetic convenience.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** How the position reached the district. */
export const ClaimRouteSchema = z.enum([
  'rendition',
  'protest',
  '25.25-c',
  '25.25-c-1',
  '25.25-d',
  'fl-refund',
  'fl-vab',
]);
export type ClaimRoute = z.infer<typeof ClaimRouteSchema>;

export const ClaimOutcomeSchema = z.enum(['accepted', 'partial', 'rejected', 'withdrawn']);
export type ClaimOutcome = z.infer<typeof ClaimOutcomeSchema>;

/**
 * Where the outcome's numbers came from.
 *
 * `itemized` — the district's own letter or the ARB order says which positions
 * it allowed, position by position. The only allocation that is a fact.
 * `stated` — the appraiser said which arguments landed, without itemising the
 * money. Weaker than itemized on the amount, just as strong on acceptance.
 * `pro-rata` — nobody said, so a single settlement was split across the claims
 * in proportion to what each asked for. Reportable, never learnable.
 */
export const AllocationSchema = z.enum(['itemized', 'stated', 'pro-rata']);
export type Allocation = z.infer<typeof AllocationSchema>;

export const RecoveryClaimRecordSchema = z.object({
  id: z.string(),
  taxYear: z.number().int(),
  locationId: z.string().nullable(),
  locationLabel: z.string().nullable(),
  accountId: z.string().nullable(),
  assetId: z.string().nullable(),
  assetTag: z.string().nullable(),
  assetDescription: z.string().nullable(),
  findingKey: z.string(),
  findingTitle: z.string(),
  route: ClaimRouteSchema,
  authority: z.string().nullable(),
  valueClaimed: z.number().nullable(),
  taxClaimed: z.number().nullable(),
  /** What the engine believed when the position went out. Scored, never edited. */
  predictedConfidence: z.number().nullable(),
  predictedAcceptance: z.number().nullable(),
  claimedOn: isoDate,
  status: z.enum(['recorded', 'void']),
  outcome: z
    .object({
      outcome: ClaimOutcomeSchema,
      allocation: AllocationSchema,
      valueAllowed: z.number().nullable(),
      taxRecovered: z.number().nullable(),
      taxIsDocumented: z.boolean(),
      resolvedOn: isoDate,
      note: z.string().nullable(),
    })
    .nullable(),
  realizedShare: z.number().nullable(),
  learnable: z.boolean(),
  notLearnable: z.string().nullable(),
  standing: z.string(),
});
export type RecoveryClaimRecord = z.infer<typeof RecoveryClaimRecordSchema>;

/** The rollup a firm reads, and the one the client reads. Same numbers. */
export const RecoverySummarySchema = z.object({
  claims: z.number().int(),
  settled: z.number().int(),
  pending: z.number().int(),
  valueClaimed: z.number(),
  valueAllowed: z.number(),
  taxDocumented: z.number(),
  taxEstimated: z.number().nullable(),
  learnable: z.number().int(),
});
export type RecoverySummary = z.infer<typeof RecoverySummarySchema>;

export const RecoveryByYearSchema = z.object({
  taxYear: z.number().int(),
  summary: RecoverySummarySchema,
});
export type RecoveryByYear = z.infer<typeof RecoveryByYearSchema>;

export const EngagementRecoverySchema = z.object({
  engagementId: z.string(),
  summary: RecoverySummarySchema,
  byYear: z.array(RecoveryByYearSchema),
  claims: z.array(RecoveryClaimRecordSchema),
  /**
   * Said plainly wherever a total is printed, because a total assembled from
   * three kinds of evidence needs one line explaining which kinds are in it.
   */
  caveats: z.array(z.string()),
});
export type EngagementRecovery = z.infer<typeof EngagementRecoverySchema>;

/**
 * Record what a district did about a set of claims.
 *
 * One shape covers both cases, and which one it is depends entirely on whether
 * `perClaim` is given. Named claims are `itemized`; a bare `settledValueRemoved`
 * is split `pro-rata` across everything open on that account and year.
 */
export const RecordSettlementRequestSchema = z
  .object({
    locationId: z
      .string()
      .uuid()
      .nullish()
      .transform((value) => value ?? null),
    taxYear: z.number().int(),
    resolvedOn: isoDate,
    resolutionId: z
      .string()
      .uuid()
      .nullish()
      .transform((value) => value ?? null),
    /** The one number the district stated. Required for a pro-rata split. */
    settledValueRemoved: z
      .number()
      .nonnegative()
      .nullish()
      .transform((value) => value ?? null),
    /** Tax actually documented — a refund, a corrected bill. Never modelled. */
    taxRecovered: z
      .number()
      .nonnegative()
      .nullish()
      .transform((value) => value ?? null),
    perClaim: z
      .array(
        z.object({
          claimId: z.string().uuid(),
          outcome: ClaimOutcomeSchema,
          valueAllowed: z
            .number()
            .nonnegative()
            .nullish()
            .transform((value) => value ?? null),
          taxRecovered: z
            .number()
            .nonnegative()
            .nullish()
            .transform((value) => value ?? null),
        }),
      )
      .nullish()
      .transform((value) => value ?? null),
    note: optionalText(1000),
  })
  .refine((body) => body.perClaim !== null || body.settledValueRemoved !== null, {
    path: ['settledValueRemoved'],
    message:
      'Either say what the district allowed on each position, or give the single figure it agreed to take off.',
  });
export type RecordSettlementRequest = z.infer<typeof RecordSettlementRequestSchema>;

export const VoidClaimRequestSchema = z.object({
  reason: z.string().trim().min(1, 'Say why this claim is being taken back.').max(1000),
});
export type VoidClaimRequest = z.infer<typeof VoidClaimRequestSchema>;

/**
 * The same record, told to the business whose property it is.
 *
 * Three things are deliberately absent. The model's own confidence and
 * predicted acceptance are the firm's working papers, and a client reading
 * "we thought this had a 62% chance" learns nothing they can act on. Whether a
 * row is `learnable` is a fact about our training set, not about their money.
 * And the asset-level split of a pro-rata settlement is not shown as a
 * per-asset amount at all — grouped to the argument, where the number is one
 * the district's letter can actually be checked against.
 *
 * What is not absent is the caveats. A client is told when a figure is a share
 * of a settlement rather than the district's own itemisation, in the same
 * words the firm sees.
 */
export const ClientRecoveryLineSchema = z.object({
  taxYear: z.number().int(),
  findingKey: z.string(),
  findingTitle: z.string(),
  /** How many pieces of property this argument covered. */
  assets: z.number().int(),
  valueClaimed: z.number(),
  valueAllowed: z.number(),
  pending: z.number().int(),
  standing: z.string(),
});
export type ClientRecoveryLine = z.infer<typeof ClientRecoveryLineSchema>;

export const ClientRecoverySummarySchema = RecoverySummarySchema.omit({ learnable: true });
export type ClientRecoverySummary = z.infer<typeof ClientRecoverySummarySchema>;

export const ClientRecoveryStatementSchema = z.object({
  engagementId: z.string(),
  summary: ClientRecoverySummarySchema,
  byYear: z.array(z.object({ taxYear: z.number().int(), summary: ClientRecoverySummarySchema })),
  lines: z.array(ClientRecoveryLineSchema),
  caveats: z.array(z.string()),
});
export type ClientRecoveryStatement = z.infer<typeof ClientRecoveryStatementSchema>;

/* -------------------------------------------------------------------------- */
/*  The acceptance model                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One learned acceptance rate, with everything needed to distrust it.
 *
 * The rate alone is the least interesting field. What makes this shape useful
 * is that `prior` says where it started, `observations` says how much moved it,
 * and `interval` says how wide the honest answer still is — so a partner
 * reading 68% can see whether that is the firm's experience or the firm's
 * original guess wearing a percentage sign.
 */
export const AcceptanceEvidenceSchema = z.object({
  findingKey: z.string(),
  rate: z.number(),
  /** The built-in constant: what this would be with no outcomes at all. */
  prior: z.number(),
  /** Closed learnable positions of this kind, everywhere. */
  observations: z.number(),
  /** How many of those were in the district being asked about. */
  localObservations: z.number(),
  /** True once there is enough to hand the report. */
  measured: z.boolean(),
  /** Approximate 95% band. Wide is the correct output of thin data. */
  interval: z.tuple([z.number(), z.number()]),
  basis: z.string(),
});
export type AcceptanceEvidenceView = z.infer<typeof AcceptanceEvidenceSchema>;

export const AcceptanceDistrictSchema = z.object({
  jurisdictionId: z.string().nullable(),
  label: z.string(),
  observations: z.number(),
  evidence: z.array(AcceptanceEvidenceSchema),
});
export type AcceptanceDistrict = z.infer<typeof AcceptanceDistrictSchema>;

/**
 * The whole learned model, for the screen that exists to be argued with.
 *
 * `pooled` before `districts` because that is the order the estimate is built:
 * a district's rate is the pooled rate moved by what that district did, and a
 * screen showing only the local numbers would make eight outcomes look like the
 * entire basis for a rate that is mostly inherited from everywhere else.
 */
export const AcceptanceBoardSchema = z.object({
  observations: z.number(),
  /** How many finding kinds have cleared the bar and are in use. */
  measured: z.number(),
  pooled: z.array(AcceptanceEvidenceSchema),
  districts: z.array(AcceptanceDistrictSchema),
});
export type AcceptanceBoard = z.infer<typeof AcceptanceBoardSchema>;
