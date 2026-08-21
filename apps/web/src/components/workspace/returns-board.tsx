'use client';

import { useQuery } from '@tanstack/react-query';
import { CalendarClock, FileText, MapPinOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { appraisalDistrictName } from '@tangible/filing/districts';
import type { FilingSeason, RenditionExtension, SeasonReturn } from '@tangible/types';
import { api } from '@/lib/api';
import { count, day, dayShort, money, moneyExact, plural } from '@/lib/format';
import { ExtensionPanel } from '@/components/workspace/extension-panel';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The season: every return this engagement owes, and where each one stands.
 *
 * The screens either side of this one are about a document. The draft is one
 * form, the filing record is one return that went out, and between them there
 * was nowhere that answered "what is left". An engagement with two sites owes
 * two renditions and the engagement page used to say "1 return filed" — true,
 * and the wrong half of the fact.
 *
 * So the rows here are every return, filed or not, in the order somebody would
 * work them: what is stuck, then what can go out, then what has gone.
 *
 * Each row carries its own deadline. The header's April date is the statutory
 * one and every row starts there, but an extension under Tax Code 22.23(b) is
 * granted per account — one site's request buys that site until May and says
 * nothing about the one next door. Printing the April date against an extended
 * row would be wrong in the direction that makes people file early for nothing;
 * printing May against an unextended one is how a 22.28 penalty happens.
 */
export function ReturnsBoard({
  clientId,
  engagementId,
}: {
  clientId: string;
  engagementId: string;
}) {
  const season = useQuery({
    queryKey: ['engagement-season', engagementId],
    queryFn: () => api.season(engagementId),
  });
  // Its own query rather than a field on the season, because the season carries
  // the extension that *stands* and this needs the ones that do not: a refused
  // request and an outstanding one both move nothing, and both are exactly what
  // somebody opening this panel is looking for.
  const extensions = useQuery({
    queryKey: ['engagement-extensions', engagementId],
    queryFn: () => api.extensions(engagementId),
  });

  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data) return <Skeleton className="h-40 w-full" />;

  // Nothing placed and nothing filed is an engagement that has not reached
  // filing yet — the sites card is what it needs, not a board of no returns.
  if (season.data.returns.length === 0) return null;

  const draft = `/clients/${clientId}/engagements/${engagementId}/filing`;
  const { returns, taxYear, unplacedCount, unplacedCost } = season.data;
  const outstanding = returns.filter((entry) => entry.status !== 'filed');

  // Grouped by site, this year only. An extension recorded against last year's
  // return is history the moment the engagement rolls over, and showing it
  // beside a live deadline would read as one that still stands.
  const bySite = new Map<string, RenditionExtension[]>();
  for (const extension of extensions.data ?? []) {
    if (extension.taxYear !== taxYear) continue;
    const bucket = bySite.get(extension.locationId);
    if (bucket) bucket.push(extension);
    else bySite.set(extension.locationId, [extension]);
  }

  return (
    <Card>
      <CardHeader
        title={heading(returns)}
        description={<Calendar season={season.data} outstanding={outstanding} />}
        action={
          <Link href={draft} className="text-xs font-medium hover:underline">
            The draft
          </Link>
        }
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {returns.map((entry) => (
          <ReturnRow
            key={entry.locationId}
            entry={entry}
            draft={draft}
            engagementId={engagementId}
            season={season.data}
            extensions={bySite.get(entry.locationId) ?? []}
          />
        ))}
        {unplacedCount > 0 ? <Unplaced n={unplacedCount} cost={unplacedCost} /> : null}
      </ul>
      {returns.length > 1 ? <Footer returns={returns} /> : null}
    </Card>
  );
}

function heading(returns: SeasonReturn[]): string {
  const left = returns.filter((entry) => entry.status !== 'filed').length;
  const n = returns.length;
  if (left === 0) return `${count(n)} ${plural(n, 'return')} filed`;
  if (left === n) return `${count(n)} ${plural(n, 'return')} to file`;
  return `${count(left)} of ${count(n)} returns still to file`;
}

/**
 * Which district this return goes to.
 *
 * Shown on every row rather than only where two of them disagree, because a
 * reader cannot tell a checked answer from an unchecked one — and the case
 * worth catching is a site that never named a district and quietly took the
 * engagement's. Where the id is one we do not recognise there is no form to
 * print for it, so the raw slug is the honest thing to show rather than a
 * district name we invented.
 */
function District({ jurisdictionId }: { jurisdictionId: string | null }) {
  if (jurisdictionId === null) {
    return <span className="text-xs text-[var(--color-warning)]">no district</span>;
  }
  return (
    <span className="text-xs text-[var(--color-ink-secondary)]">
      {appraisalDistrictName(jurisdictionId) ?? jurisdictionId}
    </span>
  );
}

/**
 * The statutory calendar, and what it means today.
 *
 * Phrased against the returns still out rather than against the calendar. Once
 * everything has gone the date is history and saying "12 days left" over a
 * finished season would be noise dressed as urgency.
 *
 * What this does *not* say any more is that a request moves "every return
 * here". It moves one, and the rows below say which.
 */
function Calendar({ season, outstanding }: { season: FilingSeason; outstanding: SeasonReturn[] }) {
  if (outstanding.length === 0) {
    return (
      <>
        Frozen as they went out. These figures do not move when the register does — which is the
        point, and what a 22.28 penalty would be measured against.
      </>
    );
  }

  const extended = outstanding.filter((entry) => entry.extension !== null).length;

  return (
    <>
      Due {day(season.dueOn)} under Tax Code 22.23(a)
      {season.daysToDue >= 0
        ? `, ${count(season.daysToDue)} ${plural(season.daysToDue, 'day')} away`
        : ''}
      . A written request on or before that date moves one return to{' '}
      {dayShort(season.extendedDueOn)} under 22.23(b) — per account rather than per engagement, so
      each row works to its own date.
      {extended > 0
        ? ` ${count(extended)} of the ones still out ${plural(extended, 'is', 'are')} on an extension.`
        : ''}{' '}
      A late return draws 10% of the taxes due on the property it covers (22.28), per return rather
      than per engagement.
    </>
  );
}

const TONE = {
  blocked: 'critical',
  ready: 'accent',
  filed: 'good',
} as const;

const STATUS_LABEL = {
  blocked: 'blocked',
  ready: 'ready',
  filed: 'filed',
} as const;

function ReturnRow({
  entry,
  draft,
  engagementId,
  season,
  extensions,
}: {
  entry: SeasonReturn;
  draft: string;
  engagementId: string;
  season: FilingSeason;
  extensions: RenditionExtension[];
}) {
  const site = `${draft}?site=${encodeURIComponent(entry.locationId)}`;
  const [open, setOpen] = useState(false);

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <Badge tone={TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
        <span className="font-medium">{entry.label}</span>
        <span className="text-xs text-[var(--color-ink-secondary)]">
          {entry.accountId ? (
            `account ${entry.accountId}`
          ) : (
            <span className="text-[var(--color-warning)]">no account number</span>
          )}
        </span>
        <District jurisdictionId={entry.jurisdictionId} />
        {entry.status === 'filed' ? null : <Due entry={entry} statutory={season.dueOn} />}
        {/* `ml-auto` belongs on the tooltip rather than the span inside it: the
            wrapper is the flex item, and a margin on the child pushes nothing. */}
        <Tooltip
          className="ml-auto"
          title={entry.status === 'filed' ? 'What was filed' : 'What this would file'}
          content={
            entry.status === 'filed'
              ? `${moneyExact(entry.filing?.totalHistoricalCost)} across ${count(entry.filing?.assetCount)} ${plural(entry.filing?.assetCount ?? 0, 'asset')}, frozen the day it went out. The register at this site now holds ${moneyExact(entry.registerCost)}.`
              : `${moneyExact(entry.renderedCost)} on the schedules, out of ${moneyExact(entry.registerCost)} the register holds here. The difference is property the rendition sets aside — disposed before January 1, intangible, or removed by an accepted finding.`
          }
        >
          {/* A filed row reports the return, not the register: those are the
              same numbers only until the register moves, and the row exists to
              say what went out. The unfiled ones report what would go out. */}
          <span className="tabular text-xs text-[var(--color-ink-secondary)]">
            {entry.status === 'filed'
              ? `${count(entry.filing!.assetCount)} ${plural(entry.filing!.assetCount, 'asset')} · ${money(entry.filing!.totalHistoricalCost)}`
              : `${count(entry.assetCount)} ${plural(entry.assetCount, 'asset')} · ${money(entry.renderedCost)}`}
          </span>
        </Tooltip>
        {entry.status === 'filed' ? (
          <Link href={`/filings/${entry.filing!.id}`} className="text-xs font-medium hover:underline">
            The form as filed
          </Link>
        ) : (
          <Link href={site} className="inline-flex items-center gap-1 text-xs font-medium hover:underline">
            <FileText size={12} strokeWidth={2} />
            {entry.status === 'blocked' ? 'Open it' : 'File it'}
          </Link>
        )}
      </div>
      <Detail entry={entry} />
      {/* Offered on a filed row only where something is already on file. The
          request that carried a return past April is part of its story; a form
          for asking is not, once the thing has gone out. */}
      {entry.status !== 'filed' || extensions.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          className="mt-1.5 cursor-pointer text-xs font-medium text-[var(--color-ink-secondary)] hover:underline"
        >
          {open
            ? 'Hide the extension record'
            : extensions.length > 0
              ? `The extension record · ${count(extensions.length)} on file`
              : 'Ask for an extension'}
        </button>
      ) : null}
      {open ? (
        <ExtensionPanel
          engagementId={engagementId}
          locationId={entry.locationId}
          label={entry.label}
          statutoryDueOn={season.dueOn}
          extendedDueOn={season.extendedDueOn}
          extensions={extensions}
        />
      ) : null}
    </li>
  );
}

/**
 * The date this one return is working to.
 *
 * Coloured off how long is left rather than off the status, because a blocked
 * return three weeks out and a blocked return two days out are the same row
 * with completely different amounts of trouble in them. An extended row says so
 * on its face: the date alone would look like an app that had lost track of
 * April.
 */
function Due({ entry, statutory }: { entry: SeasonReturn; statutory: string }) {
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
          : `${day(statutory)} under Tax Code 22.23(a), with nothing on file that moves it. A written request reaching the chief appraiser on or before that day would — he has no discretion to refuse one.`
      }
    >
      <span className={`tabular inline-flex items-center gap-1 text-xs ${colour}`}>
        {extended ? <CalendarClock size={11} strokeWidth={2} /> : null}
        due {dayShort(entry.dueOn)} · {countdown(entry.daysToDue)}
      </span>
    </Tooltip>
  );
}

function countdown(days: number): string {
  if (days === 0) return 'today';
  if (days > 0) return `${count(days)} ${plural(days, 'day')} left`;
  return `${count(-days)} ${plural(-days, 'day')} overdue`;
}

/**
 * The line under a row: why it is stuck, or what has happened since it went out.
 *
 * A blocked return names its first blocker in full rather than a count. The
 * count is what the draft screen already shows and it tells nobody whether the
 * thing to do is five minutes' typing or a call to the client.
 */
function Detail({ entry }: { entry: SeasonReturn }) {
  if (entry.status === 'blocked') {
    const rest = entry.blockers.length - 1;
    return (
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {entry.blockers[0]}
        {rest > 0 ? ` Plus ${count(rest)} more on the draft.` : ''}
      </p>
    );
  }

  if (entry.status === 'ready') {
    return (
      <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">
        Nothing is holding this up.
        {entry.warnings > 0
          ? ` ${count(entry.warnings)} ${plural(entry.warnings, 'thing')} on the draft ${plural(entry.warnings, 'is', 'are')} worth reading before you sign it.`
          : ''}
      </p>
    );
  }

  const filing = entry.filing!;
  const drift = entry.driftedBy ?? 0;
  // Against the deadline this return was actually working to, extension and
  // all. Both halves are worth saying: a return that beat an extension it had
  // to ask for is the reason somebody asked, and one that missed its date is a
  // 22.28 exposure nobody should have to work out from two dates on a screen.
  const late = filing.filedOn > entry.dueOn;

  return (
    <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
      Sent {filing.filedOn}
      {filing.confirmation ? ` · ${filing.confirmation}` : ''}
      {late ? (
        <>
          {' · '}
          <span className="text-[var(--color-critical)]">
            after the {dayShort(entry.dueOn)} deadline — 22.28 puts 10% of the taxes on this
            property at risk
          </span>
        </>
      ) : entry.extension !== null ? (
        <>
          {' · '}
          <span className="text-[var(--color-ink-muted)]">
            inside the extension to {dayShort(entry.dueOn)}
          </span>
        </>
      ) : null}
      {drift !== 0 ? (
        <>
          {' · '}
          <span className="text-[var(--color-warning)]">
            the register has moved {money(Math.abs(drift))} {drift > 0 ? 'up' : 'down'} since
          </span>
        </>
      ) : null}
    </p>
  );
}

/**
 * Property on no return at all.
 *
 * Its own row rather than folded into a site, because which site it belongs to
 * is exactly what nobody knows — and under-rendering is what 22.28 penalises,
 * whichever site it turns out to sit at.
 */
function Unplaced({ n, cost }: { n: number; cost: number }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 bg-[var(--color-plane)] px-5 py-3 text-sm">
      <MapPinOff size={13} strokeWidth={2} className="text-[var(--color-warning)]" />
      <span className="font-medium">On no return</span>
      <span className="text-xs text-[var(--color-ink-secondary)]">
        {count(n)} held {plural(n, 'asset')} at no resolved site. Place them so each lands on the
        return for the site it sits at.
      </span>
      <span className="tabular ml-auto text-xs">{money(cost)}</span>
    </li>
  );
}

/** What the season adds up to, once there is more than one return in it. */
function Footer({ returns }: { returns: SeasonReturn[] }) {
  const filed = returns
    .filter((entry) => entry.status === 'filed')
    .reduce((sum, entry) => sum + (entry.filing?.totalHistoricalCost ?? 0), 0);
  const outstanding = returns
    .filter((entry) => entry.status !== 'filed')
    .reduce((sum, entry) => sum + entry.renderedCost, 0);

  return (
    <div className="flex flex-wrap items-baseline gap-x-6 border-t border-[var(--color-hairline)] px-5 py-3 text-sm">
      <span className="font-semibold">Across every site</span>
      <span className="tabular ml-auto text-xs text-[var(--color-ink-secondary)]">
        {moneyExact(filed)} rendered
        {outstanding > 0 ? ` · ${moneyExact(outstanding)} still to go out` : ''}
      </span>
    </div>
  );
}
