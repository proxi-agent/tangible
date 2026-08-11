import { z } from 'zod';

/**
 * Canonical account-year record. Every connector normalizes its source files
 * into this shape, so all downstream analytics are jurisdiction-agnostic.
 *
 * One row = one BPP account in one tax year.
 */
export const AccountYearSchema = z.object({
  jurisdictionId: z.string(),
  taxYear: z.number().int(),
  /** The CAD's account number, as printed on the roll. */
  accountId: z.string(),

  ownerName: z.string().nullable(),
  /** Normalized owner name (suffixes stripped, lowercased) for entity rollups. */
  ownerKey: z.string().nullable(),

  siteAddress: z.string().nullable(),
  siteCity: z.string().nullable(),
  siteZip: z.string().nullable(),
  mailAddress: z.string().nullable(),
  mailCity: z.string().nullable(),
  mailState: z.string().nullable(),
  mailZip: z.string().nullable(),

  /** Texas state class code, e.g. 'L1', 'S1', 'J6'. */
  stateClass: z.string().nullable(),
  /** SIC/NAICS as published by the CAD, when present. */
  businessCode: z.string().nullable(),

  marketValue: z.number().nullable(),
  appraisedValue: z.number().nullable(),
  /** Value after exemptions — the number tax is actually charged on. */
  assessedValue: z.number().nullable(),

  /** True when a rendition was recorded for this account in this year. */
  renditionFiled: z.boolean().nullable(),
  /** True when the rendition arrived after the statutory deadline. */
  renditionLate: z.boolean().nullable(),
  /** Penalty amount the CAD recorded, when published. */
  renditionPenalty: z.number().nullable(),

  /** A tax agent is on record — a strong signal the account is already served. */
  hasAgent: z.boolean().nullable(),
  agentName: z.string().nullable(),

  /** Fully exempt (hospital, charity, government) — owes nothing regardless. */
  isExempt: z.boolean().nullable(),

  sourceFile: z.string().nullable(),
});

export type AccountYear = z.infer<typeof AccountYearSchema>;

/** One year's slice inside an account's history. */
export const AccountYearPointSchema = z.object({
  taxYear: z.number().int(),
  assessedValue: z.number().nullable(),
  appraisedValue: z.number().nullable(),
  renditionFiled: z.boolean().nullable(),
  renditionLate: z.boolean().nullable(),
  estimatedTax: z.number().nullable(),
  estimatedPenalty: z.number().nullable(),
});

export type AccountYearPoint = z.infer<typeof AccountYearPointSchema>;

/**
 * An account collapsed across every year we hold, with the derived flags the
 * product actually sells on. Produced by the `account_series` view.
 */
export const AccountSeriesSchema = z.object({
  jurisdictionId: z.string(),
  accountId: z.string(),
  ownerName: z.string().nullable(),
  ownerKey: z.string().nullable(),
  siteCity: z.string().nullable(),
  stateClass: z.string().nullable(),
  stateClassGroup: z.string().nullable(),
  hasAgent: z.boolean(),
  isExempt: z.boolean(),

  latestYear: z.number().int(),
  latestAssessedValue: z.number().nullable(),
  yearsOnRoll: z.number().int(),
  yearsUnfiled: z.number().int(),
  yearsFiledLate: z.number().int(),

  /** Assessed value is identical in every year observed — equipment never depreciates. */
  isFrozen: z.boolean(),
  /** Value never decreases year over year, though it does change. */
  neverDeclines: z.boolean(),

  estimatedAnnualTax: z.number().nullable(),
  /** 10% of tax due, for each year no rendition was filed. */
  estimatedAnnualPenalty: z.number().nullable(),
  /** Penalty summed across every unfiled year on the roll. */
  estimatedLifetimePenalty: z.number().nullable(),

  segments: z.array(z.string()),
  history: z.array(AccountYearPointSchema),
});

export type AccountSeries = z.infer<typeof AccountSeriesSchema>;

/** Multi-account entities, the unit an outbound campaign actually targets. */
export const OwnerRollupSchema = z.object({
  jurisdictionId: z.string(),
  ownerKey: z.string(),
  ownerName: z.string(),
  accountCount: z.number().int(),
  unfiledAccountCount: z.number().int(),
  frozenAccountCount: z.number().int(),
  totalAssessedValue: z.number(),
  unfiledAssessedValue: z.number(),
  estimatedAnnualTax: z.number(),
  estimatedAnnualPenalty: z.number(),
  cities: z.array(z.string()),
  stateClasses: z.array(z.string()),
  hasAgent: z.boolean(),
});

export type OwnerRollup = z.infer<typeof OwnerRollupSchema>;
