'use client';

import {
  createSortedRowModel,
  flexRender,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { count } from '@/lib/format';
import { Button } from '@/components/ui/controls';
import { EmptyState, Skeleton } from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';

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

/**
 * TanStack v9 wants the feature set declared once, statically, instead of
 * assembled per table out of `get*RowModel` options. Only what is registered
 * here exists on the table instance and ships in the bundle, so this list is
 * the whole of what these tables do.
 *
 * Column visibility is deliberately absent. Nothing here hides a column, and
 * registering the feature to keep calling `row.getVisibleCells()` would be
 * paying for a filter with nothing to filter — the rows below ask for every
 * cell instead.
 *
 * `sortFns` is the registry the default `auto` sort resolves names against. The
 * four registered are the four `auto` can pick; an unregistered name falls back
 * to a plain `<`, which puts "Account 10" above "Account 2".
 *
 * `columnMeta` is a type-only slot — the value is stripped at runtime and only
 * its type is read. It is what makes `columnDef.meta` typed below rather than
 * `unknown`.
 */
const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
  columnMeta: {} as ColumnMeta,
});

/**
 * The column type these tables take. Exported so callers name this component's
 * column rather than the vendor's — a v9 `ColumnDef` leads with the feature set
 * it was built for, which is a detail of this file and not of the pages that
 * list rows.
 *
 * `RowData` is v9's constraint on a row: an object or an array, where v8 would
 * take anything. Every row listed here is a record, so this costs nothing and
 * is where the requirement is stated once.
 */
export type DataTableColumn<T extends RowData> = ColumnDef<typeof features, T, unknown>;

/** Re-exported for the same reason: the pages sort, they do not use TanStack. */
export type { SortingState };

export interface DataTableProps<T extends RowData> {
  columns: DataTableColumn<T>[];
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

  /**
   * Caps the scroll box so a long table does not push the rest of the page
   * off screen. The header stays pinned while the rows move under it, which
   * is the whole point: fifty rows of numbers are unreadable once the column
   * they belong to has scrolled away.
   */
  maxHeight?: string;

  /**
   * While the first page is in flight. Without it a table whose query has not
   * answered yet has an empty `data`, and the empty state announces "nothing
   * matches" about rows it has not seen — an answer, and the wrong one. Skeleton
   * rows say the same thing the truth does: not yet.
   */
  loading?: boolean;
}

export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  empty,
  sorting,
  onSortingChange,
  pagination,
  onOffsetChange,
  maxHeight,
  loading = false,
}: DataTableProps<T>) {
  const server = sorting !== undefined && onSortingChange !== undefined;
  const [clientSorting, setClientSorting] = useState<SortingState>([]);

  // The sorted row model is registered for every table but only runs for some:
  // `manualSorting` short-circuits it back to the unsorted rows, which is the
  // right answer for a server-sorted page — those fifty rows arrived in order
  // and re-sorting them locally would sort the page, not the roll.
  //
  // Pagination is not a registered feature. It is offset-based and server-side
  // all the way down, and the footer below is the whole of it.
  const table = useTable({
    features,
    data,
    columns,
    state: { sorting: server ? sorting : clientSorting },
    onSortingChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(server ? sorting : clientSorting) : updater;
      if (server) onSortingChange(next);
      else setClientSorting(next);
    },
    manualSorting: server,
    // A server-sorted roll is never unsorted — the endpoint always has an
    // ORDER BY — so the default third click, which clears the sort, would
    // announce "no order" and then silently land on the default column. Two
    // states is the truth there. The browser-sorted tables keep the third
    // click, where returning to the order the rows arrived in means something.
    //
    // Multi-sort goes for the same reason: these endpoints take one `sortBy`,
    // and a shift-click would build a second sort the server never applies.
    enableSortingRemoval: !server,
    enableMultiSort: !server,
    getRowId: getRowId ? (row) => getRowId(row) : undefined,
  });

  // Whether anything is still hidden off either edge of the scroll box.
  // Watched rather than computed once: it changes with the window, with the
  // page of data, and with every sideways scroll.
  const scrollBox = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState({ left: false, right: false });
  const syncOverflow = useCallback(() => {
    const box = scrollBox.current;
    if (!box) return;
    setClipped({
      left: box.scrollLeft > 1,
      right: box.scrollLeft + box.clientWidth < box.scrollWidth - 1,
    });
  }, []);
  // `data` is in the dependencies as a trigger, not as a value the body reads:
  // a new page replaces every row, and each new row has to be observed.
  useEffect(() => {
    syncOverflow();
    const box = scrollBox.current;
    if (!box) return;
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(box);
    for (const child of Array.from(box.children)) observer.observe(child);
    return () => observer.disconnect();
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [syncOverflow, data]);

  if (data.length === 0 && empty && !loading) {
    return <EmptyState title={empty.title}>{empty.children}</EmptyState>;
  }

  return (
    <>
      {/* Wide tables scroll inside this box; the page itself never scrolls
          sideways. The box is positioned so the edge fade below can sit over
          it. */}
      <div className="relative">
        {/* A column clipped by the edge of the box looks like the last column,
            not like a column with more behind it — at 1280 the accounts table
            loses "penalty to date" this way with nothing on screen to say so,
            and a reader who does scroll loses the owner name off the left with
            just as little warning. Each fade appears only while that side is
            actually hiding something, and goes as soon as the reader reaches
            the end of it. */}
        {clipped.left ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 z-20 w-10 bg-gradient-to-r from-[var(--color-surface)] to-transparent"
          />
        ) : null}
        {clipped.right ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 z-20 w-10 bg-gradient-to-l from-[var(--color-surface)] to-transparent"
          />
        ) : null}
        <div
          ref={scrollBox}
          onScroll={syncOverflow}
          className={cn('overflow-x-auto', maxHeight && 'overflow-y-auto overscroll-contain')}
          style={maxHeight ? { maxHeight } : undefined}
        >
          <table className="w-full border-collapse text-sm">
            {/* Pinned only when the box scrolls. The wrapper is a scroll
              container either way, so a header stuck to it on a page-scrolled
              table would pin to something that never moves — the appearance of
              a feature with none of the behaviour. The background lives on the
              cells rather than the row because a <tr> cannot reliably carry one
              under position:sticky, and rows sliding through a transparent
              header is worse than no sticky header at all. */}
            <thead className={cn(maxHeight && 'sticky top-0 z-10')}>
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => {
                    const align = alignOf(header.column.columnDef);
                    const sortable = header.column.getCanSort();
                    const direction = header.column.getIsSorted();
                    const help = helpOf(header.column.columnDef);

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
                          'border-b border-[var(--color-hairline)] bg-[var(--color-sunken)]',
                          'text-2xs px-3 py-2 font-semibold tracking-[0.06em] whitespace-nowrap',
                          'text-[var(--color-ink-secondary)] uppercase',
                          align === 'right' ? 'text-right' : 'text-left',
                        )}
                      >
                        {header.isPlaceholder ? null : (
                          <span
                            className={cn(
                              'inline-flex items-center gap-1',
                              // Mirrored on numeric columns so the sort arrow sits
                              // beside the label rather than out over the numbers.
                              align === 'right' && 'flex-row-reverse',
                            )}
                          >
                            {sortable ? (
                              <button
                                type="button"
                                onClick={header.column.getToggleSortingHandler()}
                                aria-label={`Sort by ${headerLabel(header.column.columnDef)}`}
                                className={cn(
                                  'group inline-flex cursor-pointer items-center gap-1 rounded transition-colors',
                                  // The label is 16px tall, which is a fine mouse
                                  // target and a poor thumb one. On touch it grows
                                  // into the padding the cell already has.
                                  'pointer-coarse:min-h-8',
                                  'outline-none hover:text-[var(--color-ink)]',
                                  'focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
                                  align === 'right' && 'flex-row-reverse',
                                  direction && 'text-[var(--color-ink)]',
                                )}
                              >
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {direction === 'desc' ? (
                                  <ArrowDown
                                    size={12}
                                    strokeWidth={2.5}
                                    className="text-[var(--color-accent)]"
                                  />
                                ) : direction === 'asc' ? (
                                  <ArrowUp
                                    size={12}
                                    strokeWidth={2.5}
                                    className="text-[var(--color-accent)]"
                                  />
                                ) : (
                                  // Faint at rest rather than invisible: a header you
                                  // can sort by should look sortable before you happen
                                  // to hover it. It darkens on hover to confirm.
                                  <ChevronsUpDown
                                    size={12}
                                    strokeWidth={2}
                                    className="opacity-25 transition-opacity group-hover:opacity-70"
                                  />
                                )}
                              </button>
                            ) : (
                              flexRender(header.column.columnDef.header, header.getContext())
                            )}

                            {help ? (
                              <InfoTip
                                title={headerLabel(header.column.columnDef)}
                                content={help}
                                size={11}
                              />
                            ) : null}
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {loading && data.length === 0
                ? Array.from({ length: 6 }, (_, index) => (
                    <tr
                      key={`skeleton-${index}`}
                      className="border-b border-[var(--color-hairline)]"
                    >
                      {columns.map((column, columnIndex) => (
                        <td key={columnIndex} className="px-3 py-2.5">
                          <Skeleton
                            className="h-4"
                            style={{ width: `${[70, 55, 85, 45][columnIndex % 4]}%` }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))
                : null}
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--color-hairline)] transition-colors last:border-0 hover:bg-[var(--color-sunken)]"
                >
                  {row.getAllCells().map((cell) => (
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
      </div>

      {pagination && onOffsetChange ? (
        <Pagination
          {...pagination}
          onOffsetChange={onOffsetChange}
          loading={loading && data.length === 0}
        />
      ) : null}
    </>
  );
}

function Pagination({
  offset,
  limit,
  total,
  onOffsetChange,
  loading,
}: {
  offset: number;
  limit: number;
  total: number;
  onOffsetChange: (offset: number) => void;
  loading?: boolean;
}) {
  const last = Math.min(offset + limit, total);
  // Where you are in the whole, not just which rows are on screen. "51–100 of
  // 196,278" leaves the reader doing division to find out whether they are
  // near the front or lost in the middle.
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[var(--color-hairline)] px-4 py-2.5">
      {/* While the first page is in flight the totals are not zero, they are
          unknown — and "0 of 0" is a claim about the result, made before the
          result exists. */}
      <p className="text-xs text-[var(--color-ink-secondary)]">
        {loading ? (
          <span className="text-[var(--color-ink-muted)]">Counting…</span>
        ) : (
          <>
            <span className="tabular font-medium text-[var(--color-ink)]">
              {total === 0 ? '0' : `${count(offset + 1)}–${count(last)}`}
            </span>{' '}
            of <span className="tabular">{count(total)}</span>
          </>
        )}
      </p>

      <div className="flex items-center gap-2">
        <span className="tabular text-xs text-[var(--color-ink-muted)]">
          {loading ? '' : `Page ${count(page)} of ${count(pages)}`}
        </span>
        <Button
          size="sm"
          disabled={loading || offset === 0}
          onClick={() => onOffsetChange(Math.max(0, offset - limit))}
        >
          <ChevronLeft size={13} strokeWidth={2.5} />
          Previous
        </Button>
        <Button
          size="sm"
          disabled={loading || last >= total}
          onClick={() => onOffsetChange(offset + limit)}
        >
          Next
          <ChevronRight size={13} strokeWidth={2.5} />
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
  /**
   * What the column means, for a reader who has never seen an appraisal roll.
   * Rendered as a hoverable explainer beside the header.
   */
  help?: ReactNode;
}

function alignOf(def: { meta?: ColumnMeta }): 'right' | undefined {
  return def.meta?.align;
}

function widthOf(def: { meta?: ColumnMeta }): string | undefined {
  return def.meta?.className;
}

function helpOf(def: { meta?: ColumnMeta }): ReactNode | undefined {
  return def.meta?.help;
}

/** The header, when it is a plain string — used for labels a tooltip can title. */
function headerLabel(def: { header?: unknown }): string {
  return typeof def.header === 'string' ? def.header : 'this column';
}
