'use client';

import type { ColumnDef, SortingState } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';
import {
  ACCOUNT_SORT_FIELDS,
  type AccountQuery,
  type AccountSeries,
  type AccountSortField,
} from '@tangible/types';
import { count, moneyExact } from '@/lib/format';
import { Badge } from '@/components/ui/primitives';
import { DataTable, type ColumnMeta } from '@/components/ui/data-table';

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
}: {
  accounts: AccountSeries[];
  query: AccountQuery;
  total: number;
  onSortChange: (sortBy: AccountSortField, sortDir: 'asc' | 'desc') => void;
  onOffsetChange: (offset: number) => void;
  scopeQuery: string;
}) {
  const columns = useMemo<ColumnDef<AccountSeries, unknown>[]>(
    () => [
      {
        id: 'ownerName',
        header: 'Owner',
        enableSorting: SORTABLE.has('ownerName'),
        meta: { className: 'max-w-[280px]' } satisfies ColumnMeta,
        cell: ({ row }) => (
          <Link
            href={`/accounts/${encodeURIComponent(row.original.accountId)}?${scopeQuery}`}
            className="block truncate font-medium hover:underline"
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
        cell: ({ row }) => (
          <span className="text-[var(--color-ink-secondary)]">{row.original.siteCity ?? '—'}</span>
        ),
      },
      {
        id: 'stateClass',
        header: 'Class',
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-[var(--color-ink-secondary)]">{row.original.stateClass ?? '—'}</span>
        ),
      },
      {
        id: 'latestAssessedValue',
        header: 'Assessed value',
        meta: { align: 'right' } satisfies ColumnMeta,
        cell: ({ row }) => moneyExact(row.original.latestAssessedValue),
      },
      {
        id: 'yearsUnfiled',
        header: 'Unfiled / on roll',
        meta: { align: 'right' } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-[var(--color-ink-secondary)]">
            {count(row.original.yearsUnfiled)} / {count(row.original.yearsOnRoll)}
          </span>
        ),
      },
      {
        id: 'estimatedAnnualPenalty',
        header: 'Penalty / yr',
        meta: { align: 'right' } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-medium">{moneyExact(row.original.estimatedAnnualPenalty)}</span>
        ),
      },
      {
        id: 'estimatedLifetimePenalty',
        header: 'Penalty to date',
        meta: { align: 'right' } satisfies ColumnMeta,
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
            {row.original.segments.includes('core_icp') ? <Badge tone="accent">Core ICP</Badge> : null}
            {row.original.segments.includes('chronic_nonfiler') ? (
              <Badge tone="critical">Chronic</Badge>
            ) : null}
            {row.original.hasAgent ? <Badge>Agent</Badge> : null}
            {row.original.isFrozen ? <Badge tone="warning">Frozen</Badge> : null}
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
      pagination={{ offset: query.offset, limit: query.limit, total }}
      onOffsetChange={onOffsetChange}
      empty={{
        title: 'No accounts match these filters',
        children: 'Try removing a segment or widening the value range.',
      }}
    />
  );
}
