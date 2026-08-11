/**
 * Domain constants for Texas business personal property (BPP).
 *
 * These are policy numbers, not tuning knobs — they change when the legislature
 * changes them, so they live in one place and are referenced by both the
 * analytics SQL and the UI copy.
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
 * Texas Tax Code Sec. 22.28: 10% of the taxes due when a business fails to
 * render. It recurs every year the filing is skipped.
 */
export const RENDITION_PENALTY_RATE = 0.1;

/** Sec. 22.29 adds a 50% penalty for fraudulent renditions — tracked separately. */
export const FRAUD_PENALTY_RATE = 0.5;

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
