'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { Check, Minus, X } from 'lucide-react';
import { useMemo } from 'react';
import type { AccountYearPoint } from '@tangible/types';
import { moneyExact } from '@/lib/format';
import { DataTable, type ColumnMeta } from '@/components/ui/data-table';

/**
 * One account's years.
 *
 * The only table in the app that sorts in the browser, and legitimately so:
 * every row is already here — six of them — so sorting what was delivered and
 * sorting the whole set are the same operation. The large lists are paginated
 * slices and delegate sorting to the server for exactly that reason.
 */
export function HistoryTable({ history }: { history: AccountYearPoint[] }) {
  const columns = useMemo<ColumnDef<AccountYearPoint, unknown>[]>(
    () => [
      {
        id: 'taxYear',
        header: 'Tax year',
        accessorFn: (row) => row.taxYear,
        cell: ({ row }) => <span className="tabular font-medium">{row.original.taxYear}</span>,
      },
      {
        id: 'assessedValue',
        header: 'Assessed value',
        accessorFn: (row) => row.assessedValue ?? 0,
        meta: { align: 'right' } satisfies ColumnMeta,
        cell: ({ row }) => moneyExact(row.original.assessedValue),
      },
      {
        id: 'estimatedTax',
        header: 'Estimated tax',
        accessorFn: (row) => row.estimatedTax ?? 0,
        meta: { align: 'right' } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="text-[var(--color-ink-secondary)]">
            {moneyExact(row.original.estimatedTax)}
          </span>
        ),
      },
      {
        id: 'rendition',
        header: 'Rendition',
        // Sorted by meaning rather than by the boolean: unknown, not filed,
        // late, filed — which is the order someone scanning for exposure wants.
        accessorFn: (row) =>
          row.renditionFiled === null ? 0 : !row.renditionFiled ? 1 : row.renditionLate ? 2 : 3,
        cell: ({ row }) => (
          <RenditionCell filed={row.original.renditionFiled} late={row.original.renditionLate} />
        ),
      },
      {
        id: 'estimatedPenalty',
        header: 'Penalty',
        accessorFn: (row) => row.estimatedPenalty ?? 0,
        meta: { align: 'right' } satisfies ColumnMeta,
        cell: ({ row }) => (
          <span className="font-medium">{moneyExact(row.original.estimatedPenalty)}</span>
        ),
      },
    ],
    [],
  );

  return (
    <DataTable
      columns={columns}
      data={history}
      getRowId={(point) => String(point.taxYear)}
      empty={{ title: 'No history for this account' }}
    />
  );
}

function RenditionCell({ filed, late }: { filed: boolean | null; late: boolean | null }) {
  if (filed === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
        <Minus size={13} /> Not published
      </span>
    );
  }
  if (!filed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-critical)]">
        <X size={13} strokeWidth={2.5} /> Not filed
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${late ? 'text-[var(--color-serious)]' : 'text-[var(--color-good)]'}`}
    >
      <Check size={13} strokeWidth={2.5} /> {late ? 'Filed late' : 'Filed'}
    </span>
  );
}
