/**
 * Domain constants for business personal property (BPP).
 *
 * These are policy numbers, not tuning knobs — they change when a legislature
 * changes them, so they live in one place and are referenced by both the
 * analytics SQL and the UI copy.
 *
 * Everything here was originally Texas, and much of it still is: the state class
 * codes and the rendition vocabulary have no meaning outside Texas. The
 * *exemption and penalty* numbers do not have that luxury, because they decide
 * which accounts count as taxable — so those are keyed by state. Scoring a
 * Florida roll against the Texas exemption would misstate the taxable base by an
 * order of magnitude in the direction that flatters the answer.
 */

/**
 * Per-location BPP exemption. Prop 9 (Nov 2025) / HB 9 raised this from $2,500
 * to $125,000 effective for the 2026 tax year. Accounts below the threshold owe
 * no tax but must still file an exemption certification.
 */
export const BPP_EXEMPTION_BY_YEAR: Readonly<Record<number, number>> = {
  2021: 2_500,
  2022: 2_500,
  2023: 2_500,
  2024: 2_500,
  2025: 2_500,
  2026: 125_000,
};

/**
 * Florida's tangible personal property exemption, s.196.183 F.S. — a flat
 * $25,000 per return since the 2008 constitutional amendment, unchanged since.
 * An account under it owes nothing but still has to file once to claim it.
 */
export const FL_TPP_EXEMPTION_BY_YEAR: Readonly<Record<number, number>> = {
  2021: 25_000,
  2022: 25_000,
  2023: 25_000,
  2024: 25_000,
  2025: 25_000,
  2026: 25_000,
};

/**
 * Florida s.193.072: failing to file a TPP return carries 25% of the tax levied,
 * against Texas's 10%. Late filing is 5% a month to a maximum of 25%.
 *
 * This rate is used to model exposure from the statute, exactly as the Texas
 * rate is. It is unrelated to the roll's own `PEN_RATE` column, which records
 * what an appraiser actually applied and is too unevenly populated to use.
 */
export const FL_FAILURE_TO_FILE_PENALTY_RATE = 0.25;

export const CURRENT_TAX_YEAR = 2026;

/** Exemption in effect for a tax year, defaulting forward from the newest rule. */
export function exemptionForYear(year: number): number {
  const known = BPP_EXEMPTION_BY_YEAR[year];
  if (known !== undefined) return known;
  const years = Object.keys(BPP_EXEMPTION_BY_YEAR).map(Number);
  const nearest = year > Math.max(...years) ? Math.max(...years) : Math.min(...years);
  return BPP_EXEMPTION_BY_YEAR[nearest] ?? 125_000;
}

/**
 * Blended total property tax rate used to dollarize appraised value. Harris
 * County's combined rate across overlapping jurisdictions runs ~2.5%.
 */
export const DEFAULT_BLENDED_TAX_RATE = 0.025;

/**
 * The blend to assume when a jurisdiction has no rate of its own on file, per
 * state.
 *
 * Florida quotes its rate in mills rather than percent, and a combined county,
 * school, municipal and special-district levy runs roughly 16 to 23 mills —
 * 1.6% to 2.3% — so 2.0% is the middle of that range rather than a number
 * carried over from Harris County. The two happen to be close, which is exactly
 * why this is worth writing down: a Texas default silently applied to a Florida
 * account would produce a plausible answer, and a plausible wrong answer is the
 * kind nobody checks.
 *
 * These are placeholders in the same sense the acceptance rates are: real
 * millage is per taxing authority and published every August with the TRIM
 * notice. A jurisdiction row with its own rate always wins.
 */
export const DEFAULT_RATE_BY_STATE: Readonly<Record<string, number>> = {
  TX: 0.025,
  FL: 0.02,
};

/** The default blend for a jurisdiction id, falling back to the Texas figure. */
export function defaultRateFor(jurisdictionId: string | null | undefined): number {
  if (!jurisdictionId) return DEFAULT_BLENDED_TAX_RATE;
  const dash = jurisdictionId.indexOf('-');
  const state = (dash === -1 ? jurisdictionId : jurisdictionId.slice(0, dash)).toUpperCase();
  return DEFAULT_RATE_BY_STATE[state] ?? DEFAULT_BLENDED_TAX_RATE;
}

/**
 * Texas Tax Code Sec. 22.28: 10% of the taxes due when a business fails to
 * render. It recurs every year the filing is skipped.
 */
export const RENDITION_PENALTY_RATE = 0.1;

/** Sec. 22.29 adds a 50% penalty for fraudulent renditions — tracked separately. */
export const FRAUD_PENALTY_RATE = 0.5;

/** The statutory rules that decide whether an account is taxable, per state. */
export interface StatePolicy {
  exemptionByYear: Readonly<Record<number, number>>;
  /** Statutory penalty for not filing, as a share of the tax due. */
  penaltyRate: number;
}

/**
 * Policy by state.
 *
 * A state absent from this table gets no policy rows at all, which is
 * deliberate: its accounts then fall back to the query defaults rather than
 * being silently scored against another state's statute.
 */
export const POLICY_BY_STATE: Readonly<Record<string, StatePolicy>> = {
  TX: { exemptionByYear: BPP_EXEMPTION_BY_YEAR, penaltyRate: RENDITION_PENALTY_RATE },
  FL: { exemptionByYear: FL_TPP_EXEMPTION_BY_YEAR, penaltyRate: FL_FAILURE_TO_FILE_PENALTY_RATE },
};

/** Rendition deadline (month/day). Extensions to May 15 are available on request. */
export const RENDITION_DEADLINE = { month: 4, day: 15 } as const;
export const RENDITION_EXTENDED_DEADLINE = { month: 5, day: 15 } as const;

/**
 * Texas state class code prefixes, grouped by how they interact with the
 * rendition process. Only `commercial` and `industrial` are addressable by a
 * rendition-automation product.
 */
export const STATE_CLASS_GROUPS = {
  /** L1 = commercial personal property, L2 = industrial personal property. */
  commercial: ['L1'],
  industrial: ['L2'],
  /**
   * S = special inventory (dealers) — taxed via monthly declarations, not
   * renditions. Districts write this as bare `S` or as `S1`–`S9`, and the bare
   * prefix covers both since matching is by prefix.
   */
  specialInventory: ['S'],
  /** J = utilities and pipelines — valued through a separate process. */
  utility: ['J1', 'J2', 'J3', 'J4', 'J5', 'J6', 'J7', 'J8', 'J9'],
  /** X = fully exempt (hospitals, charities, government). */
  exempt: ['X'],
} as const;

export type StateClassGroup = keyof typeof STATE_CLASS_GROUPS;

/** State class prefixes that a rendition-automation product can actually serve. */
export const ADDRESSABLE_STATE_CLASSES: readonly string[] = [
  ...STATE_CLASS_GROUPS.commercial,
  ...STATE_CLASS_GROUPS.industrial,
];

export function stateClassGroup(stateClass: string | null | undefined): StateClassGroup | null {
  if (!stateClass) return null;
  const code = stateClass.trim().toUpperCase();
  for (const [group, prefixes] of Object.entries(STATE_CLASS_GROUPS)) {
    if (prefixes.some((p) => code.startsWith(p))) return group as StateClassGroup;
  }
  return null;
}

/** Default floor for "worth pursuing" analysis, aligned with the 2026 exemption. */
export const DEFAULT_MIN_VALUE = 125_000;

/** An account must appear in at least this many years before trend flags apply. */
export const DEFAULT_MIN_YEARS_ON_ROLL = 4;
