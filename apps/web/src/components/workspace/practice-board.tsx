'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Copy, Gavel, MapPinOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { appraisalDistrictName } from '@tangible/filing/districts';
import type { PracticeResult, PracticeReturn, PracticeSeason, SeasonHold } from '@tangible/types';
import { api } from '@/lib/api';
import { count, day, dayShort, money, moneyExact, plural } from '@/lib/format';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { InfoTip, Tooltip } from '@/components/ui/tooltip';

/**
 * The season across the whole book.
 *
 * Every screen before this one is inside a client. That is the right shape for
 * doing the work and the wrong shape for managing it: a firm filing the five to
 * a hundred returns this is built for has no way to see which return crosses a
 * deadline next, and no way at all to see that eleven of them are stuck behind
 * the same missing signature authority. Working a season by opening clients one
 * at a time is how a return gets missed in April.
 *
 * So the rows go flat — sorted by what is stuck and then by date, with the
 * client travelling on each row rather than grouping them. A season is worked
 * down a calendar, not down a client list.
 */
export function PracticeBoard() {
  const [year, setYear] = useState<number | null>(null);
  const season = useQuery({
    queryKey: ['practice-season', year],
    queryFn: () => api.practiceSeason(year ?? undefined),
  });

  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data) return <Skeleton className="h-64 w-full" />;

  const data = season.data;
  // By site, not by row. Where two engagements draft the same site and one of
  // them has filed, the other's draft is a duplicate of a finished return — it
  // stays on screen, because somebody has to see it and close it, but it is not
  // a return still out and nothing that counts what is left should say it is.
  const done = new Set(
    data.returns.filter((entry) => entry.status === 'filed').map((entry) => entry.locationId),
  );
  const outstanding = data.returns.filter((entry) => !done.has(entry.locationId));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title={heading(data)}
          description={<Calendar season={data} outstanding={outstanding} />}
          action={<YearPicker season={data} chosen={year ?? data.taxYear} onChoose={setYear} />}
        />
        {data.returns.length === 0 ? (
          <div className="px-5 pb-5">
            <EmptyState title={`No returns on the book for ${data.taxYear}`}>
              A return appears here once an engagement has property placed at a site. Until then
              there is nothing to file and nothing to be late with.
            </EmptyState>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-[var(--color-hairline)]">
              {data.returns.map((entry) => (
                <ReturnRow key={`${entry.engagementId}:${entry.locationId}`} entry={entry} />
              ))}
            </ul>
            <Footer season={data} />
          </>
        )}
      </Card>
      {data.holds.length > 0 ? <Holds holds={data.holds} /> : null}
      <Scoreboard result={data.result} taxYear={data.taxYear} />
    </div>
  );
}

/**
 * What the season has come to across the book — the billing question.
 *
 * The worklist above answers "what still has to go out"; this answers "what
 * did it all come to", per client, because that is the grain the firm bills
 * at. One row per client rather than per site: the site detail lives on the
 * engagement's own scoreboard, one click away through the client name.
 *
 * Absent until any site is past unfiled, for the same reason the engagement
 * card is: a scoreboard for a season that has not started is a to-do list
 * wearing the wrong clothes — and the worklist above already is the to-do
 * list.
 */
function Scoreboard({ result, taxYear }: { result: PracticeResult; taxYear: number }) {
  if (result.siteCount === 0) return null;
  const started = result.clients.some((client) => client.settledCount > 0 || client.noticedCount > 0 || client.standingCount > 0);
  if (!started && result.reductionCount === 0) return null;

  return (
    <Card>
      <CardHeader title={`What ${taxYear} has come to`} description={result.standing} />
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--color-hairline)] text-left text-[11px] text-[var(--color-ink-muted)]">
              <th className="px-5 py-2 font-medium">Client</th>
              <th className="px-3 py-2 text-right font-medium">
                <Tooltip content="Sites finished for the year — settled by agreement, order, or silence — over sites on the book.">
                  <span>Settled</span>
                </Tooltip>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <Tooltip content="Appraised value on the notices received, summed where a notice exists.">
                  <span>Noticed</span>
                </Tooltip>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                <Tooltip content="Where the value stands now — the settled figure, or the noticed one while nothing has moved it.">
                  <span>Standing</span>
                </Tooltip>
              </th>
              <th className="px-5 py-2 text-right font-medium">
                <Tooltip content="Noticed minus standing, summed only where both are known. Assessed value, not tax dollars.">
                  <span>Taken off</span>
                </Tooltip>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-hairline)]">
            {result.clients.map((client) => (
              <ClientRow key={client.clientId} client={client} />
            ))}
          </tbody>
          {result.clients.length > 1 ? <BookTotals result={result} /> : null}
        </table>
      </div>
    </Card>
  );
}

function ClientRow({ client }: { client: PracticeResult['clients'][number] }) {
  return (
    <tr>
      <td className="px-5 py-2.5">
        <Link
          href={`/clients/${client.clientId}/engagements/${client.engagementId}`}
          className="font-medium hover:underline"
        >
          {client.clientName}
        </Link>
      </td>
      <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-secondary)]">
        {client.settledCount} / {client.siteCount}
      </td>
      <td className="tabular px-3 py-2.5 text-right">
        <Sum value={client.noticedTotal} counted={client.noticedCount} of={client.siteCount} />
      </td>
      <td className="tabular px-3 py-2.5 text-right">
        <Sum value={client.standingTotal} counted={client.standingCount} of={client.siteCount} />
      </td>
      <td className="tabular px-5 py-2.5 text-right">
        <Taken value={client.reductionTotal} />
      </td>
    </tr>
  );
}

/**
 * A partial sum says so. $500,000 noticed over two of three sites presented
 * bare is a number a partner repeats to a client and then corrects.
 */
function Sum({ value, counted, of: siteCount }: { value: number | null; counted: number; of: number }) {
  if (value === null) return <span className="text-[var(--color-ink-muted)]">—</span>;
  const partial = counted < siteCount;
  return (
    <span>
      {moneyExact(value)}
      {partial ? (
        <span className="ml-1 text-[10px] text-[var(--color-ink-muted)]">
          ({counted} of {siteCount})
        </span>
      ) : null}
    </span>
  );
}

/**
 * The reduction, signed. A dash for none-yet and for exactly zero — the
 * settled count beside it says which of the two it is — and an increase shows
 * in critical rather than being clamped, because a season that raised a
 * client's value is a fact the firm needs on its own board, not just the
 * client's.
 */
function Taken({ value }: { value: number | null }) {
  if (value === null || value === 0) return <span className="text-[var(--color-ink-muted)]">—</span>;
  if (value > 0) return <span className="font-medium text-[var(--color-good)]">−{moneyExact(value)}</span>;
  return <span className="font-medium text-[var(--color-critical)]">+{moneyExact(Math.abs(value))}</span>;
}

function BookTotals({ result }: { result: PracticeResult }) {
  return (
    <tfoot>
      <tr className="border-t border-[var(--color-hairline)] text-[11px]">
        <td className="px-5 py-2.5 text-[var(--color-ink-muted)]">
          {result.clients.length} {plural(result.clients.length, 'client')}
        </td>
        <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-secondary)]">
          {result.settledCount} / {result.siteCount}
        </td>
        <td className="tabular px-3 py-2.5 text-right">
          <Sum
            value={result.noticedTotal}
            counted={result.clients.reduce((sum, client) => sum + client.noticedCount, 0)}
            of={result.siteCount}
          />
        </td>
        <td className="tabular px-3 py-2.5 text-right">
          <Sum
            value={result.standingTotal}
            counted={result.clients.reduce((sum, client) => sum + client.standingCount, 0)}
            of={result.siteCount}
          />
        </td>
        <td className="tabular px-5 py-2.5 text-right">
          <Taken value={result.reductionTotal} />
        </td>
      </tr>
    </tfoot>
  );
}

/**
 * Counted in returns owed, which is sites, not drafts on screen.
 *
 * 22.01 renders an account once for a year. Where two engagements have drafted
 * the same site, the rows below are right to show both — each is a real draft
 * somebody can open — and counting them as two returns owed would be wrong.
 */
function owed(season: PracticeSeason): { sites: number; left: number } {
  const filed = new Set<string>();
  const sites = new Set<string>();
  for (const entry of season.returns) {
    sites.add(entry.locationId);
    if (entry.status === 'filed') filed.add(entry.locationId);
  }
  return { sites: sites.size, left: sites.size - filed.size };
}

function heading(season: PracticeSeason): string {
  const { sites, left } = owed(season);
  if (sites === 0) return `Filing season ${season.taxYear}`;
  if (left === 0) return `${count(sites)} ${plural(sites, 'return')} filed for ${season.taxYear}`;
  if (left === sites) return `${count(sites)} ${plural(sites, 'return')} to file for ${season.taxYear}`;
  return `${count(left)} of ${count(sites)} returns still to file for ${season.taxYear}`;
}

/**
 * The year this board is about.
 *
 * Only offered where there is more than one, and only years with an engagement
 * on them. A dropdown that lets somebody pick a year the firm did no work in
 * answers a question nobody asked with an empty board.
 */
function YearPicker({
  season,
  chosen,
  onChoose,
}: {
  season: PracticeSeason;
  chosen: number;
  onChoose: (year: number) => void;
}) {
  if (season.years.length < 2) return null;
  return (
    <div className="flex items-center gap-1">
      {season.years.map((year) => (
        <button
          key={year}
          type="button"
          onClick={() => onChoose(year)}
          className={`tabular cursor-pointer rounded px-2 py-1 text-xs font-medium ${
            year === chosen
              ? 'bg-[var(--color-ink)] text-[var(--color-surface)]'
              : 'text-[var(--color-ink-secondary)] hover:underline'
          }`}
        >
          {year}
        </button>
      ))}
    </div>
  );
}

/**
 * The calendar, and what it means for the book rather than for one return.
 *
 * The statutory date is the same for everybody, so the fact worth carrying here
 * is how the book sits against it — and specifically how much of the book is
 * still out with the date close. One client's two returns is a morning; forty
 * returns with three weeks left is a staffing problem, and it is the same
 * sentence either way until the numbers go in it.
 */
function Calendar({
  season,
  outstanding,
}: {
  season: PracticeSeason;
  outstanding: PracticeReturn[];
}) {
  const clients = new Set(outstanding.map((entry) => entry.clientId)).size;
  const still = new Set(outstanding.map((entry) => entry.locationId)).size;
  if (season.returns.length === 0) {
    return (
      <>
        Rendition statements are due {day(season.dueOn)} under Tax Code 22.23(a), across{' '}
        {count(season.clientCount)} {plural(season.clientCount, 'client')} on the book.
      </>
    );
  }
  if (outstanding.length === 0) {
    return (
      <>
        Everything on the book has gone out. What is left of the season is the districts&rsquo; half
        — notices under 25.19 by May 1, and thirty days from delivery to disagree under 41.44.
      </>
    );
  }
  return (
    <>
      Due {day(season.dueOn)} under Tax Code 22.23(a)
      {season.daysToDue >= 0
        ? `, ${count(season.daysToDue)} ${plural(season.daysToDue, 'day')} away`
        : ', which has passed'}
      . {count(still)} {plural(still, 'return')} across {count(clients)}{' '}
      {plural(clients, 'client')} {plural(still, 'is', 'are')} still out.{' '}
      <InfoTip
        size={12}
        className="align-text-bottom"
        content="Each return carries its own date — 22.23(b) extensions are granted per account, so one client's May does not move the return next to it."
      />
      <Doubled season={season} />
    </>
  );
}

/**
 * Sites two engagements are both drafting a return for.
 *
 * Said here rather than left to the rows, because from a row it reads as a
 * duplicate on screen and it is not — both drafts are real, they sit under
 * different engagements, and each will happily produce a Form 50-144 for the
 * same account. 22.01 renders an account once for a year, so the second one
 * going out either supersedes the first or arrives as a contradiction the
 * district gets to resolve. Nothing below one engagement can see this.
 */
function Doubled({ season }: { season: PracticeSeason }) {
  const sites = new Set(
    season.returns.filter((entry) => entry.alsoOn > 0).map((entry) => entry.locationId),
  ).size;
  if (sites === 0) return null;
  return (
    <>
      {' '}
      <span className="text-[var(--color-warning)]">
        {count(sites)} {plural(sites, 'site')} {plural(sites, 'is', 'are')} drafted by more than one
        engagement this year.
      </span>{' '}
      <InfoTip
        size={12}
        className="align-text-bottom"
        content="Under 22.01 an account is rendered once — the rows below are the drafts, not the returns owed, and only one of each pair should go out."
      />
    </>
  );
}

/**
 * What is holding the most returns.
 *
 * The answer only this view can give, and the reason it is worth the cost of
 * building every rendition in the book. Inside an engagement a missing Form
 * 50-162 is one client&rsquo;s errand. Across the book, the same defect standing
 * against eleven returns is an afternoon that releases eleven returns — and no
 * client page can ever say so, because each one sees only its own.
 *
 * Ranked by returns held rather than by dollars. The dollars are here because
 * they are why it matters, but they do not predict how long the fix takes, and
 * the list is an order to work in.
 */
function Holds({ holds }: { holds: SeasonHold[] }) {
  const most = holds.reduce((sum, hold) => Math.max(sum, hold.returns), 0);
  return (
    <Card>
      <CardHeader
        title="What is holding the book up"
        // The leverage claim only where there is leverage. On a book where
        // every defect holds a single return this is just the blockers listed
        // in one place, which is worth having and is not worth a speech.
        description={
          most > 1 ? (
            <>
              The defect at the top is holding {count(most)} {plural(most, 'return')} — one fix
              releases all of them.
            </>
          ) : (
            'Every blocking defect on the board, gathered in one place.'
          )
        }
        help="Counted across returns rather than listed per client, because the leverage is invisible from inside any one engagement: the same missing signature can hold a dozen returns, and the count is what predicts the afternoon."
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {holds.map((hold) => (
          <li key={hold.key} className="px-5 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="tabular inline-flex items-center gap-1.5 text-sm font-medium">
                <AlertTriangle size={12} strokeWidth={2} className="text-[var(--color-critical)]" />
                {count(hold.returns)} {plural(hold.returns, 'return')}
              </span>
              <span className="text-xs text-[var(--color-ink-secondary)]">
                {hold.clients === 1
                  ? 'one client'
                  : `${count(hold.clients)} ${plural(hold.clients, 'client')}`}
              </span>
              <Tooltip
                className="ml-auto"
                title="Rendered cost behind it"
                content={`${moneyExact(hold.cost)} of property sits on the returns this is holding. Not a saving and not an exposure — it is the size of what cannot go out until this is fixed.`}
              >
                <span className="tabular text-xs text-[var(--color-ink-secondary)]">
                  {money(hold.cost)}
                </span>
              </Tooltip>
            </div>
            {/* One return's wording rather than a summary. The record gate's
                messages name sites and interpolate counts, so a defect standing
                against eleven returns has eleven true sentences and no general
                one — showing a real example is honest, and inventing a sentence
                the gate never says is not. */}
            <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
              {hold.message}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">
              {hold.resolution}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const TONE = { blocked: 'critical', ready: 'accent', filed: 'good' } as const;

function ReturnRow({ entry }: { entry: PracticeReturn }) {
  const draft = `/clients/${entry.clientId}/engagements/${entry.engagementId}/filing`;
  const href =
    entry.status === 'filed'
      ? `/filings/${entry.filing!.id}`
      : `${draft}?site=${encodeURIComponent(entry.locationId)}`;

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <Badge tone={TONE[entry.status]}>{entry.status}</Badge>
        {/* The client leads. Above one engagement the site label identifies
            nothing on its own — half the firms in Texas have a Main Office. */}
        <Link href={`/clients/${entry.clientId}`} className="font-medium hover:underline">
          {entry.clientName}
        </Link>
        <span className="text-xs text-[var(--color-ink-secondary)]">{entry.label}</span>
        <span className="text-xs text-[var(--color-ink-secondary)]">
          {entry.jurisdictionId === null ? (
            <span className="text-[var(--color-warning)]">no district</span>
          ) : (
            (appraisalDistrictName(entry.jurisdictionId) ?? entry.jurisdictionId)
          )}
        </span>
        {entry.status === 'filed' ? <Protest entry={entry} /> : <Due entry={entry} />}
        {entry.alsoOn > 0 ? (
          <Tooltip
            title="Also drafted elsewhere"
            content={`This site is on ${count(entry.alsoOn + 1)} engagements for ${entry.taxYear}, each drafting its own return for it. Tax Code 22.01 renders an account once a year, so only one of them should go out — and if one already has, the others are drafts of a return that is done.`}
          >
            {/* Short on purpose: the row is already carrying a client, a site,
                a district and a date, and the header sentence has said what a
                second draft means. Here it only has to be noticeable. */}
            <span className="inline-flex items-center gap-1 text-xs text-[var(--color-warning)]">
              <Copy size={11} strokeWidth={2} />
              {count(entry.alsoOn + 1)} drafts
            </span>
          </Tooltip>
        ) : null}
        <Tooltip
          className="ml-auto"
          title={entry.status === 'filed' ? 'What was filed' : 'What this would file'}
          content={
            entry.status === 'filed'
              ? `${moneyExact(entry.filing?.totalHistoricalCost)} across ${count(entry.filing?.assetCount)} ${plural(entry.filing?.assetCount ?? 0, 'asset')}, frozen the day it went out.`
              : `${moneyExact(entry.renderedCost)} on the schedules, out of ${moneyExact(entry.registerCost)} the register holds at this site.`
          }
        >
          <span className="tabular text-xs text-[var(--color-ink-secondary)]">
            {entry.status === 'filed'
              ? money(entry.filing!.totalHistoricalCost)
              : money(entry.renderedCost)}
          </span>
        </Tooltip>
        <Link href={href} className="text-xs font-medium hover:underline">
          {entry.status === 'filed' ? 'The form' : entry.status === 'blocked' ? 'Open it' : 'File it'}
        </Link>
      </div>
      <Detail entry={entry} />
    </li>
  );
}

/**
 * The line under a row: why it is stuck, or what the district has said.
 *
 * A blocked return names its first blocker in full. The count alone tells
 * nobody whether the thing to do is five minutes' typing or a call to the
 * client, and that distinction is what this page is for.
 */
function Detail({ entry }: { entry: PracticeReturn }) {
  if (entry.status === 'blocked') {
    const [first, ...rest] = entry.blockers;
    return (
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {first?.message}
        {rest.length > 0 ? ` Plus ${count(rest.length)} more on the draft.` : ''}
      </p>
    );
  }
  if (entry.status === 'ready') return null;

  const filing = entry.filing!;
  const late = filing.filedOn > entry.dueOn;
  if (!late) return null;
  return (
    <p className="mt-1 text-xs leading-relaxed text-[var(--color-critical)]">
      Sent {filing.filedOn}, after the {dayShort(entry.dueOn)} deadline — 22.28 puts 10% of the
      taxes on this property at risk.
    </p>
  );
}

/** The date one return is working to, coloured by how long is left. */
function Due({ entry }: { entry: PracticeReturn }) {
  const extended = entry.extension !== null;
  const colour =
    entry.daysToDue < 0
      ? 'text-[var(--color-critical)]'
      : entry.daysToDue <= 14
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-ink-secondary)]';
  return (
    <Tooltip
      title={extended ? 'Extended under 22.23(b)' : 'The statutory deadline'}
      content={
        extended
          ? entry.extension!.standing
          : `${day(entry.dueOn)} under Tax Code 22.23(a), with nothing on file that moves it.`
      }
    >
      <span className={`tabular inline-flex items-center gap-1 text-xs ${colour}`}>
        {extended ? <CalendarClock size={11} strokeWidth={2} /> : null}
        due {dayShort(entry.dueOn)} · {countdown(entry.daysToDue)}
      </span>
    </Tooltip>
  );
}

/**
 * Where a filed return stands with the district.
 *
 * Only the clock, and only the one that runs out first. The engagement board is
 * where a notice gets read and recorded; this row exists to stop a waiver
 * window closing in the background while nobody was looking at that client.
 */
function Protest({ entry }: { entry: PracticeReturn }) {
  if (entry.notice === null) return null;
  const { protest, resolution } = entry.notice;

  // A protest that ended has one clock left at most, and only after an ARB
  // order: 42.21(a)'s sixty days. Everything else is finished, and saying so is
  // the point — a row reading "protested" nine months later is a row nobody can
  // tell from one that is still out.
  if (resolution !== null) {
    const { standing } = resolution;
    if (standing.appealOpen && standing.appealDeadline) {
      const left = countdownDays(standing.appealDeadline);
      return (
        <Tooltip title="The order is appealable" content={standing.standing}>
          <span
            className={`tabular inline-flex items-center gap-1 text-xs ${
              left <= 14 ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-secondary)]'
            }`}
          >
            <Gavel size={11} strokeWidth={2} />
            appeal by {dayShort(standing.appealDeadline)} · {countdown(left)}
          </span>
        </Tooltip>
      );
    }
    const moved = standing.reduction;
    return (
      <Tooltip title="How it ended" content={standing.standing}>
        <span
          className={`inline-flex items-center gap-1 text-xs ${
            moved !== null && moved > 0
              ? 'text-[var(--color-good)]'
              : 'text-[var(--color-ink-muted)]'
          }`}
        >
          <Gavel size={11} strokeWidth={2} />
          {moved !== null && moved > 0
            ? `settled · ${money(moved)} off`
            : resolution.stage === 'withdrawn' || resolution.stage === 'dismissed'
              ? `${resolution.stage} · value stands`
              : 'settled · value stands'}
        </span>
      </Tooltip>
    );
  }

  if (entry.notice.protestFiledOn !== null) {
    return (
      <Tooltip title="Out with the district" content={protest.standing}>
        <span className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)]">
          <Gavel size={11} strokeWidth={2} />
          protested {dayShort(entry.notice.protestFiledOn)}
        </span>
      </Tooltip>
    );
  }
  // The waiver has no May 15 floor under 22.30(b), so it usually closes weeks
  // before the protest window. Counting down to the later date while the
  // penalty quietly becomes permanent is the failure this is here to prevent.
  const soonest =
    protest.waiverDeadline && protest.waiverDeadline < protest.deadline
      ? { date: protest.waiverDeadline, what: 'waiver' as const }
      : { date: protest.deadline, what: 'protest' as const };
  const left = countdownDays(soonest.date);
  const colour = !protest.open
    ? 'text-[var(--color-ink-muted)]'
    : left <= 14
      ? 'text-[var(--color-warning)]'
      : 'text-[var(--color-ink-secondary)]';
  return (
    <Tooltip title={protest.open ? 'The window' : 'The window has closed'} content={protest.standing}>
      <span className={`tabular inline-flex items-center gap-1 text-xs ${colour}`}>
        <Gavel size={11} strokeWidth={2} />
        {soonest.what === 'waiver' ? 'waiver by ' : 'protest by '}
        {dayShort(soonest.date)}
        {protest.open ? ` · ${countdown(left)}` : ' · closed'}
      </span>
    </Tooltip>
  );
}

/**
 * The totals, and the property that is on no return at all.
 *
 * Unplaced property is the one number here that is not about a deadline. It is
 * held property whose site is unresolved, so it appears on nothing — a return
 * that is not late because it does not exist, which is the quietest way for
 * this to go wrong.
 */
function Footer({ season }: { season: PracticeSeason }) {
  // By site rather than by row, on the same rule the heading counts by. A site
  // two engagements are both drafting holds its property once however many
  // drafts exist, and a site already filed by one of them has nothing left to go
  // out — the sibling draft is a duplicate of a finished return, not work.
  const filed = new Set(
    season.returns.filter((entry) => entry.status === 'filed').map((entry) => entry.locationId),
  );
  const bySite = new Map<string, number>();
  for (const entry of season.returns) {
    if (filed.has(entry.locationId)) continue;
    bySite.set(entry.locationId, Math.max(bySite.get(entry.locationId) ?? 0, entry.renderedCost));
  }
  const cost = [...bySite.values()].reduce((sum, one) => sum + one, 0);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--color-hairline)] px-5 py-3 text-xs text-[var(--color-ink-secondary)]">
      <span className="tabular">
        {count(season.engagementCount)} {plural(season.engagementCount, 'engagement')} ·{' '}
        {count(season.clientCount)} {plural(season.clientCount, 'client')}
      </span>
      {bySite.size > 0 ? <span className="tabular">{money(cost)} still to go out</span> : null}
      {season.unplacedCount > 0 ? (
        <Tooltip
          className="ml-auto"
          title="On no return"
          content={`${moneyExact(season.unplacedCost)} of held property across the book sits at a site nothing resolves, so it is on no rendition. Placing it is what puts it on one.`}
        >
          <span className="tabular inline-flex items-center gap-1 text-[var(--color-warning)]">
            <MapPinOff size={11} strokeWidth={2} />
            {count(season.unplacedCount)} {plural(season.unplacedCount, 'asset')} on no return ·{' '}
            {money(season.unplacedCost)}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

function countdown(days: number): string {
  if (days === 0) return 'today';
  if (days > 0) return `${count(days)} ${plural(days, 'day')} left`;
  return `${count(-days)} ${plural(-days, 'day')} overdue`;
}

/** Whole days from today to an ISO date, UTC on both sides. */
function countdownDays(iso: string): number {
  const now = new Date();
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - from) / 86_400_000);
}
