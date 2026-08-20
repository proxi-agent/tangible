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
  description: z.string().nullable(),
  acquisitionYear: z.number().int().nullable(),
  originalCost: z.number().nullable(),
  /** What the district's schedules produce for it, where that is computable. */
  scheduleValue: z.number().nullable(),
  categoryKey: z.string().nullable(),
});

export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

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
  /** Original cost of the assets involved: the scale, even where value is null. */
  originalCost: z.number(),
  assetCount: z.number().int().nonnegative(),
  summary: z.string(),
  /** The statutory or procedural hook. What makes this a real position. */
  basis: z.string(),
  /** For modeled findings, the assumption. For screening, what settles it. */
  assumption: z.string().nullable(),
  evidence: z.array(FindingEvidenceSchema),
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

  exemption: z.object({
    label: z.string(),
    basis: z.string(),
    amount: z.number(),
    /** What actually applied — capped by the value there is to exempt. */
    applied: z.number(),
    caveat: z.string(),
  }),

  /** `farImpliedValue` less the exemption: what a corrected rendition supports. */
  proposedTaxableValue: z.number(),
  blendedTaxRate: z.number(),
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
