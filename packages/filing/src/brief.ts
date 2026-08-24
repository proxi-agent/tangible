import type { AssessmentNotice, ProtestBriefFacts, RenditionFiling } from '@tangible/types';
import type { RenditionPosition } from './positions.js';

/**
 * Assemble the facts a protest brief may argue from — deterministically.
 *
 * The model that drafts the prose never sees the database; it sees this
 * object and nothing else. So this function is where every number is decided:
 * which filing answers the notice, what the over-assessment is, which finding
 * positions travel. Pure, so the arithmetic is testable without a notice on
 * file anywhere.
 */

/**
 * Why a brief cannot be drafted, or null when it can.
 *
 * The bar is deliberately low — a notice with no filed return still deserves
 * an argument (the unfiled cases are where 22.28 penalties live) — but a
 * brief needs something to argue *against*, and a dead notice or one that
 * prints no value gives it nothing.
 */
export function briefBlocker(notice: AssessmentNotice): string | null {
  if (notice.status !== 'active') {
    return `This notice is ${notice.status} — draft the brief on the notice that stands.`;
  }
  if (notice.appraisedValue === null) {
    return 'The notice records no appraised value, so there is no number to argue against. Record the value first.';
  }
  if (notice.resolution !== null) {
    return 'This protest has ended. The brief would argue a question the board has already answered.';
  }
  return null;
}

export function assembleBriefFacts(
  notice: AssessmentNotice,
  /** The standing filed return for this site and year, where one went out. */
  filing: RenditionFiling | null,
  positions: readonly RenditionPosition[],
): ProtestBriefFacts {
  const filed =
    filing !== null
      ? {
          filedOn: filing.filedOn,
          totalHistoricalCost: filing.totalHistoricalCost,
          scheduleValue: filing.scheduleValue,
          assetCount: filing.assetCount,
        }
      : null;

  // Positive is the over-assessment; negative means the district came in
  // under our own number, and the drafted brief is told to say so rather
  // than argue for a raise.
  const overAssessment =
    notice.appraisedValue !== null && filed !== null
      ? notice.appraisedValue - filed.scheduleValue
      : null;

  return {
    taxYear: notice.taxYear,
    locationLabel: notice.locationLabel,
    accountId: notice.accountId,
    districtName: notice.districtName,
    noticedOn: notice.noticedOn,
    protestDeadline: notice.protest.deadline,
    appraisedValue: notice.appraisedValue,
    priorYearValue: notice.priorYearValue,
    renditionPenaltyApplied: notice.renditionPenaltyApplied,
    waiverDeadline: notice.protest.waiverDeadline,
    filed,
    overAssessment,
    // Rejected positions stay home: the engagement looked and dropped them,
    // and handing a dropped claim to the drafter is how it comes back as an
    // argument nobody decided to make. Pending and undecided travel — the
    // brief's gaps section is exactly where "still waiting on the client"
    // belongs.
    positions: positions
      .filter((position) => position.status !== 'rejected')
      .filter((position) => position.taxYear === notice.taxYear)
      .map((position) => ({
        title: position.title,
        status: position.status,
        cost: position.cost,
        assetCount: position.assetCount,
      })),
  };
}
