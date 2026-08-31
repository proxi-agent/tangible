import 'server-only';
import { appraisalDistrictName, operativeDeadline, statutoryDates } from '@tangible/filing';
import type {
  AssessmentNotice,
  ClientFilingStatement,
  ClientReturn,
  RenditionExtension,
  RenditionFiling,
} from '@tangible/types';
import { engagementExtensions } from '@/lib/extensions';
import { engagementFilings } from '@/lib/filings';
import { engagementNotices } from '@/lib/notices';
import { engagementReturns } from '@/lib/sites';
import { daysUntil } from '@/lib/today';
import { fetchEngagement } from '@/lib/workspace';

/**
 * A business's own returns, for the business.
 *
 * Deliberately not `filingSeason` with fields stripped. That board answers "can
 * this go out today", and to answer it, it builds a rendition per site and runs
 * the record gate over each one. Every expensive thing it does exists to produce
 * blockers — and blockers are the one thing this must not carry, because they
 * name defects in our record rather than facts about the taxpayer's account.
 *
 * Building the narrow object separately means the leak is not possible rather
 * than merely avoided: nothing here computes a blocker, so no later edit can
 * forward one. It is also four indexed reads and no classification, which is
 * why a client page can hold it without waiting on a season.
 *
 * The cost of the split is that the two screens could drift. They cannot drift
 * about anything that matters: both take the operative deadline from
 * `operativeDeadline`, the standing filing from the same one-per-site-and-year
 * rule, and the notice from the same `active` filter. What the firm's board
 * adds is our opinion; what this one carries is the record.
 */
export async function clientFilingStatement(engagementId: string): Promise<ClientFilingStatement> {
  const { engagement } = await fetchEngagement(engagementId);
  const [owed, filings, extensions, notices] = await Promise.all([
    engagementReturns(engagementId),
    engagementFilings(engagementId),
    engagementExtensions(engagementId),
    engagementNotices(engagementId),
  ]);
  const statutory = statutoryDates(engagement.taxYear);

  const requested = new Map<string, RenditionExtension[]>();
  for (const extension of extensions) {
    if (extension.taxYear !== engagement.taxYear) continue;
    const bucket = requested.get(extension.locationId);
    if (bucket) bucket.push(extension);
    else requested.set(extension.locationId, [extension]);
  }

  // The standing return per site: one per site and year by construction, since
  // recording a second supersedes the first. A voided filing is not a filing —
  // it is a record we took back — and must read here as "not filed yet", which
  // the status test gives for free.
  const standing = new Map<string, RenditionFiling>();
  for (const filing of filings) {
    if (filing.status === 'filed' && filing.taxYear === engagement.taxYear) {
      standing.set(filing.locationId, filing);
    }
  }

  const noticed = new Map<string, AssessmentNotice>();
  for (const notice of notices) {
    if (notice.status === 'active' && notice.taxYear === engagement.taxYear) {
      noticed.set(notice.locationId, notice);
    }
  }

  const returns = owed.returns.map((entry): ClientReturn => {
    const deadline = operativeDeadline(requested.get(entry.locationId) ?? [], statutory.dueOn);
    const filing = standing.get(entry.locationId) ?? null;
    const notice = noticed.get(entry.locationId) ?? null;
    // The site's own district where it names one, else the engagement's — the
    // same fallback the return itself is filed under.
    const jurisdictionId = entry.jurisdictionId ?? engagement.jurisdictionId;
    const resolution = notice?.resolution ?? null;

    return {
      locationId: entry.locationId,
      label: entry.label,
      accountId: entry.accountId,
      districtName: jurisdictionId ? appraisalDistrictName(jurisdictionId) : null,

      dueOn: deadline.dueOn,
      statutoryDueOn: statutory.dueOn,
      daysToDue: daysUntil(deadline.dueOn),
      extension: deadline.extension
        ? {
            requestedOn: deadline.extension.requestedOn,
            extendedTo: deadline.extension.extendedTo,
            answeredOn: deadline.extension.answeredOn,
          }
        : null,

      filed: filing
        ? {
            filedOn: filing.filedOn,
            method: filing.method,
            confirmation: filing.confirmation,
            totalHistoricalCost: filing.totalHistoricalCost,
            assetCount: filing.assetCount,
            filedByAgent: filing.filedByAgent,
          }
        : null,

      notice: notice
        ? {
            noticedOn: notice.noticedOn,
            appraisedValue: notice.appraisedValue,
            priorYearValue: notice.priorYearValue,
            renditionPenaltyApplied: notice.renditionPenaltyApplied,
            protestDeadline: notice.protest.deadline,
            waiverDeadline: notice.protest.waiverDeadline,
            protestOpen: notice.protest.open,
            protestFiledOn: notice.protestFiledOn,
          }
        : null,

      resolution:
        resolution && resolution.status === 'recorded'
          ? {
              stage: resolution.stage,
              resolvedOn: resolution.resolvedOn,
              noticedValue: resolution.noticedValue,
              finalValue: resolution.finalValue,
              penaltyOutcome: resolution.penaltyOutcome,
            }
          : null,
    };
  });

  return {
    engagementId,
    taxYear: engagement.taxYear,
    statutoryDueOn: statutory.dueOn,
    extendedDueOn: statutory.extendedDueOn,
    returns,
    unplacedCount: owed.unplacedCount,
    unplacedCost: owed.unplacedCost,
  };
}
