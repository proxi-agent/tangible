import type { EngagementResult, LetterFacts } from '@tangible/types';

/**
 * The result letter's facts: the scoreboard, verbatim, minus nothing.
 *
 * Unlike the unblock plan, which filters to what is blocked, the letter
 * carries every site — a letter that silently omits a site the client knows
 * about reads as an oversight, and the per-site `standing` prose already says
 * plainly when a site has not started. What the assembler refuses instead is
 * the empty season: a result letter before anything has gone out would be a
 * status update wearing the wrong clothes.
 */

/** Why a letter cannot be drafted yet, or null when it can. */
export function letterBlocker(result: EngagementResult): string | null {
  if (result.siteCount === 0) {
    return 'No returns are owed this season yet — there is nothing to report.';
  }
  if (result.sites.every((site) => site.phase === 'unfiled')) {
    return 'Nothing has been filed yet — there is no result to report to the client.';
  }
  return null;
}

/** The scoreboard's own numbers and prose, frozen for the drafter. */
export function assembleLetterFacts(clientName: string, result: EngagementResult): LetterFacts {
  return {
    clientName,
    taxYear: result.taxYear,
    sites: result.sites.map((site) => ({
      label: site.label,
      accountId: site.accountId,
      phase: site.phase,
      renderedCost: site.renderedCost,
      filedOn: site.filedOn,
      noticedValue: site.noticedValue,
      standingValue: site.standingValue,
      settledVia: site.settledVia,
      reduction: site.reduction,
      estimatedTaxReduction: site.estimatedTaxReduction,
      nextDeadline: site.nextDeadline,
      standing: site.standing,
    })),
    settledCount: result.settledCount,
    siteCount: result.siteCount,
    renderedTotal: result.renderedTotal,
    noticedTotal: result.noticedTotal,
    standingTotal: result.standingTotal,
    reductionTotal: result.reductionTotal,
    reductionCount: result.reductionCount,
    estimatedTaxTotal: result.estimatedTaxTotal,
    estimatedTaxCount: result.estimatedTaxCount,
    standing: result.standing,
  };
}
