import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { statutoryDates } from '@tangible/filing';
import type {
  PracticeClientResult,
  PracticeResult,
  PracticeReturn,
  PracticeSeason,
  SeasonHold,
  SiteOutcome,
} from '@tangible/types';
import { OUTCOME_PHASES } from '@tangible/types';
import { clientMotions } from '@/lib/motions';
import { jurisdictionRates, seasonOutcomes } from '@/lib/result';
import { filingSeason } from '@/lib/season';
import { currentYear, daysUntil } from '@/lib/today';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The season across every client, for one tax year.
 *
 * Everything before this answers about one engagement, and a firm does not have
 * one engagement. The two questions a season actually raises — what crosses a
 * deadline next, and what is holding the rest up — are both about the whole
 * book, and neither can be asked from inside a client page. Working a season by
 * opening clients one at a time is how a return gets missed.
 *
 * The cost, stated rather than hidden: this builds one rendition per return
 * across the whole book, because `filingSeason` does and reusing it is the only
 * way "ready" means the same thing here as it does on the engagement board and
 * at the record gate. Three definitions that agree today would not agree in a
 * month. It is database work rather than model work — no classifier runs — and
 * the returns are built in parallel, but a book of a hundred returns is a
 * hundred renditions and this page will feel it. The fix when it matters is a
 * cached season per engagement, invalidated on the things that change one, not
 * a second cheaper definition of ready.
 */
export async function practiceSeason(taxYear?: number): Promise<PracticeSeason> {
  const db = requireDb();
  const rows = await db
    .select({
      id: schema.engagements.id,
      taxYear: schema.engagements.taxYear,
      clientId: schema.clients.id,
      clientName: schema.clients.name,
    })
    .from(schema.engagements)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.engagements.clientId))
    .orderBy(desc(schema.engagements.taxYear));

  const years = [...new Set(rows.map((row) => row.taxYear))].sort((a, b) => b - a);
  // Where nobody asked for a year: the newest one with returns on it, not just
  // the newest one opened. An engagement rolled forward before any property is
  // placed makes the newest year an empty board, and a season view that greets
  // the firm with "nothing here" while live work sits one year back is a view
  // that teaches people to stop trusting the default. Probing an empty year is
  // cheap — zero engagements with returns means zero renditions built — and the
  // seasons already built for the fallback year are reused, not rebuilt.
  let year = taxYear ?? years[0] ?? currentYear();
  let chosen = rows.filter((row) => row.taxYear === year);
  let seasons = await Promise.all(
    chosen.map(async (row) => ({ row, season: await filingSeason(row.id) })),
  );

  if (taxYear === undefined) {
    for (const candidate of years) {
      const candidateRows = rows.filter((row) => row.taxYear === candidate);
      const built =
        candidate === year
          ? seasons
          : await Promise.all(
              candidateRows.map(async (row) => ({ row, season: await filingSeason(row.id) })),
            );
      if (built.some(({ season }) => season.returns.length > 0)) {
        year = candidate;
        chosen = candidateRows;
        seasons = built;
        break;
      }
    }
    // No year has a return anywhere — a brand-new book. years[0] (or the
    // current year) already stands from the initialization above.
  }

  const flat = seasons.flatMap(({ row, season }) =>
    season.returns.map((entry) => ({
      ...entry,
      clientId: row.clientId,
      clientName: row.clientName,
      engagementId: row.id,
      taxYear: season.taxYear,
      alsoOn: 0,
    })),
  );

  // A site rendered by more than one engagement this year. Sites belong to the
  // client rather than to an engagement, so a second engagement opened mid-season
  // picks up every site the first one has, and both then draft a return for each.
  // Counted here rather than in the component because the heading is built on the
  // same fact: what is owed is one return per account, not one per draft.
  const perSite = new Map<string, number>();
  for (const entry of flat) perSite.set(entry.locationId, (perSite.get(entry.locationId) ?? 0) + 1);
  const returns: PracticeReturn[] = flat.map((entry) => ({
    ...entry,
    alsoOn: (perSite.get(entry.locationId) ?? 1) - 1,
  }));

  const statutory = statutoryDates(year);
  return {
    taxYear: year,
    dueOn: statutory.dueOn,
    extendedDueOn: statutory.extendedDueOn,
    daysToDue: daysUntil(statutory.dueOn),
    years,
    clientCount: new Set(chosen.map((row) => row.clientId)).size,
    engagementCount: chosen.length,
    returns: returns.sort(byWhatNeedsDoing),
    holds: holdsAcross(returns),
    unplacedCount: seasons.reduce((sum, { season }) => sum + season.unplacedCount, 0),
    unplacedCost: seasons.reduce((sum, { season }) => sum + season.unplacedCost, 0),
    result: await resultAcross(year, seasons),
  };
}

/**
 * What the season has come to across the book — the scoreboard half of this
 * page, computed from the same seasons the worklist above was.
 *
 * From the same seasons on purpose: `filingSeason` is the expensive part of
 * this whole view, and a scoreboard that rebuilt its own would be a second
 * bill for the same answer, with a chance of a different one. Motions are the
 * only extra read, once per distinct client, because a corrected roll reported
 * at its uncorrected number is exactly the mistake 25.25 exists to fix.
 *
 * The duplicate-engagement trap bites here harder than on the worklist. Two
 * engagements on one client and year draft the same sites; the worklist merely
 * shows the duplicate ("also on"), but summing both here would count one
 * site's reduction twice — a firm reporting doubled savings to itself. So the
 * grain is (client, site): of the duplicate rows we keep the one that has
 * travelled furthest through the season, and on a tie the one with a filing.
 */
async function resultAcross(
  taxYear: number,
  seasons: {
    row: { id: string; clientId: string; clientName: string };
    season: Awaited<ReturnType<typeof filingSeason>>;
  }[],
): Promise<PracticeResult> {
  const clientIds = [...new Set(seasons.map(({ row }) => row.clientId))];
  const rates = await jurisdictionRates();
  const motionsByClient = new Map(
    await Promise.all(
      clientIds.map(async (clientId) => [clientId, await clientMotions(clientId)] as const),
    ),
  );

  // Every outcome row, still with duplicates across engagements.
  const rows = seasons.flatMap(({ row, season }) =>
    seasonOutcomes(taxYear, season.returns, motionsByClient.get(row.clientId) ?? [], rates).map(
      (outcome) => ({ row, outcome }),
    ),
  );

  // Dedupe per (client, site), keeping the furthest-travelled row. Phase order
  // is the sequence itself, so its index is the rank; a filing breaks ties
  // because between two drafts of one site, the one that went out the door is
  // the one the season's numbers hang off.
  const kept = new Map<
    string,
    { row: { id: string; clientId: string; clientName: string }; outcome: SiteOutcome }
  >();
  for (const entry of rows) {
    const key = `${entry.row.clientId}:${entry.outcome.locationId}`;
    const standing = kept.get(key);
    if (!standing || further(entry.outcome, standing.outcome)) kept.set(key, entry);
  }

  const byClient = new Map<string, { name: string; engagementId: string; sites: SiteOutcome[] }>();
  for (const { row, outcome } of kept.values()) {
    let client = byClient.get(row.clientId);
    if (!client) {
      client = { name: row.clientName, engagementId: row.id, sites: [] };
      byClient.set(row.clientId, client);
    }
    client.sites.push(outcome);
  }

  const clients: PracticeClientResult[] = [...byClient.entries()]
    .map(([clientId, client]) => ({
      clientId,
      clientName: client.name,
      engagementId: client.engagementId,
      siteCount: client.sites.length,
      settledCount: client.sites.filter((site) => site.final).length,
      noticedTotal: total(client.sites, (site) => site.noticedValue),
      noticedCount: client.sites.filter((site) => site.noticedValue !== null).length,
      standingTotal: total(client.sites, (site) => site.standingValue),
      standingCount: client.sites.filter((site) => site.standingValue !== null).length,
      reductionTotal: total(client.sites, (site) => site.reduction),
      reductionCount: client.sites.filter((site) => site.reduction !== null).length,
    }))
    // Largest reduction first — the scoreboard reads best from the wins down —
    // then by name so clients without numbers yet still land somewhere stable.
    .sort(
      (a, b) =>
        (b.reductionTotal ?? 0) - (a.reductionTotal ?? 0) ||
        a.clientName.localeCompare(b.clientName),
    );

  const sites = [...kept.values()].map((entry) => entry.outcome);
  const settled = sites.filter((site) => site.final).length;
  return {
    clients,
    siteCount: sites.length,
    settledCount: settled,
    noticedTotal: total(sites, (site) => site.noticedValue),
    standingTotal: total(sites, (site) => site.standingValue),
    reductionTotal: total(sites, (site) => site.reduction),
    reductionCount: sites.filter((site) => site.reduction !== null).length,
    standing: bookHeadline(taxYear, sites, settled),
  };
}

/** Whether `a` has travelled further through the season than `b`. */
function further(a: SiteOutcome, b: SiteOutcome): boolean {
  const rank = (site: SiteOutcome) => OUTCOME_PHASES.indexOf(site.phase);
  if (rank(a) !== rank(b)) return rank(a) > rank(b);
  return a.filedOn !== null && b.filedOn === null;
}

/** Sum over the rows where the figure exists; null when none carry it. */
function total(sites: SiteOutcome[], pick: (site: SiteOutcome) => number | null): number | null {
  const rows = sites.filter((site) => pick(site) !== null);
  if (rows.length === 0) return null;
  return rows.reduce((sum, site) => sum + (pick(site) as number), 0);
}

/**
 * The book's season in a sentence — same rules as the engagement's headline:
 * the reduction is appraised value off the roll, never tax dollars, and it is
 * only claimed where both sides of the difference are known.
 */
function bookHeadline(taxYear: number, sites: SiteOutcome[], settled: number): string {
  if (sites.length === 0) return `Nothing has gone out for ${taxYear} yet.`;
  const saved = sites
    .filter((site) => (site.reduction ?? 0) > 0)
    .reduce((sum, site) => sum + (site.reduction as number), 0);
  const head =
    settled === sites.length
      ? `${taxYear} is finished across the book.`
      : `${settled} of ${sites.length} sites across the book ${settled === 1 ? 'has' : 'have'} finished ${taxYear}.`;
  if (saved <= 0) return head;
  return (
    `${head} The season has taken $${Math.round(saved).toLocaleString('en-US')} of appraised ` +
    `value off clients' rolls so far — assessed value, not tax dollars.`
  );
}

/**
 * Every blocking defect, ranked by how many returns it is holding.
 *
 * The answer only this view can give. Inside an engagement a missing Form
 * 50-162 is one client's errand; across the book the same key standing against
 * fourteen returns is an afternoon that releases fourteen returns, and the
 * ranking is what turns a list of problems into an order to work in.
 *
 * Ranked by returns rather than by dollars. The dollars are reported alongside
 * because they are the reason to care, but a defect holding twelve small
 * returns and one holding a single large one are different kinds of afternoon,
 * and the count is the one that predicts how long it takes.
 */
function holdsAcross(returns: PracticeReturn[]): SeasonHold[] {
  // A site somebody has already filed for. Its draft on a second engagement is
  // a duplicate of a finished return, and whatever is blocking that draft is
  // holding nothing — counting it would put a defect at the top of this list
  // that releases no work at all.
  const done = new Set(
    returns.filter((entry) => entry.status === 'filed').map((entry) => entry.locationId),
  );

  // Counted in sites, not rows, for the same reason the heading is. Fixing one
  // defect releases the returns owed behind it, and two drafts of one site are
  // one return. Cost is carried per site too, taking the larger draft rather
  // than the sum, which would invent property that does not exist.
  const held = new Map<
    string,
    {
      key: string;
      message: string;
      resolution: string;
      sites: Map<string, number>;
      clients: Set<string>;
    }
  >();
  for (const entry of returns) {
    if (done.has(entry.locationId)) continue;
    for (const blocker of entry.blockers) {
      let hold = held.get(blocker.key);
      if (!hold) {
        hold = {
          key: blocker.key,
          message: blocker.message,
          resolution: blocker.resolution,
          sites: new Map(),
          clients: new Set(),
        };
        held.set(blocker.key, hold);
      }
      hold.sites.set(
        entry.locationId,
        Math.max(hold.sites.get(entry.locationId) ?? 0, entry.renderedCost),
      );
      hold.clients.add(entry.clientId);
    }
  }

  return [...held.values()]
    .map((hold) => ({
      key: hold.key,
      message: hold.message,
      resolution: hold.resolution,
      returns: hold.sites.size,
      clients: hold.clients.size,
      cost: [...hold.sites.values()].reduce((sum, one) => sum + one, 0),
    }))
    .sort((a, b) => b.returns - a.returns || b.cost - a.cost || a.key.localeCompare(b.key));
}

/**
 * Worklist order across the book: what is stuck, then when it is due.
 *
 * The engagement board sorts by size inside each status because an engagement
 * is a handful of rows read at once. A book is not read at once — it is worked
 * down — and across clients the date is what varies, so the date comes before
 * the money here.
 */
const RANK: Record<PracticeReturn['status'], number> = { blocked: 0, ready: 1, filed: 2 };

function byWhatNeedsDoing(a: PracticeReturn, b: PracticeReturn): number {
  return (
    RANK[a.status] - RANK[b.status] ||
    a.dueOn.localeCompare(b.dueOn) ||
    b.renderedCost - a.renderedCost ||
    a.clientName.localeCompare(b.clientName) ||
    a.label.localeCompare(b.label)
  );
}
