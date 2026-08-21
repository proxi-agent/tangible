import 'server-only';
import { operativeDeadline, statutoryDates } from '@tangible/filing';
import type {
  AssessmentNotice,
  FilingSeason,
  RenditionExtension,
  RenditionFiling,
  SeasonReturn,
} from '@tangible/types';
import { engagementExtensions } from '@/lib/extensions';
import { blockingProblems, engagementFilings } from '@/lib/filings';
import { engagementNotices } from '@/lib/notices';
import { formInputs } from '@/lib/rendition';
import { engagementReturns } from '@/lib/sites';
import { fetchEngagement } from '@/lib/workspace';

/**
 * The filing season for one engagement.
 *
 * Everything before this answers about a single document — this draft, this
 * form, this filing. None of them answers the question a filer actually carries
 * around between January and April: which returns still have to go out, what is
 * holding each one up, and how long there is. An engagement with two sites owes
 * two forms, and until now the only place that number appeared at all was a
 * picker on the draft screen.
 *
 * The cost is real and worth stating: a season builds one rendition per return,
 * because "is this ready" cannot be answered without classifying the property,
 * applying the accepted findings and running the blockers — the same work the
 * draft screen does, once per site. Engagements have a handful of sites rather
 * than hundreds, and the board is its own query, so no page waits on it.
 */

/**
 * The posture the board reports against: cost basis, signed by us as agent.
 *
 * Blockers depend on both — a good faith estimate can demand notarization under
 * 22.24(e), and an agent with no Form 50-162 on file cannot sign at all. These
 * are the defaults the draft screen opens with, so a return the board calls
 * ready is one the operator finds ready when they click through. Switching the
 * basis on the draft can raise a blocker the board did not show; that is the
 * draft telling them something new, not the two screens disagreeing.
 */
const POSTURE = { basis: 'cost', filedByAgent: true } as const;

export async function filingSeason(engagementId: string): Promise<FilingSeason> {
  const { engagement } = await fetchEngagement(engagementId);
  const [filings, owed, extensions, notices] = await Promise.all([
    engagementFilings(engagementId),
    engagementReturns(engagementId),
    engagementExtensions(engagementId),
    engagementNotices(engagementId),
  ]);
  const statutory = statutoryDates(engagement.taxYear);

  // Every request on file for a site, in force or not: the operative date is
  // decided per site below, and a row that bought nothing still has to be
  // findable from the return it was sent for.
  const requested = new Map<string, RenditionExtension[]>();
  for (const extension of extensions) {
    if (extension.taxYear !== engagement.taxYear) continue;
    const bucket = requested.get(extension.locationId);
    if (bucket) bucket.push(extension);
    else requested.set(extension.locationId, [extension]);
  }
  const deadlineFor = (locationId: string) =>
    operativeDeadline(requested.get(locationId) ?? [], statutory.dueOn);

  // The standing return per site. One per site and year by construction —
  // recording a second supersedes the first — so the map cannot lose one.
  const standing = new Map<string, RenditionFiling>();
  for (const filing of filings) {
    if (filing.status === 'filed' && filing.taxYear === engagement.taxYear) {
      standing.set(filing.locationId, filing);
    }
  }

  // The notice that stands per site, on the same one-per-site-and-year rule.
  // Only `active` rows: a superseded notice is a clock the district itself
  // restarted, and a void one is a clock that never ran.
  const noticed = new Map<string, AssessmentNotice>();
  for (const notice of notices) {
    if (notice.status === 'active' && notice.taxYear === engagement.taxYear) {
      noticed.set(notice.locationId, notice);
    }
  }

  // One rendition per return, in parallel. `formInputs` carries the problems
  // the register cannot see alongside it — no signer, no situs, no site chosen
  // — and those are exactly what the record gate weighs, so the board weighs
  // the same list rather than a second one that agrees today.
  const rows = await Promise.all(
    owed.returns.map(async (entry): Promise<SeasonReturn> => {
      const { rendition, beyond } = await formInputs(engagementId, {
        ...POSTURE,
        locationId: entry.locationId,
      });
      const blockers = blockingProblems(rendition, beyond);
      const filing = standing.get(entry.locationId) ?? null;
      const deadline = deadlineFor(entry.locationId);
      return {
        locationId: entry.locationId,
        label: entry.label,
        accountId: entry.accountId,
        jurisdictionId: entry.jurisdictionId,
        status: filing ? 'filed' : blockers.length > 0 ? 'blocked' : 'ready',
        assetCount: entry.assetCount,
        registerCost: entry.totalCost,
        renderedCost: rendition.totalHistoricalCost,
        dueOn: deadline.dueOn,
        daysToDue: daysUntil(deadline.dueOn),
        extension: deadline.extension,
        blockers,
        warnings: rendition.blockers.filter((blocker) => blocker.severity === 'warning').length,
        filing,
        notice: noticed.get(entry.locationId) ?? null,
        driftedBy: filing ? rendition.totalHistoricalCost - filing.totalHistoricalCost : null,
      };
    }),
  );

  return {
    taxYear: engagement.taxYear,
    dueOn: statutory.dueOn,
    extendedDueOn: statutory.extendedDueOn,
    daysToDue: daysUntil(statutory.dueOn),
    returns: [...rows, ...filedButNoLongerOwed(rows, standing, noticed, deadlineFor)].sort(
      byWhatNeedsDoing,
    ),
    unplacedCount: owed.unplacedCount,
    unplacedCost: owed.unplacedCost,
  };
}

/**
 * Returns that went out for a site the register no longer places property at.
 *
 * Rare and worth carrying anyway. `engagementReturns` lists sites *holding*
 * property, so a site whose every row has since been disposed of drops off it —
 * and a board built only from what is owed would quietly retire a document the
 * district is still working from. The row is assembled from the filing itself
 * rather than from a site lookup, because the filing is the thing that froze
 * the label and the account, and that is what the return was filed under.
 */
function filedButNoLongerOwed(
  rows: SeasonReturn[],
  standing: Map<string, RenditionFiling>,
  noticed: Map<string, AssessmentNotice>,
  deadlineFor: (locationId: string) => { dueOn: string; extension: RenditionExtension | null },
): SeasonReturn[] {
  const covered = new Set(rows.map((row) => row.locationId));
  return [...standing.values()]
    .filter((filing) => !covered.has(filing.locationId))
    .map((filing) => {
      const deadline = deadlineFor(filing.locationId);
      return {
        locationId: filing.locationId,
        label: filing.locationLabel,
        accountId: filing.accountId,
        // Off the filing rather than the site: this row is a record of what
        // went out, and it went to whichever district was named that day.
        jurisdictionId: filing.jurisdictionId,
        status: 'filed' as const,
        assetCount: 0,
        registerCost: 0,
        renderedCost: 0,
        dueOn: deadline.dueOn,
        daysToDue: daysUntil(deadline.dueOn),
        extension: deadline.extension,
        blockers: [],
        warnings: 0,
        filing,
        // Carried here too. A site whose property has all gone still received
        // a notice for the year it was rendered, and the protest window on it
        // runs on regardless of what the register now holds.
        notice: noticed.get(filing.locationId) ?? null,
        driftedBy: -filing.totalHistoricalCost,
      };
    });
}

/**
 * Worklist order: what is stuck, then what can go out, then what has gone.
 *
 * Deliberately not the picker's order, which is by size and never moves. This
 * is a board somebody works down, so a return changes place when its state
 * changes — that is the movement being reported.
 */
const RANK: Record<SeasonReturn['status'], number> = { blocked: 0, ready: 1, filed: 2 };

function byWhatNeedsDoing(a: SeasonReturn, b: SeasonReturn): number {
  return (
    RANK[a.status] - RANK[b.status] ||
    b.renderedCost - a.renderedCost ||
    a.label.localeCompare(b.label)
  );
}

/**
 * Whole days from today to an ISO date, in UTC.
 *
 * UTC on both sides on purpose. A statutory date is a date, not an instant, and
 * subtracting a local midnight from a UTC one is how a deadline reads as one
 * day nearer or further depending on which side of the Atlantic the server
 * happens to be on.
 */
function daysUntil(iso: string): number {
  const today = new Date();
  const from = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - from) / 86_400_000);
}
