'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useState } from 'react';
import type { EngineChange, EngineDigestView } from '@tangible/types';
import { api } from '@/lib/api';
import { count, day, plural } from '@/lib/format';
import { Segmented } from '@/components/ui/controls';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  ErrorState,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * What the engine learned, and when it started using it.
 *
 * Every other card on this page answers "what does the engine believe now".
 * None of them answers "what changed", and until this one existed nothing did:
 * the learners recompute when somebody opens a board, so the fifth closed
 * position that carries a finding over its bar changed what the report
 * multiplies by in March and the firm found out in August by opening a screen
 * for an unrelated reason. The learning was real and nobody was told.
 *
 * The same reading is mailed weekly, and only when something crossed. This
 * screen is the version you can ask a different question of — a longer window,
 * after a week the scheduler missed.
 *
 * Nothing here applies anything. Two of the four learners behind it apply
 * themselves once their bar is cleared, which is why a crossing is worth
 * saying; the other two emit source somebody commits. What this card adds is
 * the sentence, not the authority.
 */

const WINDOWS = [
  { value: '7', label: 'Week' },
  { value: '30', label: 'Month' },
  { value: '90', label: 'Quarter' },
] as const;

type Window = (typeof WINDOWS)[number]['value'];

export function EngineDigestCard() {
  const [days, setDays] = useState<Window>('7');
  const view = useQuery({
    queryKey: ['engine-digest', days],
    queryFn: () => api.engineDigest(Number(days)),
  });

  if (view.error) return <ErrorState error={view.error} />;
  if (!view.data) return <Loading />;

  const data: EngineDigestView = view.data;
  const { digest } = data;
  const acted = digest.changes.filter((change) => change.weight === 'act');
  const read = digest.changes.filter((change) => change.weight === 'read');
  const noted = digest.changes.filter((change) => change.weight === 'note');

  return (
    <Card>
      <CardHeader
        icon={Activity}
        title="What the engine learned"
        description="Two readings of the same learners — one now, one at the start of the window — and every difference between them."
        help="The earlier reading is not a stored snapshot. It is the same rows, filtered to those the firm had written down by that date, so a voided claim cannot leave this screen asserting a number the record no longer contains."
        action={
          <Segmented
            ariaLabel="How far back"
            size="sm"
            options={WINDOWS.map((option) => ({ value: option.value, label: option.label }))}
            value={days}
            onChange={setDays}
          />
        }
      />

      <StatGrid columns={3}>
        <StatCell>
          <Stat
            label="Changes what the software does"
            value={count(acted.length)}
            tone={acted.length > 0 ? 'accent' : 'default'}
            note={`since ${day(digest.since)}`}
            help="A fact that crossed the bar its learner sets before a number is used rather than merely shown — or one that stopped clearing it, which means the report has quietly gone back to a built-in constant."
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Worth knowing"
            value={count(read.length + noted.length)}
            note={noted.length > 0 ? `${count(noted.length)} not mailed` : undefined}
            help="Movement inside the bars: a rate that shifted without crossing, evidence that grew, a fact that is new and not yet used. Only the first two ride along in the weekly mail."
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Facts in use"
            value={`${count(digest.inForce)} of ${count(digest.facts)}`}
            help="Everything the four learners currently assert, and how much of it has cleared its bar. A proposal counts as asserted: what stands between it and the advisor is somebody committing it."
          />
        </StatCell>
      </StatGrid>

      {!data.reachesBack ? (
        <div className="px-5 pt-4">
          <Callout tone="warning" title="The record does not reach back this far">
            Nothing in this practice was written down before {day(digest.since)}, so the earlier
            reading is an absence rather than a reading and every fact below is new by construction.
            This is a first look at the engine, not a busy week in it.
          </Callout>
        </div>
      ) : null}

      <Section
        title="Changes what the software does"
        tip="These are the two directions that matter. A rate crossing its bar starts being multiplied into a client's number by itself; one that stops clearing it means the built-in judgement is back in use and nothing said so."
        empty="Nothing crossed a bar in either direction. The rates, the lifts and the vocabulary are all doing what they were doing at the start of the window."
        changes={acted}
      />
      <Section
        title="Worth knowing"
        tip="Movement that did not cross anything. A rate has to move five points before it appears here — below that it wobbles on a single partial allowance, and a screen that reported the wobble would train somebody to stop reading it."
        empty="No number moved by enough to be worth a sentence."
        changes={read}
      />
      <Section
        title="Quieter than that"
        tip="On the screen and never in the mail. A proposal that has not cleared its bar, evidence that grew behind an answer that did not change, a fact that appeared and is not being used."
        empty="Nothing."
        changes={noted}
        muted
      />
    </Card>
  );
}

function Section({
  title,
  tip,
  empty,
  changes,
  muted = false,
}: {
  title: string;
  tip: string;
  empty: string;
  changes: EngineChange[];
  muted?: boolean;
}) {
  return (
    <div className="border-t border-[var(--color-hairline)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-2">
        <h3 className="text-sm font-medium">
          <Tooltip content={tip}>
            <span>{title}</span>
          </Tooltip>
        </h3>
        <p className="text-xs text-[var(--color-ink-muted)]">
          {count(changes.length)} {plural(changes.length, 'change')}
        </p>
      </div>
      {changes.length === 0 ? (
        <p className="px-5 pb-4 text-sm text-[var(--color-ink-muted)]">{empty}</p>
      ) : (
        <ul className="px-5 pb-4">
          {changes.map((change) => (
            <Row key={`${change.fact.id}:${change.kind}`} change={change} muted={muted} />
          ))}
        </ul>
      )}
    </div>
  );
}

const KIND_TONE = {
  crossed: 'accent',
  withdrawn: 'critical',
  appeared: 'neutral',
  moved: 'warning',
  firmed: 'neutral',
} as const;

const KIND_LABEL = {
  crossed: 'Now in use',
  withdrawn: 'No longer in use',
  appeared: 'New',
  moved: 'Moved',
  firmed: 'Better founded',
} as const;

function Row({ change, muted }: { change: EngineChange; muted: boolean }) {
  const { fact, before } = change;
  return (
    <li className="border-t border-[var(--color-hairline)] py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <Badge tone={KIND_TONE[change.kind]}>{KIND_LABEL[change.kind]}</Badge>
        <span className={muted ? 'text-sm text-[var(--color-ink-secondary)]' : 'text-sm'}>
          {change.headline}
        </span>
      </div>
      <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{fact.basis}</p>
      {before ? (
        /**
         * The before and after side by side, because a headline that says a
         * number moved is not the same as showing what it moved from. A reader
         * arguing with this card is arguing with these two values.
         */
        <p className="tabular mt-1 flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
          {trend(before.value, fact.value)}
          <span>
            {value(before.value)} → {value(fact.value)}
          </span>
          <span>·</span>
          <span>
            {count(before.observations)} → {count(fact.observations)}{' '}
            {plural(fact.observations, 'observation')}
          </span>
        </p>
      ) : null}
    </li>
  );
}

function trend(before: number | null, after: number | null) {
  if (before === null || after === null || before === after) return null;
  const Icon = after > before ? ArrowUpRight : ArrowDownRight;
  return <Icon size={13} strokeWidth={2} className="shrink-0" />;
}

/** Two decimals and no percent sign: a lift is not a rate and neither is a count. */
function value(input: number | null): string {
  return input === null ? '—' : input.toFixed(2);
}

function Loading() {
  return (
    <Card>
      <div className="space-y-3 p-5">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </Card>
  );
}
