'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import type { OpenYear, OpenYears } from '@tangible/types';
import { api } from '@/lib/api';
import { moneyExact, plural } from '@/lib/format';
import { CorrectionRoutes } from '@/components/workspace/correction-routes';
import { MotionDraftSection } from '@/components/workspace/motion-draft';
import { Motions } from '@/components/workspace/correction-motions';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * The years behind this one, and whether any of them can still be fixed.
 *
 * Everything else on this page is about the season in front of the firm. This
 * is the back catalogue, and it is where an audit practice differs from a
 * protest practice: a new client arrives with five years of history, and the
 * question that decides the size of the engagement is how much of it 25.25 can
 * still reach.
 *
 * Ordered by what closes soonest, which puts the *oldest* open year at the top
 * — backwards from every other list here, and correct. 25.25(c) runs five years
 * from the year itself, so the 2021 row is the one with weeks left while the
 * 2025 row has years.
 *
 * Absent rather than empty when there is no history. A card that says "no prior
 * years on file" is a card somebody re-reads every week of a first engagement.
 */
export function OpenYearsCard({ clientId, engagementId }: { clientId: string; engagementId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement-open-years', engagementId],
    queryFn: () => api.openYears(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-24 w-full" />;
  if (data.open.length === 0 && data.closed.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Years still open" description={summary(data)} />
      <ul className="space-y-3 px-5 py-4">
        {data.open.map((year) => (
          <Year key={year.key} year={year} clientId={clientId} engagementId={engagementId} />
        ))}
      </ul>
      {data.closed.length > 0 ? (
        <Closed years={data.closed} clientId={clientId} engagementId={engagementId} />
      ) : null}
    </Card>
  );
}

/**
 * How many years, and how much of it we are actually sure about.
 *
 * The second sentence is the one that earns its place. A route computed from an
 * uploaded scan is computed without knowing whether the year was settled on the
 * phone, and under 1.111(e) that agreement closes two of the three routes — so
 * a count that quietly mixed the two kinds would be a number a partner could
 * repeat to a client and be wrong about.
 */
function summary(data: OpenYears): string {
  const total = data.open.length + data.closed.length;
  const open = data.open.length;
  const head =
    open === 0
      ? `25.25 has run out on all ${total} ${plural(total, 'year')} on file.`
      : `${open} of ${total} ${plural(total, 'year')} on file ${plural(open, 'has', 'have')} a route left under 25.25.`;
  // Only the years where the doubt actually bites. A scan cannot tell us the
  // year was settled on the phone — but 25.25(l) says a protest never spends
  // (c), so an uploaded year with only (c) left is as certain as one we ran,
  // and warning about it would be raising a doubt that does not apply.
  const unconfirmed = data.open.filter(
    (year) =>
      year.source === 'uploaded' && year.outlook.routes.some((r) => r.open && r.key !== 'c'),
  ).length;
  if (unconfirmed === 0) return head;
  return (
    `${head} ${unconfirmed} of them ${plural(unconfirmed, 'rests', 'rest')} on an uploaded notice ` +
    'and nothing else: the district has to confirm no protest was determined and no value agreed, ' +
    'because neither leaves a mark on the notice.'
  );
}

/**
 * One year, identified above the routes rather than inside them.
 *
 * The line carrying the year, the site and the value on the roll sits outside
 * the collapsible header on purpose: it holds a link back to the document the
 * routes are computed from, and a link nested inside a button is neither valid
 * markup nor clickable in a way anybody can predict.
 */
function Year({
  year,
  clientId,
  engagementId,
}: {
  year: OpenYear;
  clientId: string;
  engagementId: string;
}) {
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs">
        <span className="tabular font-semibold">{year.taxYear}</span>
        <span className="text-[var(--color-ink-secondary)]">{year.label}</span>
        {year.rolledValue !== null ? (
          <span className="tabular text-[11px] text-[var(--color-ink-muted)]">
            {moneyExact(year.rolledValue)} on the roll
          </span>
        ) : null}
        <Source year={year} clientId={clientId} engagementId={engagementId} />
      </div>
      <CorrectionRoutes outlook={year.outlook} heading="What 25.25 leaves" />
      {year.outlook.open ? <MotionDraftSection year={year} engagementId={engagementId} /> : null}
      <Motions year={year} engagementId={engagementId} />
    </li>
  );
}

/**
 * Where this row came from, as a link back to the paper.
 *
 * Not decoration: the routes below are only as good as the document above them,
 * and a partner about to file a motion under (c-1) should be one click from the
 * notice it is measured against.
 */
function Source({
  year,
  clientId,
  engagementId,
}: {
  year: OpenYear;
  clientId: string;
  engagementId: string;
}) {
  if (year.documentId !== null) {
    return (
      <Link
        href={`/clients/${clientId}/engagements/${engagementId}/priors/${year.documentId}`}
        className="ml-auto text-[11px] text-[var(--color-ink-muted)] underline underline-offset-2 hover:text-[var(--color-ink)]"
      >
        uploaded notice
      </Link>
    );
  }
  if (year.source === 'motion') {
    // No notice and no scan — the year is on the board because we filed on it.
    // Saying so matters: the routes below are computed without a document, and
    // the reader should know that before relying on the value beside them.
    return (
      <span className="ml-auto text-[11px] text-[var(--color-ink-muted)]">from a motion we filed</span>
    );
  }
  return <span className="ml-auto text-[11px] text-[var(--color-ink-muted)]">recorded here</span>;
}

/**
 * The years where the answer is no.
 *
 * Kept, and collapsed. "Nothing can be done about 2019" is a real answer to a
 * question a client asks, and a firm that has to re-derive it every time will
 * eventually derive it wrong.
 */
function Closed({
  years,
  clientId,
  engagementId,
}: {
  years: readonly OpenYear[];
  clientId: string;
  engagementId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-[var(--color-hairline)] px-5 py-3">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="flex w-full cursor-pointer items-baseline gap-2.5 text-left text-xs"
      >
        <Badge tone="neutral">closed</Badge>
        <span className="text-[var(--color-ink-secondary)]">
          {years.length} {plural(years.length, 'year')} 25.25 can no longer reach
        </span>
        <span className="ml-auto text-[11px] text-[var(--color-ink-muted)]">
          {open ? 'hide' : 'show'}
        </span>
      </button>
      {open ? (
        <ul className="mt-3 space-y-3">
          {years.map((year) => (
            <Year key={year.key} year={year} clientId={clientId} engagementId={engagementId} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
