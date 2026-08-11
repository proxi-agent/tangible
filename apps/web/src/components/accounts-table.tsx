'use client';

import { ArrowDown, ArrowUp } from 'lucide-react';
import Link from 'next/link';
import type { AccountQuery, AccountSeries } from '@tangible/types';
import { cn } from '@/lib/cn';
import { count, moneyExact } from '@/lib/format';
import { Badge, EmptyState } from '@/components/ui/primitives';

type SortField = AccountQuery['sortBy'];

const COLUMNS: {
  key: string;
  label: string;
  sortBy?: SortField;
  align?: 'right';
  className?: string;
}[] = [
  { key: 'owner', label: 'Owner', sortBy: 'ownerName' },
  { key: 'account', label: 'Account' },
  { key: 'city', label: 'City' },
  { key: 'class', label: 'Class' },
  { key: 'value', label: 'Assessed value', sortBy: 'latestAssessedValue', align: 'right' },
  { key: 'years', label: 'Unfiled / on roll', sortBy: 'yearsUnfiled', align: 'right' },
  { key: 'penalty', label: 'Penalty / yr', sortBy: 'estimatedAnnualPenalty', align: 'right' },
  {
    key: 'lifetime',
    label: 'Penalty to date',
    sortBy: 'estimatedLifetimePenalty',
    align: 'right',
  },
  { key: 'flags', label: '' },
];

export function AccountsTable({
  accounts,
  query,
  onSort,
  scopeQuery,
}: {
  accounts: AccountSeries[];
  query: AccountQuery;
  onSort: (field: SortField) => void;
  scopeQuery: string;
}) {
  if (accounts.length === 0) {
    return (
      <EmptyState title="No accounts match these filters">
        Try removing a segment or widening the value range.
      </EmptyState>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-[var(--color-hairline)]">
            {COLUMNS.map((column) => {
              const active = column.sortBy && query.sortBy === column.sortBy;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    'px-3 py-2.5 text-[11px] font-medium tracking-wide whitespace-nowrap text-[var(--color-ink-secondary)] uppercase',
                    column.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {column.sortBy ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.sortBy!)}
                      className={cn(
                        'inline-flex items-center gap-1 transition-colors hover:text-[var(--color-ink)]',
                        active && 'text-[var(--color-ink)]',
                      )}
                    >
                      {column.label}
                      {active ? (
                        query.sortDir === 'desc' ? (
                          <ArrowDown size={12} strokeWidth={2.5} />
                        ) : (
                          <ArrowUp size={12} strokeWidth={2.5} />
                        )
                      ) : null}
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>

        <tbody>
          {accounts.map((account) => (
            <tr
              key={account.accountId}
              className="border-b border-[var(--color-hairline)] transition-colors last:border-0 hover:bg-[var(--color-plane)]"
            >
              <td className="max-w-[280px] px-3 py-2.5">
                <Link
                  href={`/accounts/${encodeURIComponent(account.accountId)}?${scopeQuery}`}
                  className="block truncate font-medium hover:underline"
                  title={account.ownerName ?? undefined}
                >
                  {account.ownerName ?? '—'}
                </Link>
              </td>
              <td className="tabular px-3 py-2.5 text-[var(--color-ink-secondary)]">
                {account.accountId}
              </td>
              <td className="px-3 py-2.5 text-[var(--color-ink-secondary)]">
                {account.siteCity ?? '—'}
              </td>
              <td className="px-3 py-2.5 text-[var(--color-ink-secondary)]">
                {account.stateClass ?? '—'}
              </td>
              <td className="tabular px-3 py-2.5 text-right">
                {moneyExact(account.latestAssessedValue)}
              </td>
              <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-secondary)]">
                {count(account.yearsUnfiled)} / {count(account.yearsOnRoll)}
              </td>
              <td className="tabular px-3 py-2.5 text-right font-medium">
                {moneyExact(account.estimatedAnnualPenalty)}
              </td>
              <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-secondary)]">
                {moneyExact(account.estimatedLifetimePenalty)}
              </td>
              <td className="px-3 py-2.5">
                <div className="flex flex-wrap gap-1">
                  {account.segments.includes('core_icp') ? (
                    <Badge tone="accent">Core ICP</Badge>
                  ) : null}
                  {account.segments.includes('chronic_nonfiler') ? (
                    <Badge tone="critical">Chronic</Badge>
                  ) : null}
                  {account.hasAgent ? <Badge>Agent</Badge> : null}
                  {account.isFrozen ? <Badge tone="warning">Frozen</Badge> : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
