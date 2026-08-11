'use client';

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { count } from '@/lib/format';
import { Button } from '@/components/ui/controls';
import { EmptyState } from '@/components/ui/primitives';

/**
 * The table used everywhere rows are listed.
 *
 * TanStack supplies the column model and header/cell rendering. What it
 * deliberately does *not* supply on the large lists is the sorting itself.
 *
 * A page here is 50 rows out of tens of thousands. Sorting client-side would
 * reorder those 50 and present the result as "accounts by penalty" — the top of
 * one arbitrary page, indistinguishable from the top of the roll. That is the
 * kind of confidently wrong answer this codebase exists to avoid, so the large
 * tables run `manualSorting` and hand the field to the server, which sorts the
 * whole result and returns the right page. Small, complete datasets — an
 * account's six years of history — sort in the browser, because there every row
 * is already present and the answer is the same either way.
 */

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  getRowId?: (row: T) => string;
  empty?: { title: string; children?: ReactNode };

  /**
   * Present for server-sorted tables. Supplying these switches the table into
   * manual mode; omitting them sorts in the browser.
   */
  sorting?: SortingState;
  onSortingChange?: (sorting: SortingState) => void;

  /** Present for server-paginated tables. */
  pagination?: { offset: number; limit: number; total: number };
  onOffsetChange?: (offset: number) => void;
}

export function DataTable<T>({
  columns,
  data,
  getRowId,
  empty,
  sorting,
  onSortingChange,
  pagination,
  onOffsetChange,
}: DataTableProps<T>) {
  const server = sorting !== undefined && onSortingChange !== undefined;
  const [clientSorting, setClientSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting: server ? sorting : clientSorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(server ? sorting : clientSorting) : updater;
      if (server) onSortingChange(next);
      else setClientSorting(next);
    },
    manualSorting: server,
    manualPagination: pagination !== undefined,
    getCoreRowModel: getCoreRowModel(),
    ...(server ? {} : { getSortedRowModel: getSortedRowModel() }),
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  if (data.length === 0 && empty) {
    return <EmptyState title={empty.title}>{empty.children}</EmptyState>;
  }

  return (
    <>
      {/* Wide tables scroll inside this box; the page itself never scrolls sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-[var(--color-hairline)]">
                {group.headers.map((header) => {
                  const align = alignOf(header.column.columnDef);
                  const sortable = header.column.getCanSort();
                  const direction = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        !sortable || !direction
                          ? undefined
                          : direction === 'desc'
                            ? 'descending'
                            : 'ascending'
                      }
                      className={cn(
                        'px-3 py-2.5 text-[11px] font-medium tracking-wide whitespace-nowrap text-[var(--color-ink-secondary)] uppercase',
                        align === 'right' ? 'text-right' : 'text-left',
                      )}
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            'group inline-flex items-center gap-1 transition-colors hover:text-[var(--color-ink)]',
                            direction && 'text-[var(--color-ink)]',
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {direction === 'desc' ? (
                            <ArrowDown size={12} strokeWidth={2.5} />
                          ) : direction === 'asc' ? (
                            <ArrowUp size={12} strokeWidth={2.5} />
                          ) : (
                            // Only on hover: a sort affordance on every column
                            // at rest reads as noise across nine headers.
                            <ChevronsUpDown
                              size={12}
                              strokeWidth={2}
                              className="opacity-0 transition-opacity group-hover:opacity-40"
                            />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="border-b border-[var(--color-hairline)] transition-colors last:border-0 hover:bg-[var(--color-plane)]"
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    key={cell.id}
                    className={cn(
                      'px-3 py-2.5',
                      alignOf(cell.column.columnDef) === 'right' && 'tabular text-right',
                      widthOf(cell.column.columnDef),
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && onOffsetChange ? (
        <Pagination {...pagination} onOffsetChange={onOffsetChange} />
      ) : null}
    </>
  );
}

function Pagination({
  offset,
  limit,
  total,
  onOffsetChange,
}: {
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
}) {
  const last = Math.min(offset + limit, total);
  return (
    <footer className="flex items-center justify-between gap-4 border-t border-[var(--color-hairline)] px-5 py-3">
      <p className="tabular text-xs text-[var(--color-ink-secondary)]">
        {total === 0 ? '0' : `${count(offset + 1)}–${count(last)}`} of {count(total)}
      </p>
      <div className="flex gap-2">
        <Button disabled={offset === 0} onClick={() => onOffsetChange(Math.max(0, offset - limit))}>
          Previous
        </Button>
        <Button disabled={last >= total} onClick={() => onOffsetChange(offset + limit)}>
          Next
        </Button>
      </div>
    </footer>
  );
}

/**
 * Presentation hints ride on `meta` so a column definition stays one object.
 * Numeric columns are right-aligned and tabular — a column of money that does
 * not line up on the decimal is hard to scan and easy to misread.
 */
export interface ColumnMeta {
  align?: 'right';
  className?: string;
}

function alignOf(def: { meta?: unknown }): 'right' | undefined {
  return (def.meta as ColumnMeta | undefined)?.align;
}

function widthOf(def: { meta?: unknown }): string | undefined {
  return (def.meta as ColumnMeta | undefined)?.className;
}
