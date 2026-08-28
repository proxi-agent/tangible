import { z } from 'zod';

/**
 * The wire shapes for advice on a purchase that has not been made yet.
 *
 * Everything else in this product looks backwards: a register is a record of
 * decisions already taken, and a finding is an argument for undoing one. This
 * is the same engine pointed the other way, at a line somebody is about to
 * code, where the same argument costs nothing to win.
 *
 * The request is deliberately what a person actually has in front of them at
 * that moment — a description off a quote, a number, and a month — and not an
 * asset. Nothing is written down. Asking for advice creates no asset, no
 * finding, and no obligation, which is what makes it safe to ask about a
 * purchase that may never happen.
 */

export const CapitalizationAdviceRequestSchema = z.object({
  /** What the invoice or requisition says it is. */
  description: z.string().trim().min(1).max(500),
  /** Where it is headed in the ledger, where that is known. */
  glAccount: z.string().trim().max(120).nullable(),
  /** The book category, where the person asking already has one in mind. */
  registerCategory: z.string().trim().max(120).nullable(),
  /** Book life in years, which is a hint and never the tax life. */
  usefulLife: z.number().int().positive().max(99).nullable(),
  cost: z.number().positive(),
  /** The calendar year it will be placed in service. */
  acquisitionYear: z.number().int().min(1900).max(2200),
  /**
   * The month, 1–12, where it is known. Only the January 1 lever reads it, and
   * only to say whether the purchase is close enough to a year end for the
   * question to be worth raising.
   */
  acquisitionMonth: z.number().int().min(1).max(12).nullable(),
});

export type CapitalizationAdviceRequest = z.infer<typeof CapitalizationAdviceRequestSchema>;

export const AdviceLeverKindSchema = z.enum(['exclusion', 'split', 'life', 'timing']);

export type AdviceLeverKind = z.infer<typeof AdviceLeverKindSchema>;

/**
 * One thing that could be done differently, and what it is worth.
 *
 * `worth` is nullable and often null on purpose. A split lever cannot be priced
 * until somebody says how much of the invoice is software, and a lever that
 * invented a proportion in order to print a dollar sign would be the most
 * quotable number on the page and the least defensible. Where it is null the
 * detail carries the per-thousand rate instead, which is the honest form of the
 * same answer.
 */
export const AdviceLeverSchema = z.object({
  kind: AdviceLeverKindSchema,
  title: z.string(),
  detail: z.string(),
  /** Lifetime tax this lever removes, where that is computable. */
  worth: z.number().nullable(),
  /** The rule or statute it rests on, quoted from the rule itself. */
  basis: z.string().nullable(),
});

export type AdviceLever = z.infer<typeof AdviceLeverSchema>;

export const AdviceYearSchema = z.object({
  taxYear: z.number().int(),
  age: z.number().int(),
  marketValue: z.number(),
  tax: z.number(),
  atFloor: z.boolean(),
});

export const CapitalizationAdviceSchema = z.object({
  engagementId: z.string(),
  jurisdictionId: z.string().nullable(),
  jurisdictionName: z.string().nullable(),
  /** The tax year of the schedule the stream was read off. */
  scheduleTaxYear: z.number().int().nullable(),
  taxRate: z.number(),
  classification: z.object({
    categoryKey: z.string().nullable(),
    label: z.string(),
    /** Where the answer came from: a decision somebody already made, or the model. */
    source: z.enum(['memory', 'ai', 'none']),
    confidence: z.number().nullable(),
    rationale: z.string().nullable(),
    /** True where the answer is that this is not taxable property at all. */
    excluded: z.boolean(),
  }),
  stream: z
    .object({
      firstTaxYear: z.number().int(),
      years: z.array(AdviceYearSchema),
      lifetimeTax: z.number(),
      firstYearTax: z.number(),
      perThousand: z.number(),
      truncated: z.boolean(),
    })
    .nullable(),
  /** Set where the purchase could not be valued, in place of the stream. */
  gap: z.object({ reason: z.string(), detail: z.string() }).nullable(),
  levers: z.array(AdviceLeverSchema),
  /** Costs in the description that stay in the reported cost. */
  included: z.array(z.object({ phrase: z.string(), note: z.string() })),
  /** What this advice does not know, said before anybody acts on it. */
  caveats: z.array(z.string()),
});

export type CapitalizationAdvice = z.infer<typeof CapitalizationAdviceSchema>;
