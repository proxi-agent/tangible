'use client';

import type { ColumnDef, SortingState } from '@tanstack/react-table';
import Link from 'next/link';
import { useMemo } from 'react';
import {
  OWNER_SORT_FIELDS,
  type OwnerRollup,
  type OwnerSortField,
  type SortDirection,
} from '@tangible/types';
import { count, moneyExact } from '@/lib/format';
import { Badge } from '@/components/ui/primitives';
import { DataTable, type ColumnMeta } from '@/components/ui/data-table';

const SORTABLE = new Set<string>(OWNER_SORT_FIELDS);

/**
 * Owners rolled up from their accounts. A business with twelve locations carries
 * twelve penalties, so this is the list an outbound campaign actually works
 * from — which is why it needed sorting by more than the default.
 */
export function OwnersTable({
  owners,
  total,
  offset,
  limit,
  sortBy,
  sortDir,
  onSortChange,
  onOffsetChange,
  scopeQuery,
}: {
  owners: OwnerRollup[];
  total: number;
  offset: number;
  limit: number;
  sortBy: OwnerSortField;
  sortDir: SortDirection;
  onSortChange: (sortBy: OwnerSortField, sortDir: SortDirection) => void;
  onOffsetChange: (offset: number) => void;
  scopeQuery: string;
}) {
  const columns = useMemo<ColumnDef<OwnerRollup, unknown>[]>(
    () => [
      {
        id: 'ownerName',
        header: 'Owner',
        meta: { className: 'max-w-[320px]' } satisfies ColumnMeta,
        cell: ({ row }) => (
          <>
            <Link
              href={`/accounts?${scopeQuery}&search=${encodeURIComponent(row.original.ownerName)}`}
              className="block truncate font-medium hover:underline"
              title={row.original.ownerName}
            >
              {row.original.ownerName}
            </Link>
            <p className="truncate text-xs text-[var(--color-ink-muted)]">
              {row.original.cities.slice(0, 3).join(', ')}
              {row.original.cities.length > 3 ? ` +${row.original.cities.length - 3}` : ''}
            </p>
          </>
        ),
      },
      {
        id: 'accountCount',
        header: 'Accounts',
        meta: { align: 'right' } satisfies ColumnMeta,
        cell: ({ row }) => count(row.original.accountCount),
      },
      {
        id: 'unfiledAccountCount',
        header: 'Did not file',
        meta: { align: 'right' } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-[var(--color-ink-secondary)]">
            {count(row.original.unfiledAccountCount)}
          </span>
        ),
      },
      {
        id: 'totalAssessedValue',
        header: 'Assessed value',
        meta: { align: 'right' } satisfies ColumnMeta,
        cell: ({ row }) => moneyExact(row.original.totalAssessedValue),
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
        id: 'flags',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.hasAgent ? <Badge>Agent</Badge> : null}
            {row.original.frozenAccountCount > 0 ? (
              <Badge tone="warning">{row.original.frozenAccountCount} frozen</Badge>
            ) : null}
          </div>
        ),
      },
    ],
    [scopeQuery],
  );

  const sorting: SortingState = [{ id: sortBy, desc: sortDir === 'desc' }];

  return (
    <DataTable
      columns={columns}
      data={owners}
      getRowId={(owner) => owner.ownerKey}
      sorting={sorting}
      onSortingChange={(next) => {
        const first = next[0];
        if (!first) return onSortChange('estimatedAnnualPenalty', 'desc');
        if (!SORTABLE.has(first.id)) return;
        onSortChange(first.id as OwnerSortField, first.desc ? 'desc' : 'asc');
      }}
      pagination={{ offset, limit, total }}
      onOffsetChange={onOffsetChange}
      empty={{
        title: 'No owners match these filters',
        children: 'Lower the minimum account count, or widen the segment selection.',
      }}
    />
  );
}
