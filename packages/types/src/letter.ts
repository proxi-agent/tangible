import { z } from 'zod';
import { OutcomePhaseSchema, SettledViaSchema } from './filing.js';

/**
 * The result letter: the season's scoreboard, told to the client.
 *
 * The scoreboard already computes every number and even writes each row's
 * standing in prose — but a scoreboard is read by the person who kept it. The
 * client gets a letter, and the letter has to say what was filed, what the
 * district answered, what the work took off the roll, and what is still moving
 * — without inventing a figure or promising an outcome the record does not
 * hold.
 *
 * Same discipline as the protest brief and the unblock plan, which this
 * deliberately copies: facts assembled by code from the scoreboard's own
 * computation and frozen, prose drafted by the model from them and nothing
 * else, and the person sends it — the agent contacts nobody.
 */

/** One site's year as the drafter is allowed to see it. */
export const LetterSiteSchema = z.object({
  label: z.string(),
  accountId: z.string().nullable(),
  phase: OutcomePhaseSchema,
  renderedCost: z.number().nullable(),
  filedOn: z.string().nullable(),
  noticedValue: z.number().nullable(),
  standingValue: z.number().nullable(),
  settledVia: SettledViaSchema.nullable(),
  /** Noticed minus standing — appraised value, never tax dollars. */
  reduction: z.number().nullable(),
  /** The reduction in taxable value, after the exemption, at the blended rate — an estimate, never the bill. */
  estimatedTaxReduction: z.number().nullable(),
  nextDeadline: z.string().nullable(),
  /** The row in prose, computed by code. The drafter's authority per site. */
  standing: z.string(),
});

export type LetterSite = z.infer<typeof LetterSiteSchema>;

/** Everything the drafted letter may rest on, frozen on the row at draft time. */
export const LetterFactsSchema = z.object({
  clientName: z.string(),
  taxYear: z.number().int(),
  sites: z.array(LetterSiteSchema),

  settledCount: z.number().int().nonnegative(),
  siteCount: z.number().int().nonnegative(),
  renderedTotal: z.number().nullable(),
  noticedTotal: z.number().nullable(),
  standingTotal: z.number().nullable(),
  /** Summed only where both sides are known; the count says how many that was. */
  reductionTotal: z.number().nullable(),
  reductionCount: z.number().int().nonnegative(),
  /** The reductions dollarized, over rows that also have a rate on file. */
  estimatedTaxTotal: z.number().nullable(),
  estimatedTaxCount: z.number().int().nonnegative(),

  /** The season in a sentence or two, computed by code. */
  standing: z.string(),
});

export type LetterFacts = z.infer<typeof LetterFactsSchema>;

/**
 * What the model drafts. `body` is the whole letter, client-facing; `cautions`
 * face the firm — what to confirm before the letter goes anywhere.
 */
export const ResultLetterSchema = z.object({
  subject: z.string(),
  body: z.string(),
  cautions: z.array(z.string()),
});

export type ResultLetter = z.infer<typeof ResultLetterSchema>;

/** A drafted letter as stored: frozen facts, the draft, and its provenance. */
export const ResultLetterRecordSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  facts: LetterFactsSchema,
  letter: ResultLetterSchema,
  model: z.string().nullable(),
  createdAt: z.string(),
});

export type ResultLetterRecord = z.infer<typeof ResultLetterRecordSchema>;
