'use client';

import type { ColumnDef, SortingState } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';
import {
  ACCOUNT_SORT_FIELDS,
  SEGMENTS,
  type AccountQuery,
  type AccountSeries,
  type AccountSortField,
} from '@tangible/types';
import { cn } from '@/lib/cn';
import { count, moneyExact } from '@/lib/format';
import { Badge } from '@/components/ui/primitives';
import { DataTable, type ColumnMeta } from '@/components/ui/data-table';
import { StateClassCell } from '@/components/state-class';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Only these columns can be sorted, because only these can be sorted *by the
 * server*. City and class are derived from the latest year and have no index or
 * ORDER BY behind them; offering a header that silently reordered one page
 * would be worse than not offering it.
 */
const SORTABLE = new Set<string>(ACCOUNT_SORT_FIELDS);

export function AccountsTable({
  accounts,
  query,
  total,
  onSortChange,
  onOffsetChange,
  scopeQuery,
  loading,
}: {
  accounts: AccountSeries[];
  query: AccountQuery;
  total: number;
  onSortChange: (sortBy: AccountSortField, sortDir: 'asc' | 'desc') => void;
  onOffsetChange: (offset: number) => void;
  scopeQuery: string;
  /** First page still in flight — skeleton rows rather than "nothing matches". */
  loading?: boolean;
}) {
  const columns = useMemo<ColumnDef<AccountSeries, unknown>[]>(
    () => [
      {
        id: 'ownerName',
        header: 'Owner',
        enableSorting: SORTABLE.has('ownerName'),
        meta: {
          className: 'max-w-[280px]',
          help: 'The business the county has on record at this location. Click a name to open its year-by-year history.',
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Link
            href={`/accounts/${encodeURIComponent(row.original.accountId)}?${scopeQuery}`}
            className={cn(
              'block truncate font-medium underline-offset-2',
              'hover:text-[var(--color-accent)] hover:underline',
              'outline-none focus-visible:text-[var(--color-accent)] focus-visible:underline',
            )}
            title={row.original.ownerName ?? undefined}
          >
            {row.original.ownerName ?? '—'}
          </Link>
        ),
      },
      {
        id: 'accountId',
        header: 'Account',
        enableSorting: false,
        meta: {
          help: "The county's own reference number for this location. Use it to look the record up on the appraisal district's website.",
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="tabular text-[var(--color-ink-secondary)]">
            {row.original.accountId}
          </span>
        ),
      },
      {
        id: 'siteCity',
        header: 'City',
        enableSorting: false,
        meta: {
          help: 'Where the equipment physically sits — not necessarily where the company is headquartered.',
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-[var(--color-ink-secondary)]">{row.original.siteCity ?? '—'}</span>
        ),
      },
      {
        id: 'stateClass',
        header: 'Type',
        enableSorting: false,
        meta: {
          help: "The state's category code for the property. L1 is ordinary commercial equipment, L2 industrial; other codes cover dealers, utilities and pipelines, which are appraised under different rules.",
        } satisfies ColumnMeta,
        cell: ({ row }) => <StateClassCell stateClass={row.original.stateClass} />,
      },
      {
        id: 'latestAssessedValue',
        header: 'Equipment value',
        meta: {
          align: 'right',
          help: 'What the county says this business’s equipment, furniture, fixtures and inventory are worth this tax year. The tax bill is a percentage of it.',
        } satisfies ColumnMeta,
        cell: ({ row }) => moneyExact(row.original.latestAssessedValue),
      },
      {
        id: 'yearsUnfiled',
        header: 'Years missed',
        meta: {
          align: 'right',
          help: 'Businesses must declare their equipment to the county every year — a rendition in Texas, a tangible personal property return in Florida. This is how many years this account skipped it, out of the years it has been on the county’s books.',
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-[var(--color-ink-secondary)]">
            {count(row.original.yearsUnfiled)} / {count(row.original.yearsOnRoll)}
          </span>
        ),
      },
      {
        id: 'estimatedAnnualPenalty',
        header: 'Penalty / yr',
        meta: {
          align: 'right',
          help: 'Skipping the declaration adds a 10% penalty on top of the tax bill. This is what that costs the business in one year, estimated at the county’s blended tax rate.',
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-medium">{moneyExact(row.original.estimatedAnnualPenalty)}</span>
        ),
      },
      {
        id: 'estimatedLifetimePenalty',
        header: 'Penalty to date',
        meta: {
          align: 'right',
          help: 'Every missed year’s penalty added together, across the whole period this account appears in the data.',
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-[var(--color-ink-secondary)]">
            {moneyExact(row.original.estimatedLifetimePenalty)}
          </span>
        ),
      },
      {
        id: 'flags',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.segments.includes('core_icp') ? (
              <Tooltip title="Best-fit target" content={SEGMENTS.core_icp.description}>
                <Badge tone="accent">Best fit</Badge>
              </Tooltip>
            ) : null}
            {row.original.segments.includes('chronic_nonfiler') ? (
              <Tooltip title="Never files" content={SEGMENTS.chronic_nonfiler.description}>
                <Badge tone="critical">Never files</Badge>
              </Tooltip>
            ) : null}
            {row.original.hasAgent ? (
              <Tooltip title="Has an agent" content={SEGMENTS.agent_represented.description}>
                <Badge>Agent</Badge>
              </Tooltip>
            ) : null}
            {row.original.isFrozen ? (
              <Tooltip title="Frozen value" content={SEGMENTS.frozen_value.description}>
                <Badge tone="warning">Frozen</Badge>
              </Tooltip>
            ) : null}
          </div>
        ),
      },
    ],
    [scopeQuery],
  );

  const sorting: SortingState = [{ id: query.sortBy, desc: query.sortDir === 'desc' }];

  return (
    <DataTable
      columns={columns}
      data={accounts}
      loading={loading}
      getRowId={(account) => account.accountId}
      sorting={sorting}
      onSortingChange={(next) => {
        const first = next[0];
        // Clicking through to "unsorted" is not a state the server has; fall
        // back to the default ordering instead of sending no sort at all.
        if (!first) return onSortChange('estimatedAnnualPenalty', 'desc');
        if (!SORTABLE.has(first.id)) return;
        onSortChange(first.id as AccountSortField, first.desc ? 'desc' : 'asc');
      }}
      maxHeight="max(26rem, calc(100vh - 20rem))"
      pagination={{ offset: query.offset, limit: query.limit, total }}
      onOffsetChange={onOffsetChange}
      empty={{
        title: 'No accounts match these filters',
        children: 'Try removing a segment or widening the value range.',
      }}
    />
  );
}
