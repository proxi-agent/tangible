'use client';

import { useQuery } from '@tanstack/react-query';
import { FileText, MapPinOff } from 'lucide-react';
import Link from 'next/link';
import type { FilingSeason, SeasonReturn } from '@tangible/types';
import { api } from '@/lib/api';
import { count, money, moneyExact, plural } from '@/lib/format';
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
 * work them: what is stuck, then what can go out, then what has gone. The
 * deadline sits in the header rather than against each row, because it is the
 * same date for all of them and Tax Code 22.28 measures its penalty per return
 * against it.
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

  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data) return <Skeleton className="h-40 w-full" />;

  // Nothing placed and nothing filed is an engagement that has not reached
  // filing yet — the sites card is what it needs, not a board of no returns.
  if (season.data.returns.length === 0) return null;

  const draft = `/clients/${clientId}/engagements/${engagementId}/filing`;
  const { returns, unplacedCount, unplacedCost } = season.data;
  const outstanding = returns.filter((entry) => entry.status !== 'filed');

  return (
    <Card>
      <CardHeader
        title={heading(returns)}
        description={<Calendar season={season.data} outstanding={outstanding.length} />}
        action={
          <Link href={draft} className="text-xs font-medium hover:underline">
            The draft
          </Link>
        }
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {returns.map((entry) => (
          <ReturnRow key={entry.locationId} entry={entry} draft={draft} />
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
 * The deadline, and what it means today.
 *
 * Phrased against the returns still out rather than against the calendar. Once
 * everything has gone the date is history and saying "12 days left" over a
 * finished season would be noise dressed as urgency.
 */
function Calendar({ season, outstanding }: { season: FilingSeason; outstanding: number }) {
  const due = new Date(`${season.dueOn}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

  if (outstanding === 0) {
    return (
      <>
        Frozen as they went out. These figures do not move when the register does — which is the
        point, and what a 22.28 penalty would be measured against.
      </>
    );
  }

  return (
    <>
      Due {due} under Tax Code 22.23(a){season.daysToDue >= 0 ? `, ${count(season.daysToDue)} ${plural(season.daysToDue, 'day')} away` : ''}. A written request on or before that date moves the deadline
      to {new Date(`${season.extendedDueOn}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })} for
      every return here. A late one draws 10% of the taxes due on the property it covers (22.28), per
      return rather than per engagement.
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

function ReturnRow({ entry, draft }: { entry: SeasonReturn; draft: string }) {
  const site = `${draft}?site=${encodeURIComponent(entry.locationId)}`;

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
    </li>
  );
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
  return (
    <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">
      Sent {filing.filedOn}
      {filing.confirmation ? ` · ${filing.confirmation}` : ''}
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
