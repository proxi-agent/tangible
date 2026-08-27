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
import { Tooltip } from '@/components/ui/tooltip';

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
  loading,
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
  /** First page still in flight — skeleton rows rather than "nothing matches". */
  loading?: boolean;
}) {
  const columns = useMemo<ColumnDef<OwnerRollup, unknown>[]>(
    () => [
      {
        id: 'ownerName',
        header: 'Owner',
        meta: {
          className: 'max-w-[320px]',
          help: 'The business, with every location it owns rolled into one row. Click a name to see those locations listed individually.',
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <>
            <Link
              href={`/accounts?${scopeQuery}&search=${encodeURIComponent(row.original.ownerName)}`}
              className="block truncate font-medium underline-offset-2 outline-none hover:text-[var(--color-accent)] hover:underline focus-visible:text-[var(--color-accent)] focus-visible:underline"
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
        header: 'Locations',
        meta: {
          align: 'right',
          help: 'How many separate places this business is taxed at. Each one is its own account, and each one owes its own filing.',
        } satisfies ColumnMeta,
        cell: ({ row }) => count(row.original.accountCount),
      },
      {
        id: 'unfiledAccountCount',
        header: 'Missed filings',
        meta: {
          align: 'right',
          help: 'How many of those locations skipped the annual equipment declaration in the selected year.',
        } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-[var(--color-ink-secondary)]">
            {count(row.original.unfiledAccountCount)}
          </span>
        ),
      },
      {
        id: 'totalAssessedValue',
        header: 'Equipment value',
        meta: {
          align: 'right',
          help: 'What the county says this business’s equipment is worth, added up across every location it holds.',
        } satisfies ColumnMeta,
        cell: ({ row }) => moneyExact(row.original.totalAssessedValue),
      },
      {
        id: 'estimatedAnnualPenalty',
        header: 'Penalty / yr',
        meta: {
          align: 'right',
          help: 'The 10% late-filing penalty across all of this business’s locations, for one year. One conversation with the owner covers every one of them.',
        } satisfies ColumnMeta,
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
            {row.original.hasAgent ? (
              <Tooltip
                title="Has an agent"
                content="A tax firm is already on record with the county for at least one of this owner's locations."
              >
                <Badge>Agent</Badge>
              </Tooltip>
            ) : null}
            {row.original.frozenAccountCount > 0 ? (
              <Tooltip
                title="Frozen value"
                content="Locations whose value has not moved in any year observed. Equipment depreciates, so a flat line usually means nobody has updated the number."
              >
                <Badge tone="warning">{row.original.frozenAccountCount} frozen</Badge>
              </Tooltip>
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
      loading={loading}
      getRowId={(owner) => owner.ownerKey}
      sorting={sorting}
      onSortingChange={(next) => {
        const first = next[0];
        if (!first) return onSortChange('estimatedAnnualPenalty', 'desc');
        if (!SORTABLE.has(first.id)) return;
        onSortChange(first.id as OwnerSortField, first.desc ? 'desc' : 'asc');
      }}
      maxHeight="max(26rem, calc(100vh - 20rem))"
      pagination={{ offset, limit, total }}
      onOffsetChange={onOffsetChange}
      empty={{
        title: 'No owners match these filters',
        children: 'Lower the minimum account count, or widen the segment selection.',
      }}
    />
  );
}
