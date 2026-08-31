import type { RateBasis, RuleProvenance } from '@tangible/types';
import { latestAdoptedYear, rateTableFor } from './registry.js';
import { perDollar, type RateTable } from './types.js';

/**
 * One account's own tax rate, assembled from the units that actually tax it.
 *
 * The unit of work is the account rather than the county because two accounts
 * in Harris County do not pay the same rate. The county, the flood control
 * district, the port, the hospital district and the education department tax
 * every account in the county; the school district, the city, the college and
 * whatever water or management districts the address falls in do not. Across
 * the 2025 Harris roll the value-weighted rate runs from 0.63% to 3.62% with a
 * median of 2.13%, which is the whole argument for this file: the 2.5% constant
 * it replaces is above the real rate for 90.6% of business accounts.
 */

/** How much of an account one taxing unit taxes. */
export interface UnitPlacement {
  /** The district's own code — HCAD's `tax_dist`. */
  unitCode: string;
  /**
   * The fraction of the account this unit taxes, in [0, 1].
   *
   * A fraction rather than the published value, because the fraction is the
   * durable fact. Districts publish an absolute appraised value per unit, and
   * those values can be a certification cycle behind the account roll they sit
   * beside — the same account appearing at last year's value in every unit. The
   * split between the units is what did not change, so the warehouse normalizes
   * at load and hands the ratio here. See `account_unit.share`.
   */
  share: number;
}

export interface UnitShare {
  code: string;
  name: string;
  ratePer100: number;
  /**
   * This unit's value as a fraction of the account's. One for a unit that taxes
   * the whole account, which is the ordinary case; less for an account split
   * across units, which is a pipeline or a utility rather than a shop.
   */
  share: number;
}

export interface AccountRate {
  jurisdictionId: string;
  taxYear: number;
  /** What to hand the savings engine. */
  basis: RateBasis;
  /** The same figure as a percentage of market value, for display: 2.1252. */
  percentOfValue: number;
  units: readonly UnitShare[];
  provenance: RuleProvenance;
}

export type AccountRateResult =
  | { ok: true; rate: AccountRate }
  | { ok: false; reason: string; provenance: RuleProvenance | null };

/**
 * The account's rate, value-weighted across its units.
 *
 * Summing the units' rates is the obvious formula and it is right only for the
 * ordinary case, where every unit taxes the whole account. It is badly wrong
 * for an account whose value is split between units: on the 2025 Harris roll
 * the accounts sitting in hundreds of districts with a different value in each
 * come out at 295% if the rates are summed. So the rate is
 *
 *     Σ (value in unit × unit rate) ÷ the account's own appraised value
 *
 * which collapses to the sum of the rates when every unit's value is the
 * account's, and stays right when it is not.
 *
 * The denominator does not appear here at all: the shares arrive already
 * divided. That is deliberate. Deriving it from the placements is unsafe in
 * both directions — summing them double-counts the ordinary case, where nine
 * overlapping units each appraise the whole account, and taking the largest is
 * only right because the largest is the county unit, which is a fact about the
 * source file rather than about this arithmetic. Whoever reads the file knows
 * that; this function should not have to.
 */
export function accountRate(args: {
  jurisdictionId: string;
  taxYear: number;
  placements: readonly UnitPlacement[];
}): AccountRateResult {
  const table = rateTableFor(args.jurisdictionId, args.taxYear);
  if (!table) {
    return {
      ok: false,
      provenance: null,
      reason: `No adopted rate table for ${args.jurisdictionId}, tax year ${args.taxYear}.`,
    };
  }
  if (table.status !== 'adopted') {
    return {
      ok: false,
      provenance: table.provenance,
      reason: table.awaiting
        ? `${table.awaiting.reason} ${table.awaiting.expected}`
        : `Rates for ${table.jurisdictionName}, tax year ${table.taxYear} are not adopted.`,
    };
  }
  if (args.placements.length === 0) {
    return {
      ok: false,
      provenance: table.provenance,
      reason: 'No taxing units are recorded for this account, so its rate cannot be assembled.',
    };
  }
  const units: UnitShare[] = [];
  for (const placement of args.placements) {
    const unit = table.units[placement.unitCode];
    if (!unit) {
      return {
        ok: false,
        provenance: table.provenance,
        reason: `Taxing unit ${placement.unitCode} is not in the ${table.taxYear} rate table. Pricing the account without it would quietly leave a levy out.`,
      };
    }
    if (!Number.isFinite(placement.share) || placement.share < 0) {
      return {
        ok: false,
        provenance: table.provenance,
        reason: `Taxing unit ${placement.unitCode} (${unit.name}) has no usable share of this account.`,
      };
    }
    /**
     * A unit cannot tax more of the account than the account is worth. The
     * warehouse cannot produce such a share — it divides by the largest unit on
     * the account — but a caller assembling placements by hand can, and the
     * rate that would come out of it is meaningless rather than merely high.
     * Refusing is the safe answer: the caller falls back to a rate it has to
     * label as an estimate, which is visible on the page, where a 25.7% rate
     * assembled from a contradiction would not be.
     */
    if (placement.share > 1 + 1e-6) {
      return {
        ok: false,
        provenance: table.provenance,
        reason: `${unit.name} is recorded as taxing ${(placement.share * 100).toFixed(1)}% of this account. A unit cannot tax more of it than there is, so no rate is assembled.`,
      };
    }
    units.push({
      code: unit.code,
      name: unit.name,
      ratePer100: unit.ratePer100,
      share: placement.share,
    });
  }

  /**
   * Every unit taxing nothing is not a 0% account, it is an account whose
   * placements say nothing at all. Returning a rate of zero would price its
   * whole position at nothing — no leakage, no tax at risk, no recovery — and
   * do it silently. The estimate is the honest answer here.
   */
  if (!units.some((unit) => unit.share > 0)) {
    return {
      ok: false,
      provenance: table.provenance,
      reason:
        'Every taxing unit is recorded as taxing none of this account, so no rate is assembled.',
    };
  }

  const millage = units.reduce((sum, unit) => sum + unit.share * perDollar(unit.ratePer100), 0);
  return {
    ok: true,
    rate: {
      jurisdictionId: table.jurisdictionId,
      taxYear: table.taxYear,
      basis: { assessmentRatio: table.assessmentRatio, millage },
      percentOfValue: millage * table.assessmentRatio * 100,
      units,
      provenance: table.provenance,
    },
  };
}

/**
 * The account's rate for a year, or the most recent adopted year before it.
 *
 * A rendition for the coming season is prepared months before that season's
 * rates are adopted, so asking for the engagement's own year is usually asking
 * for a table that does not exist yet. Refusing there would mean the whole
 * feature only ever applied to a year already closed.
 *
 * What comes back says which year it is: `rate.taxYear` is the table's year,
 * not the year asked for. A caller that prints the figure has to compare the
 * two and label a substitution — the rates moved between 2025 and 2026, and a
 * borrowed year presented as adopted would be the same undisclosed
 * approximation this whole file exists to remove.
 */
export function accountRateAsOf(args: {
  jurisdictionId: string;
  taxYear: number;
  placements: readonly UnitPlacement[];
}): AccountRateResult {
  const asked = accountRate(args);
  if (asked.ok) return asked;

  // Only a missing or unadopted *table* is worth retrying. Every other refusal
  // — an unknown unit, a share over one, no placements at all — is a fact about
  // the account, and it will refuse identically in every other year.
  const table = rateTableFor(args.jurisdictionId, args.taxYear);
  if (table && table.status === 'adopted') return asked;

  const fallbackYear = latestAdoptedYear(args.jurisdictionId, args.taxYear);
  if (fallbackYear === undefined) return asked;

  const fallback = accountRate({ ...args, taxYear: fallbackYear });
  // The earlier year failing on its own terms is not more informative than the
  // year that was actually asked for, so the original refusal is what surfaces.
  return fallback.ok ? fallback : asked;
}

/**
 * Several accounts read as one rate.
 *
 * An engagement is one register, one classification and one report, while the
 * roll is per site: a client with four Harris locations has four accounts, four
 * unit combinations and four rates. The report quotes one, so the accounts are
 * blended by what the district has each of them at — the proportion in which
 * the client actually pays them.
 *
 * The units survive the blend, with each unit's share weighted the same way.
 * That is what makes the result usable for more than display: the blended
 * millage is exactly the weighted mean of the accounts' millages either way, so
 * nothing is lost, and keeping the units means `taxForAccount` still has
 * something to apply a per-unit exemption against. A blend that emptied them
 * would silently price a four-site client's exemption as a one-site client's.
 *
 * Two things it does not claim. The blended shares describe the *engagement*,
 * not any one account — a unit that taxes all of one account and none of the
 * other three comes out at a quarter, which is true of the whole and true of no
 * part of it. And the weighting is the assumption a caller has to be willing to
 * state: the corrected value is taken to sit across the accounts in the same
 * proportion the district's own assessment does.
 *
 * Returns null for an empty list, and the single entry itself for a list of
 * one — a blend of one is that account, units and all, not a copy of it.
 */
export function blendAccountRates(
  entries: readonly { rate: AccountRate; weight: number }[],
): AccountRate | null {
  if (entries.length === 0) return null;
  if (entries.length === 1) return entries[0]!.rate;

  const total = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight), 0);
  // Every account at zero on the roll is not a reason to drop them; it is the
  // case where "value-weighted" has no meaning, and equal weights are what is
  // left to mean.
  const weightOf = (entry: (typeof entries)[number]) =>
    total > 0 ? Math.max(0, entry.weight) / total : 1 / entries.length;

  const merged = new Map<string, UnitShare>();
  for (const entry of entries) {
    const weight = weightOf(entry);
    for (const unit of entry.rate.units) {
      const held = merged.get(unit.code);
      if (held) held.share += unit.share * weight;
      else merged.set(unit.code, { ...unit, share: unit.share * weight });
    }
  }
  const units = [...merged.values()].sort((a, b) => a.code.localeCompare(b.code));

  const lead = entries[0]!.rate;
  const millage = units.reduce((sum, unit) => sum + unit.share * perDollar(unit.ratePer100), 0);
  return {
    jurisdictionId: lead.jurisdictionId,
    taxYear: lead.taxYear,
    basis: { assessmentRatio: lead.basis.assessmentRatio, millage },
    percentOfValue: millage * lead.basis.assessmentRatio * 100,
    units,
    provenance: lead.provenance,
  };
}

export interface UnitTax {
  code: string;
  name: string;
  /** The account's value this unit taxes, before its exemption. */
  value: number;
  /** What its own exemption takes off — never more than the value. */
  exempt: number;
  tax: number;
}

export interface AccountTax {
  tax: number;
  /** Summed across units. Not the exemption times the unit count. */
  exemptValue: number;
  byUnit: readonly UnitTax[];
}

/**
 * The tax on a value, unit by unit, with each unit's own exemption.
 *
 * This is the half of the arithmetic a blended rate cannot express. Tex. Tax
 * Code 11.145(b) grants the business personal property exemption — $125,000
 * from 1 January 2026, raised from $2,500 by HB 9 (89th Leg., 2025) and
 * Proposition 9 — "from taxation by a taxing unit", against that unit's own
 * levy. It is a deduction from appraised value, not a threshold: the pre-HB 9
 * section exempted property worth *less than* $2,500 and nothing above it,
 * where the section now reads "$125,000 of the appraised value".
 *
 * For the ordinary account the per-unit form and the blended form agree
 * exactly, and it is worth knowing why before reaching for this function. Where
 * every unit taxes the whole account, each unit's taxable value is the same
 * (V − 125,000), so the tax is (V − 125,000) × Σ rates — which is what a single
 * subtraction against a blended rate computes. The two answers separate in two
 * places, and only these two:
 *
 *   - An account split across units, where each unit taxes a different slice
 *     and each slice gets the whole exemption.
 *   - `grants`, below.
 *
 * `grants` is 11.145(c): the exemption "applies to each separate location in a
 * taxing unit", with all property at one location aggregated to decide that
 * location's taxable value. A client with four sites inside Houston ISD is
 * entitled to it four times there. That is the multiplier the blended form
 * genuinely cannot express, and it is the reason this function takes a count
 * rather than assuming one.
 *
 * Two more subsections a caller should know exist and this function does not
 * model, because both need facts about the property that a rate cannot see.
 * 11.145(d) and (d-1) give a lessor, and an owner whose property sits at
 * premises it neither owns nor leases, one exemption per taxing unit for all
 * such property regardless of location — a cap rather than a multiplier, so
 * passing a per-location `grants` count for that property would overstate it.
 * And 11.145(f) aggregates related business entities in a unified business
 * enterprise at a shared address, which is the anti-fragmentation rule: the
 * default of one grant per unit is the conservative side of it.
 */
export function taxForAccount(args: {
  rate: AccountRate;
  /** The value being taxed — the corrected market value, in the ordinary case. */
  marketValue: number;
  /** Per-unit exemption. Zero applies none. */
  exemptionPerUnit: number;
  /** Grants available in a unit, by unit code. One where unstated. See above. */
  grants?: Readonly<Record<string, number>>;
}): AccountTax {
  const ratio = args.rate.basis.assessmentRatio;
  const byUnit: UnitTax[] = args.rate.units.map((unit) => {
    const value = Math.max(0, args.marketValue) * unit.share * ratio;
    const count = Math.max(1, Math.floor(args.grants?.[unit.code] ?? 1));
    const exempt = Math.min(value, Math.max(0, args.exemptionPerUnit) * count);
    return {
      code: unit.code,
      name: unit.name,
      value,
      exempt,
      tax: (value - exempt) * perDollar(unit.ratePer100),
    };
  });
  return {
    tax: byUnit.reduce((sum, unit) => sum + unit.tax, 0),
    exemptValue: byUnit.reduce((sum, unit) => sum + unit.exempt, 0),
    byUnit,
  };
}

/** The table behind a jurisdiction-year, for a report footnote. */
export function rateSourceFor(jurisdictionId: string, taxYear: number): RateTable | undefined {
  return rateTableFor(jurisdictionId, taxYear);
}
