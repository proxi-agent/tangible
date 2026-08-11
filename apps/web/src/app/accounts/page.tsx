'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, X } from 'lucide-react';
import { Suspense } from 'react';
import type { AccountQuery, SegmentKey } from '@tangible/types';
import { AccountsTable } from '@/components/accounts-table';
import { Button, ChipGroup, Field, Select, TextInput } from '@/components/ui/controls';
import { Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useAccountQuery } from '@/hooks/use-account-query';
import { useScope } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count, money } from '@/lib/format';

export default function AccountsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Accounts />
    </Suspense>
  );
}

function Accounts() {
  const scope = useScope();
  const { jurisdictionId, taxYear } = scope;
  const { query, update, toggleSegment, reset, activeFilterCount, pageSize } = useAccountQuery(
    jurisdictionId,
    taxYear,
  );
  const enabled = Boolean(jurisdictionId);
  const scopeQuery = `jurisdictionId=${jurisdictionId}&taxYear=${taxYear}`;

  const segments = useQuery({ queryKey: ['segments'], queryFn: api.segments });
  const facets = useQuery({
    queryKey: ['facets', jurisdictionId, taxYear],
    queryFn: () => api.facets(jurisdictionId, taxYear),
    enabled,
  });
  const accounts = useQuery({
    queryKey: ['accounts', query],
    queryFn: () => api.accounts(query),
    enabled,
  });

  const handleSort = (field: AccountQuery['sortBy']) => {
    const sortDir = query.sortBy === field && query.sortDir === 'desc' ? 'asc' : 'desc';
    update({ sortBy: field, sortDir });
  };

  const total = accounts.data?.total ?? 0;
  const pageStart = total === 0 ? 0 : query.offset + 1;
  const pageEnd = Math.min(query.offset + pageSize, total);

  const pagePenalty = (accounts.data?.items ?? []).reduce(
    (sum, a) => sum + (a.estimatedAnnualPenalty ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Filters"
          description="Segments combine with AND — an account must satisfy every one selected."
          action={
            activeFilterCount > 0 ? (
              <Button variant="ghost" onClick={reset}>
                <X size={14} /> Clear {activeFilterCount}
              </Button>
            ) : null
          }
        />

        <div className="space-y-4 p-5">
          {segments.data ? (
            <ChipGroup
              options={segments.data.map((s) => ({
                value: s.key,
                label: s.label,
                hint: s.caveat ?? s.description,
              }))}
              selected={query.segments}
              onToggle={(value) => toggleSegment(value as SegmentKey)}
            />
          ) : (
            <Skeleton className="h-7 w-full" />
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Search owner or account">
              <TextInput
                placeholder="e.g. machine works"
                defaultValue={query.search ?? ''}
                onChange={(e) => update({ search: e.target.value.trim() || undefined })}
              />
            </Field>

            <Field label="City">
              <Select
                value={query.cities[0] ?? ''}
                onChange={(e) => update({ cities: e.target.value ? [e.target.value] : [] })}
              >
                <option value="">All cities</option>
                {(facets.data?.cities ?? []).map((city) => (
                  <option key={city.value} value={city.value}>
                    {city.value} ({count(city.count)})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="State class">
              <Select
                value={query.stateClasses[0] ?? ''}
                onChange={(e) => update({ stateClasses: e.target.value ? [e.target.value] : [] })}
              >
                <option value="">All classes</option>
                {(facets.data?.stateClasses ?? []).map((cls) => (
                  <option key={cls.value} value={cls.value}>
                    {cls.value} · {cls.label} ({count(cls.count)})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Min assessed value">
              <TextInput
                type="number"
                min={0}
                step={25000}
                placeholder="Any"
                defaultValue={query.minValue ?? ''}
                onChange={(e) => update({ minValue: e.target.value || undefined })}
                className="tabular"
              />
            </Field>

            <Field label="Tax agent">
              <Select
                value={query.hasAgent === undefined ? '' : String(query.hasAgent)}
                onChange={(e) => update({ hasAgent: e.target.value || undefined })}
              >
                <option value="">Either</option>
                <option value="false">No agent on record</option>
                <option value="true">Agent on record</option>
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={accounts.data ? `${count(total)} accounts` : 'Accounts'}
          description={
            accounts.data && accounts.data.items.length > 0
              ? `${money(pagePenalty)} in annual penalties across the ${count(accounts.data.items.length)} accounts on this page`
              : undefined
          }
          action={
            <a href={api.exportUrl(query)} download>
              <Button variant="secondary">
                <Download size={14} /> Export CSV
              </Button>
            </a>
          }
        />

        {accounts.error ? (
          <ErrorState error={accounts.error} />
        ) : accounts.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <>
            <AccountsTable
              accounts={accounts.data.items}
              query={query}
              onSort={handleSort}
              scopeQuery={scopeQuery}
            />

            <footer className="flex items-center justify-between gap-4 border-t border-[var(--color-hairline)] px-5 py-3">
              <p className="tabular text-xs text-[var(--color-ink-secondary)]">
                {count(pageStart)}–{count(pageEnd)} of {count(total)}
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={query.offset === 0}
                  onClick={() => update({ offset: Math.max(0, query.offset - pageSize) })}
                >
                  Previous
                </Button>
                <Button
                  disabled={pageEnd >= total}
                  onClick={() => update({ offset: query.offset + pageSize })}
                >
                  Next
                </Button>
              </div>
            </footer>
          </>
        )}
      </Card>
    </div>
  );
}
