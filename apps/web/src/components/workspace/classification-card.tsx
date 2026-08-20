'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Brain, Check, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { classificationOptions } from '@tangible/classification';
import type {
  ClassificationQueueItem,
  ClassificationRunResult,
  ClassificationStats,
  ClassificationStatus,
} from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, moneyExact, percent, plural } from '@/lib/format';
import {
  ClassificationSourceBadge,
  ClassificationStatusBadge,
} from '@/components/workspace/badges';
import { Button, ChipGroup, Select, TextInput } from '@/components/ui/controls';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The review queue.
 *
 * Two things had to be true for this screen to be worth a reviewer's time.
 * It has to put the expensive decisions first — so it sorts by original cost,
 * not by row order — and settling one row has to settle every row that says the
 * same thing, here and on every engagement afterwards. Both are visible: each
 * row shows how many twins it carries, and confirming says how many it moved.
 */

const OPTIONS = classificationOptions();
const SCHEDULE_OPTIONS = OPTIONS.filter((o) => o.kind === 'schedule');
const EXCLUSION_OPTIONS = OPTIONS.filter((o) => o.kind === 'exclusion');
const OPTION_BY_KEY = new Map(OPTIONS.map((o) => [o.key, o]));

const STATUS_FILTERS = [
  {
    value: 'needs-review' as const,
    label: 'Needs review',
    description:
      'The engine was not confident enough to decide alone, or the answer takes cost off the rendition — which always gets a person.',
  },
  {
    value: 'auto-accepted' as const,
    label: 'Auto-accepted',
    description:
      'Decided without a reviewer, either from a prior human decision or from a model answer above the confidence bar. Still reversible.',
  },
  {
    value: 'confirmed' as const,
    label: 'Confirmed',
    description:
      'Settled by a person. These are what memory is built from, and a re-run never touches them.',
  },
];

export function ClassificationCard({
  engagementId,
  stats,
}: {
  engagementId: string;
  stats: ClassificationStats;
}) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ClassificationStatus | undefined>('needs-review');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [offset, setOffset] = useState(0);
  const [run, setRun] = useState<ClassificationRunResult | null>(null);
  const limit = 25;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['classification-queue', engagementId] });
    void queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
    void queryClient.invalidateQueries({ queryKey: ['engagement-valuation', engagementId] });
  };

  const classify = useMutation({
    mutationFn: (reclassify: boolean) => api.classify(engagementId, reclassify),
    onSuccess: (result) => {
      setRun(result);
      setOffset(0);
      invalidate();
    },
  });

  const query = { status, search: submitted || undefined, limit, offset };
  const { data, error, isLoading } = useQuery({
    queryKey: ['classification-queue', engagementId, query],
    queryFn: () => api.classifications(engagementId, query),
    placeholderData: (previous) => previous,
    enabled: stats.classifiedCount > 0,
  });

  const unclassified = stats.unclassifiedCount;

  return (
    <Card>
      <CardHeader
        title="Classification"
        description="Which schedule each asset is valued on — the decision the money turns on. Prior human decisions are replayed first and cost nothing; the model only sees what is genuinely new, once per distinct description."
        action={
          <div className="flex gap-2">
            {stats.classifiedCount > 0 ? (
              <Tooltip
                title="Re-run"
                content="Re-decides rows the machine decided, picking up anything memory has learned since. Confirmed rows are never touched."
              >
                <Button
                  onClick={() => classify.mutate(true)}
                  disabled={classify.isPending || stats.assetCount === 0}
                >
                  Re-run
                </Button>
              </Tooltip>
            ) : null}
            <Button
              variant="primary"
              onClick={() => classify.mutate(false)}
              disabled={classify.isPending || unclassified === 0}
            >
              <Sparkles size={13} strokeWidth={2} />
              {classify.isPending
                ? 'Classifying…'
                : unclassified > 0
                  ? `Classify ${count(unclassified)}`
                  : 'All classified'}
            </Button>
          </div>
        }
      />

      <StatsStrip stats={stats} />

      {classify.error ? (
        <p className="px-5 py-2 text-xs text-[var(--color-critical)]">
          {classify.error instanceof Error ? classify.error.message : String(classify.error)}
        </p>
      ) : null}
      {run ? <RunSummary result={run} /> : null}

      {stats.classifiedCount === 0 ? (
        <EmptyState title="Nothing classified yet">
          Every asset needs a schedule category before it can be valued. Run the engine and whatever
          it is not sure about lands here.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 px-5 py-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setOffset(0);
                setSubmitted(search.trim());
              }}
            >
              <TextInput
                placeholder="Search descriptions…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64"
              />
            </form>
            <ChipGroup
              options={STATUS_FILTERS}
              selected={status ? [status] : []}
              onToggle={(value) => {
                setOffset(0);
                setStatus((current) => (current === value ? undefined : value));
              }}
            />
          </div>

          {error ? (
            <ErrorState error={error} />
          ) : isLoading && !data ? (
            <Skeleton className="mx-5 mb-5 h-40" />
          ) : data && data.items.length === 0 ? (
            <EmptyState title={status === 'needs-review' ? 'Queue is clear' : 'Nothing matches'}>
              {status === 'needs-review'
                ? 'Every asset the engine was unsure about has been settled.'
                : 'Try a different filter.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-[var(--color-hairline)] border-t border-[var(--color-hairline)]">
              {data?.items.map((item) => (
                <QueueRow key={item.classification.id} item={item} onSettled={invalidate} />
              ))}
            </ul>
          )}

          {data && data.total > limit ? (
            <div className="flex items-center justify-between px-5 py-3 text-xs text-[var(--color-ink-secondary)]">
              <span className="tabular">
                {offset + 1}–{Math.min(offset + limit, data.total)} of {count(data.total)}
              </span>
              <div className="flex gap-2">
                <Button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                >
                  Previous
                </Button>
                <Button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= data.total}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}

function StatsStrip({ stats }: { stats: ClassificationStats }) {
  const tiles = [
    {
      label: 'To review',
      value: count(stats.needsReviewCount),
      accent: stats.needsReviewCount > 0,
    },
    { label: 'Auto-accepted', value: count(stats.autoAcceptedCount) },
    { label: 'Confirmed', value: count(stats.confirmedCount) },
    {
      label: 'From memory',
      value: count(stats.fromMemoryCount),
      help: 'Decided from a description a reviewer had already settled on an earlier engagement — no model call, no cost. This number is the moat, and it grows with every client.',
    },
    { label: 'Not yet classified', value: count(stats.unclassifiedCount) },
  ];
  return (
    <div className="grid grid-cols-2 gap-px border-y border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-5">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-[var(--color-surface)] px-4 py-2.5">
          <p className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            {tile.label}
            {tile.help ? (
              <Tooltip title={tile.label} content={tile.help}>
                <span className="cursor-help text-[var(--color-ink-muted)]">
                  <Brain size={11} strokeWidth={2} />
                </span>
              </Tooltip>
            ) : null}
          </p>
          <p
            className={cn(
              'tabular mt-0.5 text-base font-semibold',
              tile.accent ? 'text-[var(--color-warning)]' : '',
            )}
          >
            {tile.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function RunSummary({ result }: { result: ClassificationRunResult }) {
  const parts: string[] = [];
  if (result.fromMemory > 0) {
    parts.push(`${count(result.fromMemory)} from memory, at no cost`);
  }
  if (result.fromAi > 0) {
    parts.push(
      `${count(result.fromAi)} from ${result.model ?? 'the model'} in ${count(result.aiCalls)} ${plural(result.aiCalls, 'call')} — ${count(result.distinctSent)} distinct ${plural(result.distinctSent, 'description')}`,
    );
  }
  if (result.unclassifiable > 0)
    parts.push(`${count(result.unclassifiable)} with nothing to go on`);

  return (
    <div className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)] px-5 py-2.5 text-xs">
      <p>
        Considered {count(result.considered)} {plural(result.considered, 'asset')}
        {parts.length ? `: ${parts.join('; ')}` : ''}.{' '}
        <span className="font-medium">
          {count(result.autoAccepted)} accepted, {count(result.needsReview)} queued.
        </span>
      </p>
      {result.aiUnavailable ? (
        <p className="mt-1 text-[var(--color-warning)]">
          AI classification is off in this deployment, so only memory ran. The rest are queued for
          manual classification — the reason is on each row, and each one you settle is remembered.
        </p>
      ) : null}
      {result.failedBatches > 0 ? (
        <p className="mt-1 text-[var(--color-critical)]">
          {count(result.failedBatches)} {plural(result.failedBatches, 'batch', 'batches')} failed
          and left their assets unclassified. Running again retries exactly those.
        </p>
      ) : null}
      {result.deferred > 0 ? (
        <p className="mt-1 text-[var(--color-warning)]">
          {count(result.deferred)} distinct descriptions were past this run&rsquo;s cap and were not
          sent. Run again to pick them up.
        </p>
      ) : null}
    </div>
  );
}

function QueueRow({ item, onSettled }: { item: ClassificationQueueItem; onSettled: () => void }) {
  const { classification: c, asset, siblingCount } = item;
  const [chosen, setChosen] = useState(c.categoryKey ?? '');
  const [applyToMatching, setApplyToMatching] = useState(true);
  const [applied, setApplied] = useState<number | null>(null);

  const decide = useMutation({
    mutationFn: () =>
      api.decideClassification(c.id, {
        categoryKey: chosen,
        lifeClassOverride: c.lifeClassOverride,
        remember: true,
        applyToMatching,
      }),
    onSuccess: (result) => {
      setApplied(result.applied);
      onSettled();
    },
  });

  const changed = chosen !== (c.categoryKey ?? '');
  const option = useMemo(() => (chosen ? OPTION_BY_KEY.get(chosen) : undefined), [chosen]);
  const settled = c.status === 'confirmed';

  return (
    <li className="flex flex-col gap-3 px-5 py-3.5 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{asset.description ?? <em>No description</em>}</p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {asset.sourceSheet} · row {asset.sourceRow + 1}
          {asset.category ? ` · register: ${asset.category}` : ''}
          {asset.glAccount ? ` · GL ${asset.glAccount}` : ''}
          {asset.acquisitionYear ? ` · acquired ${asset.acquisitionYear}` : ''}
          {' · '}
          <span className="tabular font-medium text-[var(--color-ink-secondary)]">
            {moneyExact(asset.originalCost)}
          </span>
        </p>
        {c.rationale ? (
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {c.rationale}
          </p>
        ) : null}
        {siblingCount > 0 ? (
          <p className="mt-1 text-[11px] text-[var(--color-ink-muted)]">
            {count(siblingCount)} other {plural(siblingCount, 'row')} in this engagement say the
            same thing.
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-2 lg:w-96">
        <div className="flex items-center gap-2">
          <ClassificationStatusBadge status={c.status} />
          <ClassificationSourceBadge source={c.source} />
          <span className="tabular text-[11px] text-[var(--color-ink-muted)]">
            {percent(c.confidence, 0)} confident
          </span>
        </div>

        <Select
          value={chosen}
          onChange={(e) => setChosen(e.target.value)}
          className="w-full"
          aria-label="Classification"
        >
          <option value="">— not classified —</option>
          <optgroup label="Valued on a schedule">
            {SCHEDULE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Off the rendition">
            {EXCLUSION_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        </Select>

        {option ? (
          <p className="text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
            {option.kind === 'exclusion' ? (
              <span className="font-medium text-[var(--color-warning)]">
                Comes off the rendition.{' '}
              </span>
            ) : null}
            {option.description}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          {siblingCount > 0 ? (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--color-ink-secondary)]">
              <input
                type="checkbox"
                checked={applyToMatching}
                onChange={(e) => setApplyToMatching(e.target.checked)}
                className="cursor-pointer"
              />
              Apply to all {count(siblingCount + 1)}
            </label>
          ) : (
            <span />
          )}
          <Button
            variant={changed || !settled ? 'primary' : 'secondary'}
            onClick={() => decide.mutate()}
            disabled={!chosen || decide.isPending}
          >
            {decide.isPending ? 'Saving…' : settled && !changed ? 'Re-confirm' : 'Confirm'}
          </Button>
        </div>

        {applied !== null ? (
          <p className="flex items-center gap-1 text-[11px] text-[var(--color-good)]">
            <Check size={11} strokeWidth={3} />
            Settled {count(applied)} {plural(applied, 'row')} and remembered for future engagements.
          </p>
        ) : null}
        {decide.error ? (
          <p className="text-[11px] text-[var(--color-critical)]">
            {decide.error instanceof Error ? decide.error.message : String(decide.error)}
          </p>
        ) : null}
      </div>
    </li>
  );
}
