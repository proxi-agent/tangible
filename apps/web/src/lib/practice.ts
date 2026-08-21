import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { statutoryDates } from '@tangible/filing';
import type { PracticeReturn, PracticeSeason, SeasonHold } from '@tangible/types';
import { filingSeason } from '@/lib/season';
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
  // The newest year with anything in it, where nobody asked for one. An empty
  // book still has to answer, and the statutory calendar is computable for any
  // year, so it answers about the current one.
  const year = taxYear ?? years[0] ?? new Date().getUTCFullYear();
  const chosen = rows.filter((row) => row.taxYear === year);

  const seasons = await Promise.all(
    chosen.map(async (row) => ({ row, season: await filingSeason(row.id) })),
  );

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
  };
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
    { key: string; message: string; resolution: string; sites: Map<string, number>; clients: Set<string> }
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

/** Whole days from today to an ISO date, in UTC on both sides. */
function daysUntil(iso: string): number {
  const today = new Date();
  const from = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - from) / 86_400_000);
}
