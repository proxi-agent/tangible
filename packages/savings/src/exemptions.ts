/**
 * Statutory exemptions applied after the schedules have done their work.
 *
 * Kept as named, dated constants rather than inline numbers for the same reason
 * the depreciation schedules are committed data: this is a published figure
 * that changes by legislation, it decides what a client owes, and it should be
 * reviewable in a diff when it changes.
 */

/**
 * Texas business personal property exemption, tax year 2026 onward.
 *
 * Raised from $2,500 to $125,000 by HB 9 (89th Legislature, 2025), contingent
 * on the constitutional amendment approved as Proposition 9 in November 2025.
 *
 * Two caveats a reader has to carry. It is granted **per taxing unit** against
 * that unit's own levy, so modelling it as a single subtraction against a
 * blended rate is an approximation that slightly understates the benefit. And
 * it is a threshold worth watching in its own right: a client whose whole
 * corrected position lands under it owes nothing at all, which changes the
 * conversation from a refund to a filing-only engagement.
 */
export const TX_EXEMPTION_2026 = 125_000;

/** No exemption is assumed for a jurisdiction we have not looked up. */
export function exemptionFor(jurisdictionId: string | null, taxYear: number): number {
  if (!jurisdictionId?.startsWith('tx-')) return 0;
  return taxYear >= 2026 ? TX_EXEMPTION_2026 : 2_500;
}
