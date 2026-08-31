import { z } from 'zod';

/* ── Getting paid ────────────────────────────────────────────────────────────
 *
 * The engagement produces a number — value taken off the roll, dollarized at
 * the jurisdiction's blended rate — and until now that number went to the
 * client in a letter and to nobody in a bill.
 *
 * Two rules shape everything here.
 *
 * **A bill is not an estimate.** `EngagementResult` says of its own tax figure
 * that it is "an estimate by construction … always presented as one, never as
 * the bill", and that sentence is load-bearing. So a contingency statement
 * either bills a share of the estimate *and says on its face that it is one*,
 * naming the blended rate it used, or it bills the actual saving the firm read
 * off the client's tax bills and states that instead. What it never does is
 * print an estimate as though somebody had checked.
 *
 * **A statement refuses rather than guesses**, the same way the Comptroller
 * forms do. Unagreed terms, a season still moving, a site whose reduction
 * cannot be computed — each is a blocker with a sentence, and a blocked quote
 * shows the arithmetic it would have done rather than an amount.
 */

export const FEE_BASES = ['fixed', 'per-return', 'contingency'] as const;
export const FeeBasisSchema = z.enum(FEE_BASES);
export type FeeBasis = (typeof FEE_BASES)[number];

/**
 * The agreement, as the engagement letter set it.
 *
 * Every amount is whole cents. Value estimates elsewhere in this codebase are
 * floating point and honestly so; a fee is a thing somebody owes.
 */
export const FeeTermsSchema = z.object({
  basis: FeeBasisSchema,
  fixedCents: z.number().int().nonnegative().nullable(),
  perReturnCents: z.number().int().nonnegative().nullable(),
  /** A share, as a fraction. 0.25 is a quarter of what the season saved. */
  contingencyRate: z.number().min(0).max(1).nullable(),
  /** A floor under a contingency fee, where the letter set one. */
  minimumCents: z.number().int().nonnegative().nullable(),
  agreedOn: z.string().nullable(),
  notes: z.string().nullable(),
});

export type FeeTerms = z.infer<typeof FeeTermsSchema>;

/** What the client reads: one line, what it is for, what it comes to. */
export const FeeLineSchema = z.object({
  label: z.string(),
  detail: z.string().nullable(),
  amountCents: z.number().int(),
});

export type FeeLine = z.infer<typeof FeeLineSchema>;

/**
 * One site's contribution to a contingency fee, frozen.
 *
 * Kept per site rather than as a total because the question a year later is
 * never "what was the fee", it is "why was the fee that" — and the answer is
 * always one site whose value moved.
 */
export const FeeSiteMeasureSchema = z.object({
  locationId: z.string(),
  label: z.string(),
  accountId: z.string().nullable(),
  noticedValue: z.number().nullable(),
  standingValue: z.number().nullable(),
  reduction: z.number().nullable(),
  blendedTaxRate: z.number().nullable(),
  estimatedTaxReduction: z.number().nullable(),
  settledVia: z.string().nullable(),
  filedOn: z.string().nullable(),
});

export type FeeSiteMeasure = z.infer<typeof FeeSiteMeasureSchema>;

/**
 * What the fee was applied to.
 *
 * `savingSource` is the whole honesty of the contingency case. `estimated`
 * means the number came off the blended-rate arithmetic and the statement says
 * so; `stated` means a person read the actual tax bills and typed what the
 * client really saved, which is the only version that is not an estimate.
 */
export const FeeMeasureSchema = z.object({
  basis: FeeBasisSchema,
  taxYear: z.number().int(),
  sites: z.array(FeeSiteMeasureSchema),
  /** Returns counted for a per-return fee: sites with a filing on record. */
  returnsFiled: z.number().int().nonnegative(),
  /** Total appraised value taken off, over sites where both sides are known. */
  reductionTotal: z.number().nullable(),
  /** The saving the fee was a share of, in cents. */
  savingCents: z.number().int().nullable(),
  savingSource: z.enum(['estimated', 'stated', 'none']),
  /** Sites left out of the measure, and why. Never silent. */
  excluded: z.array(z.object({ label: z.string(), because: z.string() })),
});

export type FeeMeasure = z.infer<typeof FeeMeasureSchema>;

/**
 * The bill this season would produce today, and what stops it.
 *
 * A quote is computed on read and never stored. The statement is the stored
 * thing, and it stores its own copy of all of this — see `fee_statements`.
 */
export const FeeQuoteSchema = z.object({
  terms: FeeTermsSchema.nullable(),
  lines: z.array(FeeLineSchema),
  totalCents: z.number().int(),
  measure: FeeMeasureSchema,
  /** Each one a sentence saying what is missing. Non-empty means it cannot issue. */
  blockers: z.array(z.string()),
  /** True where the total rests on the blended-rate estimate rather than a bill. */
  estimated: z.boolean(),
});

export type FeeQuote = z.infer<typeof FeeQuoteSchema>;

export const FEE_STATEMENT_STATUSES = ['issued', 'paid', 'void'] as const;
export const FeeStatementStatusSchema = z.enum(FEE_STATEMENT_STATUSES);
export type FeeStatementStatus = (typeof FEE_STATEMENT_STATUSES)[number];

export const FeeStatementSchema = z.object({
  id: z.string(),
  number: z.string(),
  issuedAt: z.string(),
  issuedBy: z.string().nullable(),
  basis: FeeBasisSchema,
  lines: z.array(FeeLineSchema),
  totalCents: z.number().int(),
  terms: FeeTermsSchema,
  measure: FeeMeasureSchema,
  status: FeeStatementStatusSchema,
  paidOn: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
});

export type FeeStatement = z.infer<typeof FeeStatementSchema>;

/** The billing panel: the agreement, what it would come to, what has gone out. */
export const FeeViewSchema = z.object({
  quote: FeeQuoteSchema,
  statements: z.array(FeeStatementSchema),
  /** Issued and unpaid, summed. The only number the firm chases. */
  outstandingCents: z.number().int().nonnegative(),
});

export type FeeView = z.infer<typeof FeeViewSchema>;

/* ── Requests ─────────────────────────────────────────────────────────────── */

export const SaveFeeTermsSchema = z.object({
  basis: FeeBasisSchema,
  fixedCents: z.number().int().nonnegative().nullable().optional(),
  perReturnCents: z.number().int().nonnegative().nullable().optional(),
  contingencyRate: z.number().min(0).max(1).nullable().optional(),
  minimumCents: z.number().int().nonnegative().nullable().optional(),
  agreedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export type SaveFeeTermsInput = z.infer<typeof SaveFeeTermsSchema>;

export const IssueFeeStatementSchema = z.object({
  /**
   * The saving the firm actually measured, in cents, where it has the tax bills.
   * Supplying it replaces the blended-rate estimate and marks the statement as
   * resting on a stated figure rather than a computed one.
   */
  statedSavingCents: z.number().int().nonnegative().nullable().optional(),
});

export type IssueFeeStatementInput = z.infer<typeof IssueFeeStatementSchema>;

export const SettleFeeStatementSchema = z.object({
  action: z.enum(['paid', 'void']),
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export type SettleFeeStatementInput = z.infer<typeof SettleFeeStatementSchema>;
