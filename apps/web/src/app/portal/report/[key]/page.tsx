'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ScanSearch } from 'lucide-react';
import { use, useMemo, useState } from 'react';
import type { FindingRowFilters, FindingRowPage } from '@tangible/types';
import { api } from '@/lib/api';
import { count, money, percent, plural } from '@/lib/format';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  BackLink,
  PageHeader,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { Button } from '@/components/ui/controls';
import { ConfidenceFloor } from '@/components/portal/confidence-floor';
import { usePortal } from '@/components/portal/portal-context';
import { FindingAsk } from '@/components/portal/finding-ask';
import { FindingDecideBar } from '@/components/portal/finding-decide-bar';
import { EMPTY_FILTERS, FindingFilters, isFiltered } from '@/components/portal/finding-filters';
import { FindingRowsTable } from '@/components/portal/finding-rows-table';
import { ReadOnlyNote } from '@/components/portal/read-only';

/**
 * One finding, worked.
 *
 * This page used to answer two questions — *what is this* and *which of my
 * assets* — and stop there, which left the client with a list and the firm with
 * every decision. It now answers the third: *what do I want to do about each of
 * these*. Filter to the rows you can judge, judge them in a batch, and take the
 * result away as a working paper. Nobody at the firm has to be in the loop for
 * any of it.
 *
 * The rows come from the server on every filter change rather than being sliced
 * in the browser. A finding can run to thousands of lines, and the numbers
 * printed above the table have to be the filter's own totals — not a page's.
 */

const KIND_META: Record<
  FindingRowPage['kind'],
  { label: string; tone: 'good' | 'accent' | 'warning' }
> = {
  measured: { label: 'Measured from your register', tone: 'good' },
  modeled: { label: 'Rests on an assumption', tone: 'accent' },
  screening: { label: 'Needs an answer from you', tone: 'warning' },
};

export default function PortalFindingPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const findingKey = decodeURIComponent(key);
  const { engagementId, clientId, canAct, href } = usePortal();
  const queryClient = useQueryClient();

  /**
   * The floor is the client's own setting, and it seeds the filter rather than
   * being applied behind it. A server that quietly withheld low-confidence rows
   * would produce a screen whose totals nobody could reconcile; a chip that
   * arrives already ticked is the same default, visible, and one click from
   * being undone.
   */
  const settings = useQuery({
    queryKey: ['portal-settings', clientId],
    queryFn: () => api.portalSettings(clientId),
    staleTime: 300_000,
  });

  const [filters, setFilters] = useState<FindingRowFilters | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const floor = settings.data?.confidenceFloor ?? 'low';
  const effective: FindingRowFilters = filters ?? {
    ...EMPTY_FILTERS,
    confidence: floor === 'high' ? ['high'] : floor === 'medium' ? ['high', 'medium'] : [],
  };

  const rows = useQuery({
    queryKey: ['finding-rows', engagementId, findingKey, effective, offset],
    queryFn: () => api.findingRows(engagementId!, findingKey, effective, { offset }),
    enabled: engagementId !== null && !settings.isLoading,
    placeholderData: (previous) => previous,
  });

  const decide = useMutation({
    mutationFn: (input: {
      status: 'accepted' | 'rejected' | 'pending-client' | null;
      note: string;
    }) =>
      api.decideFindingRows(
        engagementId!,
        {
          findingKey,
          assetIds: [...selected],
          status: input.status,
          note: input.note === '' ? undefined : input.note,
        },
        effective,
      ),
    onSuccess: (page) => {
      // The answer *is* the same filtered view, so it is written straight into
      // the cache rather than triggering a refetch that would blank the table
      // under the person who just acted.
      queryClient.setQueryData(['finding-rows', engagementId, findingKey, effective, offset], page);
      void queryClient.invalidateQueries({ queryKey: ['finding-rows', engagementId, findingKey] });
      setSelected(new Set());
    },
  });

  const change = (next: FindingRowFilters) => {
    setFilters(next);
    // A filter change makes the current offset meaningless — page 3 of the old
    // selection is not page 3 of the new one.
    setOffset(0);
  };

  const page = rows.data ?? null;

  const selection = useMemo(
    () => (page?.rows ?? []).filter(({ row }) => selected.has(row.assetId)),
    [page, selected],
  );

  if (rows.isLoading || settings.isLoading) {
    return (
      <Card>
        <div className="space-y-3 px-5 py-5">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      </Card>
    );
  }

  if (rows.error) {
    const missing = (rows.error as { status?: number }).status === 404;
    return missing ? (
      <>
        <PageHeader
          back={<BackLink href={href('/portal')}>Your report</BackLink>}
          title="Not on this report"
        />
        <Card>
          <EmptyState title="That finding is not on your current report">
            It may have been on an earlier year, or the report may have been rebuilt since you
            opened this page.
          </EmptyState>
        </Card>
      </>
    ) : (
      <Card>
        <ErrorState error={rows.error} />
      </Card>
    );
  }

  if (!page) return null;

  const meta = KIND_META[page.kind];
  const showing = page.rows.length;
  const more = page.filtered.rows > offset + showing;

  const toggle = (assetId: string) =>
    setSelected((held) => {
      const next = new Set(held);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });

  const toggleAll = () =>
    setSelected((held) => {
      const every = page.rows.every(({ row }) => held.has(row.assetId));
      if (every) return new Set();
      return new Set(page.rows.map(({ row }) => row.assetId));
    });

  return (
    <div className="space-y-6">
      <PageHeader
        back={<BackLink href={href('/portal')}>Your report</BackLink>}
        title={page.title}
        description={page.summary}
        actions={<Badge tone={meta.tone}>{meta.label}</Badge>}
      />

      <Card>
        <StatGrid columns={4}>
          <StatCell>
            <Stat
              label={isFiltered(effective) ? 'Off the return, filtered' : 'Value off the return'}
              value={money(page.filtered.valueRemoved)}
              tone={page.filtered.valueRemoved > 0 ? 'good' : 'default'}
              help="Market value this takes off the rendition, on the district’s own schedules."
              note={
                isFiltered(effective)
                  ? `${money(page.population.valueRemoved)} across the whole finding`
                  : undefined
              }
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Tax a year"
              value={money(page.filtered.taxAtRisk)}
              /* The qualifier belongs under the number, not only inside the
                 explainer: a rate that is a county-wide stand-in makes this
                 figure an order of magnitude, and nobody hovers a figure they
                 already believe. */
              note={
                page.rateSource.kind === 'estimated'
                  ? 'rate is an estimate'
                  : page.rateSource.kind === 'prior-year'
                    ? `at ${page.rateSource.label}`
                    : undefined
              }
              help={`At ${percent(page.blendedTaxRate, 2)} \u2014 ${page.rateSource.label} for ${page.jurisdictionName ?? 'your jurisdiction'}. ${page.rateSource.detail}`}
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Assets"
              value={count(page.filtered.rows)}
              help="Register lines the current filter selected. Clearing the filter shows every line on the finding."
              note={
                isFiltered(effective)
                  ? `of ${count(page.population.rows)} on the finding`
                  : undefined
              }
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Original cost"
              value={money(page.filtered.originalCost)}
              help="What those lines cost when they were bought — the scale of the finding, before depreciation."
            />
          </StatCell>
        </StatGrid>
        {page.filtered.unpricedRows > 0 ? (
          <p className="border-t border-[var(--color-hairline)] px-5 py-2.5 text-xs text-[var(--color-ink-secondary)]">
            {count(page.filtered.unpricedRows)} {plural(page.filtered.unpricedRows, 'row')} here
            cannot be priced until the question below is answered. They are counted above and
            contribute nothing to the dollars.
          </p>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Why this is a real position" />
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm">{page.basis}</p>
          {page.assumption ? (
            <Callout
              tone="neutral"
              title={page.kind === 'screening' ? 'What settles it' : 'The assumption behind it'}
            >
              {page.assumption}
            </Callout>
          ) : null}
          {page.kind === 'screening' && page.question ? (
            <FindingAsk
              finding={{
                key: page.findingKey,
                title: page.title,
                summary: page.summary,
                question: page.question,
                assumption: page.assumption,
              }}
            />
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="How these assets were found"
          icon={ScanSearch}
          description="Each signal is a specific thing we looked for in your register. The counts are the whole finding, before any filter."
          help="Confidence is built from these. A row scores higher when several signals agree and lower when one of them argues the other way — and the tooltip on any row’s badge shows which fired for that line."
        />
        {page.detection.length === 0 ? (
          <EmptyState title="This report predates per-signal recording">
            The next time your analysis is re-run, the signals behind every row will be recorded
            here.
          </EmptyState>
        ) : (
          <div className="grid gap-x-8 gap-y-2 px-5 py-4 sm:grid-cols-2">
            {page.detection.map((signal) => (
              <div
                key={signal.code}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--color-hairline)] pb-1.5"
              >
                <span className="text-sm">{signal.label}</span>
                <span className="tabular shrink-0 text-xs text-[var(--color-ink-secondary)]">
                  {count(signal.assetCount)} {plural(signal.assetCount, 'asset')} ·{' '}
                  {money(signal.originalCost)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 border-t border-[var(--color-hairline)] px-5 py-3">
          <Badge tone="good" dot>
            {count(page.confidenceMix.high)} high
          </Badge>
          <Badge tone="accent" dot>
            {count(page.confidenceMix.medium)} medium
          </Badge>
          <Badge tone="neutral" dot>
            {count(page.confidenceMix.low)} low
          </Badge>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Narrow it down"
          description="Every option here comes from these assets, so nothing on this bar selects nothing."
          action={
            <ConfidenceFloor clientId={clientId} settings={settings.data} disabled={!canAct} />
          }
        />
        <FindingFilters facets={page.facets} filters={effective} onChange={change} />
      </Card>

      <Card>
        <CardHeader
          title="The assets behind it"
          description={`${count(page.filtered.rows)} ${plural(page.filtered.rows, 'line')} from the register you sent${
            showing < page.filtered.rows ? `, showing ${count(showing)}` : ''
          }.`}
          help="Printed line by line on purpose: a claim about your property that you cannot check row by row is one you should not have to accept."
          action={
            <a
              href={api.findingRowsExportUrl(engagementId!, findingKey, effective)}
              className="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-[var(--color-hairline-strong)] px-2.5 text-xs font-medium text-[var(--color-ink-secondary)] transition-colors hover:text-[var(--color-ink)]"
            >
              <Download size={13} className="mr-1.5" />
              Export this view
            </a>
          }
        />

        {!canAct ? (
          <div className="border-b border-[var(--color-hairline)] px-5 py-3">
            <ReadOnlyNote what="Accepting or rejecting a row" />
          </div>
        ) : null}

        {page.rows.length === 0 ? (
          <EmptyState title="Nothing matches that filter">
            {isFiltered(effective)
              ? 'Clear a filter to widen the list.'
              : 'This finding has no rows on the published report.'}
          </EmptyState>
        ) : (
          <>
            <FindingRowsTable
              page={page}
              selected={selected}
              onToggle={toggle}
              onToggleAll={toggleAll}
              selectable={canAct}
              assetHref={(assetId) => href(`/portal/assets/${assetId}`)}
            />
            {(offset > 0 || more) && (
              <div className="flex items-center justify-between border-t border-[var(--color-hairline)] px-5 py-3">
                <Button
                  variant="ghost"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - page.limit))}
                >
                  Previous
                </Button>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {count(offset + 1)}–{count(offset + showing)} of {count(page.filtered.rows)}
                </span>
                <Button
                  variant="ghost"
                  disabled={!more}
                  onClick={() => setOffset(offset + page.limit)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        )}

        {decide.error ? (
          <p className="px-5 py-2 text-xs text-[var(--color-critical)]">
            {decide.error instanceof Error
              ? decide.error.message
              : 'Those decisions could not be saved.'}
          </p>
        ) : null}

        {canAct ? (
          <FindingDecideBar
            selection={selection}
            pending={decide.isPending}
            onClear={() => setSelected(new Set())}
            onDecide={(status, note) => decide.mutate({ status, note })}
          />
        ) : null}
      </Card>
    </div>
  );
}
