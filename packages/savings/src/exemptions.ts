import { POLICY_BY_STATE, type StatePolicy } from '@tangible/types';

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
 * The figure is what **one location gets in one taxing unit**, not what a
 * client gets. Each unit grants it against its own levy and 11.145(c) grants it
 * again at each separate location inside that unit, so the multiplying is done
 * downstream by `taxForAccount` from the account's real unit placements. A
 * report with no unit list falls back to subtracting this once, which is exactly
 * right for the ordinary single-site account whose units all tax the whole of
 * it, and understates every other case.
 *
 * It is also a threshold worth watching in its own right: a client whose whole
 * corrected position lands under it owes nothing at all, which changes the
 * conversation from a refund to a filing-only engagement.
 */
export const TX_EXEMPTION_2026 = 125_000;

/**
 * Florida's tangible personal property exemption, s. 196.183, F.S.
 *
 * $25,000, flat since the 2008 constitutional amendment, and its shape is not
 * the Texas one. It is granted **per return, per location, per county** — a
 * client with four Florida sites in two counties files four returns and claims
 * it four times, where the same client in Texas gets one exemption per taxing
 * unit against a single account. Modelling it as one subtraction against a
 * client's whole position understates it, and by more the more sites they have.
 *
 * The second thing a reader has to carry is that it is not automatic. An
 * account has to file a DR-405 once to claim it, and a taxpayer who never filed
 * because they were under the threshold is not exempt — they are unfiled, and
 * s. 193.072 penalties run on the tax that would have been due.
 */
export const FL_EXEMPTION = 25_000;

/**
 * The exemption in force, from the state's own policy table.
 *
 * Written against `POLICY_BY_STATE` rather than a chain of `startsWith` because
 * the second state is the point: a state absent from that table returns zero,
 * which is the honest answer for a jurisdiction nobody has looked up, and
 * adding a third state is a row there rather than a branch here.
 *
 * The answer is per *return*, and in Florida a return is per location per
 * county. Callers holding a whole client's position across several sites should
 * apply this once per site rather than once per client; see
 * `exemptionForSites`.
 */
export function exemptionFor(jurisdictionId: string | null, taxYear: number): number {
  const policy = policyFor(jurisdictionId);
  if (!policy) return 0;
  const known = policy.exemptionByYear[taxYear];
  if (known !== undefined) return known;
  // A year outside the published range takes the nearest published one, in the
  // direction it falls. Texas 2027 is the 2026 figure until HB 9's successor
  // says otherwise; Texas 2019 is the pre-HB 9 figure, not the new one.
  const years = Object.keys(policy.exemptionByYear).map(Number);
  if (years.length === 0) return 0;
  const nearest = taxYear > Math.max(...years) ? Math.max(...years) : Math.min(...years);
  return policy.exemptionByYear[nearest] ?? 0;
}

/**
 * The exemption a client actually gets across their sites in one jurisdiction.
 *
 * Florida grants it against each return, and a return is one location in one
 * county, so the multiplier is the site count — a report that quoted $25,000 to
 * a six-site Florida client would be understating their position by $125,000 of
 * value.
 *
 * Texas multiplies too, and returns one here anyway. Its multiplier is per
 * taxing unit and then per location within the unit, which the client's site
 * count cannot answer: two sites either side of a school district line claim two
 * exemptions there, two sites inside it claim two, and two sites in different
 * counties claim none of each other's. That is a question for the roll's own
 * placements, so it is answered where they are — `taxForAccount`, from the
 * `exemptionGrants` the caller assembles — and this stays the per-unit amount
 * that gets multiplied there.
 */
export function exemptionForSites(
  jurisdictionId: string | null,
  taxYear: number,
  siteCount: number,
): number {
  const each = exemptionFor(jurisdictionId, taxYear);
  if (each === 0) return 0;
  const perReturn = stateOf(jurisdictionId) === 'FL';
  return perReturn ? each * Math.max(1, siteCount) : each;
}

/** The state a jurisdiction id names, upper-cased for `POLICY_BY_STATE`. */
function stateOf(jurisdictionId: string | null): string | null {
  if (!jurisdictionId) return null;
  const dash = jurisdictionId.indexOf('-');
  return (dash === -1 ? jurisdictionId : jurisdictionId.slice(0, dash)).toUpperCase();
}

function policyFor(jurisdictionId: string | null): StatePolicy | undefined {
  const state = stateOf(jurisdictionId);
  return state ? POLICY_BY_STATE[state] : undefined;
}
