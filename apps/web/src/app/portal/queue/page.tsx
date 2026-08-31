'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, HelpCircle, ListOrdered, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { AcceptanceEvidenceView, FindingQueue, QueueItem } from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, money, moneyExact, percent, plural } from '@/lib/format';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
  type BadgeTone,
} from '@/components/ui/primitives';
import { Button, TextInput } from '@/components/ui/controls';
import { usePortal } from '@/components/portal/portal-context';
import { PortalHeader } from '@/components/portal/portal-header';
import { ReadOnlyNote } from '@/components/portal/read-only';
import { RecoveryBreakdown } from '@/components/portal/recovery-breakdown';
import { TaxChainTable } from '@/components/portal/tax-chain';
import { usePublishedReport } from '@/components/portal/use-published-report';

/**
 * The queue. Twenty-five decisions, in the order they are worth making.
 *
 * The report organised by category is the report organised the way it was
 * computed, and nobody works it that way: a controller with two hours before a
 * deadline wants the decisions worth the most money, in order, whatever bucket
 * they came out of. The category list stays — it is how you check afterwards
 * that nothing was missed — but this is where the work happens.
 *
 * Three things shape the screen.
 *
 *   - **The page holds still while you work it.** A decided row is marked in
 *     place rather than vanishing and shuffling everything below it up by one.
 *     A list that reorders under the cursor is a list where the row you meant
 *     to accept is no longer the row you clicked.
 *   - **The evidence sits beside the decision, not behind a click.** Every
 *     accept on this page removes value from a return somebody signs, so the
 *     line's own chain from cost to tax, the odds behind its ranking, and the
 *     signals that flagged it are all on screen at the moment of deciding.
 *   - **Finishing means something.** The next twenty-five are offered when the
 *     first are done rather than paged through, because a queue you can page
 *     past is a queue with no bottom.
 */
export default function PortalQueuePage() {
  const { engagementId, canAct } = usePortal();
  const queryClient = useQueryClient();

  /**
   * Decisions taken on this page, held here as well as on the server.
   *
   * The server drops a decided row from the queue entirely — that is what makes
   * the ranking a queue rather than a list — so refetching after every click
   * would pull the next row up under the cursor. These are what let the page
   * stay still until the reader asks for the next twenty-five.
   */
  const [decided, setDecided] = useState<
    Record<string, 'accepted' | 'rejected' | 'pending-client'>
  >({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const queue = useQuery({
    queryKey: ['finding-queue', engagementId],
    queryFn: () => api.findingQueue(engagementId!),
    enabled: engagementId !== null,
    placeholderData: (previous) => previous,
  });

  // Only for the acceptance caveat: the constant behind every ranking on this
  // page is an assumption until outcomes have been measured, and the screen
  // that ranks on it is the screen that has to say so. The report is already in
  // cache from the report page, so this costs nothing on the usual path.
  const published = usePublishedReport(engagementId);
  const acceptanceIsPlaceholder = published.report?.recoveryModel.acceptanceIsPlaceholder ?? true;
  // The per-finding version of the same caveat. A firm can have measured some
  // arguments and not others, and once that is true a single flag on the page
  // is the wrong grain: the row in front of somebody either rests on closed
  // positions or it does not.
  const acceptanceEvidence = published.report?.recoveryModel.acceptanceEvidence ?? [];

  // Memoized on the query result rather than rebuilt each render: the fallback
  // `[]` is a fresh array every time, and both hooks below key off this array's
  // identity, so an unmemoized empty list makes them re-run forever.
  const items = useMemo(() => queue.data?.items ?? [], [queue.data]);

  const selected = useMemo(
    () => items.find((item) => item.row.rowKey === selectedKey) ?? items[0] ?? null,
    [items, selectedKey],
  );

  // Open on the first row that still needs a decision, so a reader returning to
  // a half-worked page lands where they left off rather than at the top.
  useEffect(() => {
    if (items.length === 0) return;
    if (selectedKey !== null && items.some((item) => item.row.rowKey === selectedKey)) return;
    const next = items.find((item) => decided[item.row.rowKey] === undefined) ?? items[0];
    // The rows arrive asynchronously, so which one to open cannot be derived at
    // render time; the two guards above make this fire once per arriving page.
    // oxlint-disable-next-line react/set-state-in-effect
    if (next) setSelectedKey(next.row.rowKey);
  }, [items, selectedKey, decided]);

  const decide = useMutation({
    mutationFn: (input: {
      item: QueueItem;
      status: 'accepted' | 'rejected' | 'pending-client';
      note: string;
    }) =>
      api.decideFindingRows(engagementId!, {
        findingKey: input.item.row.findingKey,
        assetIds: [input.item.row.assetId],
        status: input.status,
        note: input.note === '' ? undefined : input.note,
      }),
    onSuccess: (_page, input) => {
      setDecided((held) => ({ ...held, [input.item.row.rowKey]: input.status }));
      setNote('');
      // The finding's own page shows the same decision from the other side, so
      // its cache is stale the moment this lands. The queue is *not* refetched:
      // see the note on `decided` above.
      void queryClient.invalidateQueries({
        queryKey: ['finding-rows', engagementId, input.item.row.findingKey],
      });
      // Move to the next row that still needs a decision. Working a queue is a
      // sequence, and making the reader re-aim after every click is the reason
      // people go back to spreadsheets.
      const order = items.findIndex((item) => item.row.rowKey === input.item.row.rowKey);
      const next = items
        .slice(order + 1)
        .find(
          (item) =>
            decided[item.row.rowKey] === undefined && item.row.rowKey !== input.item.row.rowKey,
        );
      if (next) setSelectedKey(next.row.rowKey);
    },
  });

  const nextPage = () => {
    setDecided({});
    setSelectedKey(null);
    void queryClient.invalidateQueries({ queryKey: ['finding-queue', engagementId] });
  };

  if (engagementId === null) {
    return (
      <>
        <PortalHeader title="What to do first" description="Nothing has been opened for you yet." />
        <Card>
          <EmptyState title="No tax year open">
            Once we open a year for you, the decisions worth making appear here.
          </EmptyState>
        </Card>
      </>
    );
  }

  return (
    <>
      <PortalHeader
        title="What to do first"
        description="Every finding on your report as one ranked list — the decisions worth the most, in the order they are worth making."
      />

      {queue.isLoading ? (
        <Card>
          <div className="space-y-3 px-5 py-5">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        </Card>
      ) : queue.error ? (
        (queue.error as { status?: number }).status === 404 ? (
          <Card>
            <EmptyState title="Your report is being prepared">
              There is nothing to work through until a report has been published for this year.
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <ErrorState error={queue.error} />
          </Card>
        )
      ) : queue.data ? (
        <Board
          queue={queue.data}
          items={items}
          selected={selected}
          onSelect={setSelectedKey}
          decided={decided}
          canAct={canAct}
          note={note}
          onNote={setNote}
          pending={decide.isPending}
          error={decide.error}
          onDecide={(item, status) => decide.mutate({ item, status, note: note.trim() })}
          onNextPage={nextPage}
          acceptanceIsPlaceholder={acceptanceIsPlaceholder}
          acceptanceEvidence={acceptanceEvidence}
        />
      ) : null}
    </>
  );
}

function Board({
  queue,
  items,
  selected,
  onSelect,
  decided,
  canAct,
  note,
  onNote,
  pending,
  error,
  onDecide,
  onNextPage,
  acceptanceIsPlaceholder,
  acceptanceEvidence,
}: {
  queue: FindingQueue;
  items: QueueItem[];
  selected: QueueItem | null;
  onSelect: (rowKey: string) => void;
  decided: Record<string, 'accepted' | 'rejected' | 'pending-client'>;
  canAct: boolean;
  note: string;
  onNote: (value: string) => void;
  pending: boolean;
  error: unknown;
  onDecide: (item: QueueItem, status: 'accepted' | 'rejected' | 'pending-client') => void;
  onNextPage: () => void;
  acceptanceIsPlaceholder: boolean;
  acceptanceEvidence: AcceptanceEvidenceView[];
}) {
  const { href } = usePortal();
  const done = items.filter((item) => decided[item.row.rowKey] !== undefined).length;
  const finished = items.length > 0 && done === items.length;
  const onThisPage = items.reduce((sum, item) => sum + (item.row.expectedRecovery ?? 0), 0);

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState
          title={
            queue.decided > 0 ? 'Everything on this report has been decided' : 'Nothing to decide'
          }
          icon={ListOrdered}
          action={
            <Link
              href={href('/portal')}
              className="text-sm font-medium text-[var(--color-accent)] hover:underline"
            >
              Back to your report
            </Link>
          }
        >
          {queue.decided > 0
            ? `${count(queue.decided)} ${plural(queue.decided, 'line')} have a decision on them. When we re-read your register, anything new appears here.`
            : 'No line on this report carries a priced position yet. The questions on your report are what move next.'}
        </EmptyState>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <StatGrid columns={4}>
          <StatCell>
            <Stat
              label="On this page"
              value={money(onThisPage)}
              tone="good"
              size="lg"
              help="Expected recovery across these twenty-five: what each position is worth after allowing for how sure we are, how often a district concedes it, and which prior years can still be reopened."
              note={`${count(done)} of ${count(items.length)} decided`}
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Still in the queue"
              value={money(queue.remainingRecovery)}
              help="Every undecided line on the report, at expected recovery. The page in front of you is the top of it."
              note={`${count(queue.eligible)} ${plural(queue.eligible, 'line')} waiting`}
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Already decided"
              value={count(queue.decided)}
              help="Lines you or your preparer have accepted, rejected or sent back for more information. They leave the queue and stay on the finding they came from."
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Rate used"
              value={percent(queue.rateBasis.millage, 2)}
              help="Tax per dollar of assessed value, blended across the taxing units covering your sites. The assessment ratio is applied separately, and is shown on every line."
              note={queue.jurisdictionName ?? undefined}
            />
          </StatCell>
        </StatGrid>
      </Card>

      {queue.heldBack.length > 0 ? (
        <Callout tone="neutral" title="What this page deliberately left out">
          {/* A diversity rule that quietly hid the second-highest row on the
              report would be the report lying about its own ordering. */}
          No one kind of finding takes more than a share of a page, so that a register with hundreds
          of one thing cannot bury the four of another worth more than any of them. Held back for
          later pages:{' '}
          {queue.heldBack.map((held) => `${held.findingTitle} (${count(held.count)})`).join(', ')}.
          Nothing is dropped — every one of them appears further down the queue.
        </Callout>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <Card>
          <CardHeader
            title="In order of what it is worth"
            icon={ListOrdered}
            description="Ranked across every finding at once. A small certain correction can outrank a large doubtful one, and often does."
            help="The ranking is expected recovery: this year's tax plus every prior year still reachable, each discounted by how sure we are of the line, how often a district concedes that kind of position, and how likely that year can still be corrected."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {items.map((item) => (
              <QueueRow
                key={item.row.rowKey}
                item={item}
                active={selected?.row.rowKey === item.row.rowKey}
                decision={decided[item.row.rowKey]}
                onSelect={() => onSelect(item.row.rowKey)}
              />
            ))}
          </ul>

          <div className="border-t border-[var(--color-hairline)] px-5 py-4">
            {finished ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  That is all twenty-five.{' '}
                  <span className="text-[var(--color-ink-secondary)]">
                    {queue.hasMore
                      ? `${money(queue.remainingRecovery)} still in the queue behind them.`
                      : 'Nothing else on this report is waiting on a decision.'}
                  </span>
                </p>
                {queue.hasMore ? (
                  <Button variant="primary" onClick={onNextPage}>
                    Bring up the next 25
                  </Button>
                ) : (
                  <Link
                    href={href('/portal')}
                    className="text-sm font-medium text-[var(--color-accent)] hover:underline"
                  >
                    Back to your report
                  </Link>
                )}
              </div>
            ) : (
              <p className="text-xs text-[var(--color-ink-muted)]">
                {count(items.length - done)} {plural(items.length - done, 'line')} left on this
                page. The next twenty-five are offered once these are done — and the{' '}
                <Link href={href('/portal')} className="text-[var(--color-accent)] hover:underline">
                  category view
                </Link>{' '}
                is still there for checking that nothing was missed.
              </p>
            )}
          </div>
        </Card>

        <div className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <Evidence
              item={selected}
              decision={decided[selected.row.rowKey]}
              canAct={canAct}
              note={note}
              onNote={onNote}
              pending={pending}
              error={error}
              onDecide={onDecide}
              acceptanceIsPlaceholder={acceptanceIsPlaceholder}
              acceptanceEvidence={acceptanceEvidence}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

const KIND_TONE: Record<QueueItem['findingKind'], BadgeTone> = {
  measured: 'good',
  modeled: 'accent',
  screening: 'warning',
};

const DECISION_META: Record<string, { label: string; tone: BadgeTone }> = {
  accepted: { label: 'Accepted', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'critical' },
  'pending-client': { label: 'Need info', tone: 'warning' },
};

function QueueRow({
  item,
  active,
  decision,
  onSelect,
}: {
  item: QueueItem;
  active: boolean;
  decision: 'accepted' | 'rejected' | 'pending-client' | undefined;
  onSelect: () => void;
}) {
  const { row } = item;
  const meta = decision ? DECISION_META[decision] : null;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex w-full items-baseline gap-3 px-5 py-3 text-left transition-colors',
          active ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-sunken)]',
          // Decided rows stay in place and stay legible — they are the record of
          // what was just done, not clutter to be faded out of the way.
          decision && !active && 'opacity-70',
        )}
      >
        <span className="tabular w-7 shrink-0 text-xs text-[var(--color-ink-muted)]">
          {item.rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="truncate text-sm font-medium">
              {row.description ?? row.assetTag ?? 'Unnamed asset'}
            </span>
            {meta ? <Badge tone={meta.tone}>{meta.label}</Badge> : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[var(--color-ink-secondary)]">
            {item.findingTitle}
            {row.siteLabel ? ` · ${row.siteLabel}` : ''}
            {row.assetTag ? ` · ${row.assetTag}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block text-sm font-semibold text-[var(--color-good)]">
            {money(row.expectedRecovery)}
          </span>
          <span className="block text-xs text-[var(--color-ink-muted)]">
            {row.confidence.tier} confidence
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Everything behind the row being decided, on screen at the moment of deciding.
 *
 * The order is the order of the questions a person actually asks: what is this
 * thing, why did you flag it, what is the arithmetic, what are the odds — and
 * only then the three buttons.
 */
function Evidence({
  item,
  decision,
  canAct,
  note,
  onNote,
  pending,
  error,
  onDecide,
  acceptanceIsPlaceholder,
  acceptanceEvidence,
}: {
  item: QueueItem;
  decision: 'accepted' | 'rejected' | 'pending-client' | undefined;
  canAct: boolean;
  note: string;
  onNote: (value: string) => void;
  pending: boolean;
  error: unknown;
  onDecide: (item: QueueItem, status: 'accepted' | 'rejected' | 'pending-client') => void;
  acceptanceIsPlaceholder: boolean;
  acceptanceEvidence: AcceptanceEvidenceView[];
}) {
  const { href } = usePortal();
  const { row } = item;

  return (
    <Card>
      <CardHeader
        title={row.description ?? row.assetTag ?? 'Unnamed asset'}
        description={
          <>
            <Link
              href={href(`/portal/report/${encodeURIComponent(row.findingKey)}`)}
              className="text-[var(--color-accent)] hover:underline"
            >
              {item.findingTitle}
            </Link>
            {row.categoryLabel ? ` · ${row.categoryLabel}` : ''}
          </>
        }
        action={<Badge tone={KIND_TONE[item.findingKind]}>{item.findingKind}</Badge>}
      />

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-5 py-4 text-xs">
        <Fact label="Your tag for it" value={row.assetTag ?? '—'} />
        <Fact
          label="Acquired"
          value={row.acquisitionYear === null ? '—' : String(row.acquisitionYear)}
        />
        <Fact label="Original cost" value={moneyExact(row.originalCost)} />
        <Fact label="Where it sits" value={row.siteLabel ?? 'Not placed at a site'} />
        {row.costCenter ? <Fact label="Cost centre" value={row.costCenter} /> : null}
        <Fact
          label="Something to check it against"
          value={row.evidencePresent ? 'Yes — the register carries one' : 'Nothing on the register'}
        />
      </dl>

      <div className="border-t border-[var(--color-hairline)] px-5 py-4">
        <p className="text-sm">{row.confidence.why}</p>
        <ul className="mt-2 space-y-1 text-xs text-[var(--color-ink-secondary)]">
          {row.confidence.signals.map((signal) => (
            <li key={signal.code}>
              <span
                className={
                  signal.weight < 0 ? 'text-[var(--color-critical)]' : 'text-[var(--color-good)]'
                }
              >
                {signal.weight < 0 ? '−' : '+'}
              </span>{' '}
              {signal.label}
              {signal.detail ? (
                <span className="text-[var(--color-ink-muted)]"> ({signal.detail})</span>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">{item.basis}</p>
      </div>

      <div className="border-t border-[var(--color-hairline)] px-5 py-4">
        <TaxChainTable row={row} />
      </div>

      {row.recovery ? (
        <div className="border-t border-[var(--color-hairline)] px-5 py-4">
          <RecoveryBreakdown
            recovery={row.recovery}
            acceptanceIsPlaceholder={acceptanceIsPlaceholder}
            evidence={acceptanceEvidence.find((line) => line.findingKey === row.findingKey) ?? null}
          />
        </div>
      ) : null}

      {item.findingQuestion ? (
        <div className="border-t border-[var(--color-hairline)] px-5 py-4">
          <p className="text-xs text-[var(--color-ink-secondary)]">{item.findingQuestion}</p>
        </div>
      ) : null}

      <div className="border-t border-[var(--color-hairline)] px-5 py-4">
        {!canAct ? (
          <ReadOnlyNote what="Accepting or rejecting a line" />
        ) : (
          <>
            {decision ? (
              <p className="mb-2 text-xs text-[var(--color-ink-secondary)]">
                Recorded as {(DECISION_META[decision]?.label ?? decision).toLowerCase()}. Choosing
                again records a new decision over the top — nothing here is deleted.
              </p>
            ) : null}
            <TextInput
              compact
              value={note}
              placeholder="Note (optional)"
              onChange={(event) => onNote(event.target.value)}
              className="w-full"
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="primary"
                disabled={pending}
                onClick={() => onDecide(item, 'accepted')}
              >
                <Check size={13} className="mr-1" />
                Accept
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => onDecide(item, 'rejected')}
              >
                <X size={13} className="mr-1" />
                Reject
              </Button>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => onDecide(item, 'pending-client')}
              >
                <HelpCircle size={13} className="mr-1" />
                Need info
              </Button>
            </div>
            {error ? (
              <p className="mt-2 text-xs text-[var(--color-critical)]">
                {error instanceof Error ? error.message : 'That decision could not be saved.'}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
