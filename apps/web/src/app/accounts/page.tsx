'use client';

import { useQuery } from '@tanstack/react-query';
import { Download, X } from 'lucide-react';
import { Suspense } from 'react';
import type { AccountQuery, SegmentKey } from '@tangible/types';
import { AccountsTable } from '@/components/accounts-table';
import { Button, ChipGroup, Field, Select, TextInput } from '@/components/ui/controls';
import { Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';
import { useAccountQuery } from '@/hooks/use-account-query';
import { useScope } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count, money } from '@/lib/format';

export default function AccountsPage() {
  return (
    <Suspense
      // The two cards the page settles into: filters, then the table rows.
      fallback={
        <div className="space-y-4">
          <Card>
            <div className="space-y-2 p-5">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-3.5 w-full max-w-lg" />
            </div>
            <div className="px-5 pb-5">
              <Skeleton className="h-16 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-2 p-5">
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="space-y-2 px-5 pb-5">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          </Card>
        </div>
      }
    >
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
  const scopeQuery = scope.linkQuery;

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

  /** Sorting changes the whole result, so page 3 of the old order is meaningless. */
  const handleSort = (sortBy: AccountQuery['sortBy'], sortDir: AccountQuery['sortDir']) => {
    update({ sortBy, sortDir, offset: 0 });
  };

  const total = accounts.data?.total ?? 0;

  const pagePenalty = (accounts.data?.items ?? []).reduce(
    (sum, a) => sum + (a.estimatedAnnualPenalty ?? 0),
    0,
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Filters"
          description="Each account below is one business location's equipment, as the county recorded it."
          help="Narrow the list with the buttons — hover any of them to see what it means. Picking several narrows further: an account has to satisfy every one of the chosen filters."
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
                description: s.description,
                caveat: s.caveat,
              }))}
              selected={query.segments}
              onToggle={(value) => toggleSegment(value as SegmentKey)}
            />
          ) : (
            <Skeleton className="h-7 w-full" />
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field
              label="Search owner or account"
              help="Matches part of a business name or an account number. Case does not matter."
            >
              <TextInput
                placeholder="e.g. machine works"
                defaultValue={query.search ?? ''}
                onChange={(e) => update({ search: e.target.value.trim() || undefined })}
              />
            </Field>

            <Field label="City" help="Where the equipment sits — not where the owner is headquartered.">
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

            <Field
              label="Type of business"
              help="The state's own category code for the property — L1 is commercial equipment, L2 industrial, and so on. It is how you separate an ordinary business from a car dealer or a pipeline."
            >
              <Select
                value={query.stateClasses[0] ?? ''}
                onChange={(e) => update({ stateClasses: e.target.value ? [e.target.value] : [] })}
              >
                <option value="">All types</option>
                {(facets.data?.stateClasses ?? []).map((cls) => (
                  <option key={cls.value} value={cls.value}>
                    {cls.value} · {cls.label} ({count(cls.count)})
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Min equipment value"
              help="Hides accounts the county values below this amount. Penalties scale with value, so a higher floor leaves the accounts where the money is."
            >
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

            <Field
              label="Already has a tax agent"
              help="A tax agent is a firm the business has hired to deal with the county. An account that has one is somebody else's client already."
            >
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
            <Tooltip
              title="Export CSV"
              content="Downloads every account matching the filters above — the whole result, not just the rows on this page. Opens in Excel or Sheets."
            >
              <a href={api.exportUrl(query)} download>
                <Button variant="secondary">
                  <Download size={14} /> Export CSV
                </Button>
              </a>
            </Tooltip>
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
          <AccountsTable
            accounts={accounts.data.items}
            query={query}
            total={total}
            onSortChange={handleSort}
            onOffsetChange={(offset) => update({ offset })}
            scopeQuery={scopeQuery}
          />
        )}
      </Card>
    </div>
  );
}
