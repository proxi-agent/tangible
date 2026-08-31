import type { RuleProvenance } from '@tangible/types';

/**
 * Adopted tax rates, which are the other half of every dollar this product
 * prints.
 *
 * A finding's worth is market value times a rate. The value side has been
 * carefully sourced from the district's published depreciation guide and is
 * defended by a golden suite. The rate side was, until this table existed, a
 * single constant — 2.5% for every Texas county, carried on the jurisdiction
 * row and multiplied into leakage, tax at risk, expected recovery and the
 * queue's whole ranking.
 *
 * The constant is wrong in the direction that matters. Measured against the
 * 2025 Harris roll, the real value-weighted rate has a median of 2.13% and sits
 * below 2.5% for 90.6% of business accounts, so the constant overstates the
 * client's overpayment on nine accounts in ten. That is the one direction this
 * product must never err in.
 */

/**
 * One taxing unit's adopted rate, in the units the district publishes it in:
 * dollars per $100 of taxable value. Kept as published rather than normalised
 * to a fraction so a reviewer can read this table against the district's own
 * rate notice without doing arithmetic in their head. `perDollar` below is the
 * one place the conversion happens.
 */
export interface TaxUnitRate {
  /** The district's own code for the unit — HCAD's `tax_dist`, e.g. `040`. */
  code: string;
  /** As the district names it: `HARRIS COUNTY`, `HOUSTON ISD`. */
  name: string;
  /**
   * Dollars per $100. Zero is a real value, not a gap: 437 of Harris County's
   * 1,072 units levied nothing in 2025 — dissolved districts, and districts
   * that exist on the roll without a levy. They are kept in the table because
   * dropping them would turn a unit that correctly taxes nothing into a unit
   * whose rate is missing, and the difference decides whether an account can be
   * priced at all.
   */
  ratePer100: number;
}

/**
 * Whether the year's rates are adopted yet.
 *
 * Texas taxing units adopt their rates in the late summer and autumn of the tax
 * year (Tex. Tax Code 26.05), which means for most of the year the current
 * year's rate does not exist. The source file carries the column anyway, filled
 * with zeros, next to a column holding last year's adopted rate — so the way to
 * get this wrong is to read the prior year's number as the current year's. It
 * is the unsafe direction again wherever rates fell.
 *
 * So an unadopted year is a status, not an empty table. The registry holds the
 * year, `accountRate` refuses to price against it, and the caller says the
 * rates are not adopted rather than quietly using last year's.
 */
export type RateTableStatus = 'adopted' | 'awaiting-adoption';

export interface RateTable {
  provenance: RuleProvenance;
  jurisdictionId: string;
  /** How a person says it — "Harris County, TX". */
  jurisdictionName: string;
  taxYear: number;
  status: RateTableStatus;
  /**
   * The fraction of market value a unit assesses. One in Texas and Florida,
   * which is why it would be easy to leave out — and 0.15 in Louisiana and
   * Mississippi, which is why it is a field rather than an assumption. A rate
   * without its ratio is only correct in the states that happen to assess at
   * full value.
   */
  assessmentRatio: number;
  source: { title: string; url: string | null; pages: string | null };
  /** Unit code → rate. Empty where `status` is `awaiting-adoption`. */
  units: Readonly<Record<string, TaxUnitRate>>;
  /** Why there are no rates, where `status` is `awaiting-adoption`. */
  awaiting: { reason: string; expected: string } | null;
}

/** Dollars per $100 as a fraction of value. The only place this converts. */
export function perDollar(ratePer100: number): number {
  return ratePer100 / 100;
}
