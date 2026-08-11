import { z } from 'zod';
import { SegmentKeySchema } from './segments.js';

/** Headline numbers for one segment in one jurisdiction/year. */
export const SegmentMetricSchema = z.object({
  segment: SegmentKeySchema,
  accountCount: z.number().int().nonnegative(),
  totalAssessedValue: z.number().nonnegative(),
  estimatedTax: z.number().nonnegative(),
  estimatedAnnualPenalty: z.number().nonnegative(),
  medianAssessedValue: z.number().nonnegative().nullable(),
  medianAnnualPenalty: z.number().nonnegative().nullable(),
  /** Share of the taxable market, 0–1. */
  shareOfTaxable: z.number().min(0).max(1).nullable(),
});

export type SegmentMetric = z.infer<typeof SegmentMetricSchema>;

export const MarketOverviewSchema = z.object({
  jurisdictionId: z.string(),
  taxYear: z.number().int(),
  blendedTaxRate: z.number(),
  exemptionThreshold: z.number(),
  totalAccounts: z.number().int(),
  taxableAccounts: z.number().int(),
  exemptAccounts: z.number().int(),
  /** Share of taxable accounts with a rendition on file, 0–1. */
  filingRate: z.number().min(0).max(1).nullable(),
  totalAssessedValue: z.number(),
  segments: z.array(SegmentMetricSchema),
});

export type MarketOverview = z.infer<typeof MarketOverviewSchema>;

/** One point in a year-over-year trend line. */
export const YearTrendPointSchema = z.object({
  taxYear: z.number().int(),
  totalAccounts: z.number().int(),
  taxableAccounts: z.number().int(),
  filedAccounts: z.number().int(),
  unfiledAccounts: z.number().int(),
  filingRate: z.number().min(0).max(1).nullable(),
  totalAssessedValue: z.number(),
  estimatedPenalty: z.number(),
});

export type YearTrendPoint = z.infer<typeof YearTrendPointSchema>;

/** A bucket in a value-band or state-class distribution. */
export const DistributionBucketSchema = z.object({
  label: z.string(),
  /** Lower bound for value bands; null for categorical breakdowns. */
  lowerBound: z.number().nullable(),
  upperBound: z.number().nullable(),
  accountCount: z.number().int(),
  totalAssessedValue: z.number(),
  unfiledAccountCount: z.number().int(),
  estimatedPenalty: z.number(),
});

export type DistributionBucket = z.infer<typeof DistributionBucketSchema>;

/**
 * Revenue feasibility model. Deliberately explicit about its inputs so the
 * output is arguable rather than asserted.
 */
// Coerced because this schema is parsed straight from a query string, where
// every value arrives as text.
export const OpportunityModelInputSchema = z.object({
  jurisdictionId: z.string(),
  taxYear: z.coerce.number().int(),
  segment: SegmentKeySchema.default('core_icp'),
  /** Annual subscription price per account. */
  pricePerAccount: z.coerce.number().positive().default(399),
  /** Share of the addressable list that converts, 0–1. */
  conversionRate: z.coerce.number().min(0).max(1).default(0.035),
});

export type OpportunityModelInput = z.infer<typeof OpportunityModelInputSchema>;

export const OpportunityModelSchema = z.object({
  input: OpportunityModelInputSchema,
  addressableAccounts: z.number().int(),
  /** Every addressable account converted — the ceiling, not a forecast. */
  totalAddressableRevenue: z.number(),
  expectedAccounts: z.number(),
  expectedRevenue: z.number(),
  /** What those accounts currently pay in penalties, i.e. the buyer's savings. */
  currentPenaltyBurden: z.number(),
  medianPenaltyPerAccount: z.number().nullable(),
  /** Positive when the product costs less than the penalty it removes. */
  medianCustomerSavings: z.number().nullable(),
});

export type OpportunityModel = z.infer<typeof OpportunityModelSchema>;
