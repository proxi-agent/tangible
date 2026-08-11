'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';
import type { SegmentKey } from '@tangible/types';
import { Badge, Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { Button, ChipGroup, Field, Select, TextInput } from '@/components/ui/controls';
import { useScope } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count, moneyExact } from '@/lib/format';

const PAGE_SIZE = 50;

export default function OwnersPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <Owners />
    </Suspense>
  );
}

function Owners() {
  const scope = useScope();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const segments = (searchParams.get('segments') ?? 'unfiled')
    .split(',')
    .filter(Boolean) as SegmentKey[];
  const minAccounts = Number(searchParams.get('minAccounts') ?? 2);
  const search = searchParams.get('search') ?? '';
  const offset = Number(searchParams.get('offset') ?? 0);
  const scopeQuery = `jurisdictionId=${scope.jurisdictionId}&taxYear=${scope.taxYear}`;

  const update = (patch: Record<string, string | number | string[] | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
        params.delete(key);
      } else {
        params.set(key, Array.isArray(value) ? value.join(',') : String(value));
      }
    }
    if (!('offset' in patch)) params.delete('offset');
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const segmentDefs = useQuery({ queryKey: ['segments'], queryFn: api.segments });
  const owners = useQuery({
    queryKey: ['owners', scope.jurisdictionId, scope.taxYear, segments, minAccounts, search, offset],
    queryFn: () =>
      api.owners({
        jurisdictionId: scope.jurisdictionId,
        taxYear: scope.taxYear,
        segments,
        minAccounts,
        search: search || undefined,
        limit: PAGE_SIZE,
        offset,
      }),
    enabled: Boolean(scope.jurisdictionId),
  });

  const total = owners.data?.total ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Multi-account owners"
          description="A business with twelve locations carries twelve penalties. One conversation covers all of them, which makes the entity — not the account — the unit worth contacting."
        />
        <div className="space-y-4 p-5">
          {segmentDefs.data ? (
            <ChipGroup
              options={segmentDefs.data.map((s) => ({
                value: s.key,
                label: s.label,
                hint: s.caveat ?? s.description,
              }))}
              selected={segments}
              onToggle={(value) =>
                update({
                  segments: segments.includes(value as SegmentKey)
                    ? segments.filter((s) => s !== value)
                    : [...segments, value as SegmentKey],
                })
              }
            />
          ) : (
            <Skeleton className="h-7 w-full" />
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Search owner">
              <TextInput
                placeholder="e.g. logistics"
                defaultValue={search}
                onChange={(e) => update({ search: e.target.value.trim() || undefined })}
              />
            </Field>
            <Field label="Minimum accounts held">
              <Select value={minAccounts} onChange={(e) => update({ minAccounts: e.target.value })}>
                {[1, 2, 3, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n}+
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={owners.data ? `${count(total)} owners` : 'Owners'} />

        {owners.error ? (
          <ErrorState error={owners.error} />
        ) : owners.isPending ? (
          <div className="space-y-2 p-5">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : owners.data.items.length === 0 ? (
          <EmptyState title="No owners match these filters">
            Lower the minimum account count, or widen the segment selection.
          </EmptyState>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-hairline)]">
                    {['Owner', 'Accounts', 'Did not file', 'Assessed value', 'Penalty / yr', ''].map(
                      (header, i) => (
                        <th
                          key={header || i}
                          scope="col"
                          className={`px-3 py-2.5 text-[11px] font-medium tracking-wide whitespace-nowrap text-[var(--color-ink-secondary)] uppercase ${i === 0 || i === 5 ? 'text-left' : 'text-right'}`}
                        >
                          {header}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {owners.data.items.map((owner) => (
                    <tr
                      key={owner.ownerKey}
                      className="border-b border-[var(--color-hairline)] transition-colors last:border-0 hover:bg-[var(--color-plane)]"
                    >
                      <td className="max-w-[320px] px-3 py-2.5">
                        <Link
                          href={`/accounts?${scopeQuery}&search=${encodeURIComponent(owner.ownerName)}`}
                          className="block truncate font-medium hover:underline"
                          title={owner.ownerName}
                        >
                          {owner.ownerName}
                        </Link>
                        <p className="truncate text-xs text-[var(--color-ink-muted)]">
                          {owner.cities.slice(0, 3).join(', ')}
                          {owner.cities.length > 3 ? ` +${owner.cities.length - 3}` : ''}
                        </p>
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">{count(owner.accountCount)}</td>
                      <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-secondary)]">
                        {count(owner.unfiledAccountCount)}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right">
                        {moneyExact(owner.totalAssessedValue)}
                      </td>
                      <td className="tabular px-3 py-2.5 text-right font-medium">
                        {moneyExact(owner.estimatedAnnualPenalty)}
                      </td>
                      <td className="px-3 py-2.5">
                        {owner.hasAgent ? <Badge>Agent</Badge> : null}
                        {owner.frozenAccountCount > 0 ? (
                          <Badge tone="warning">{owner.frozenAccountCount} frozen</Badge>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <footer className="flex items-center justify-between gap-4 border-t border-[var(--color-hairline)] px-5 py-3">
              <p className="tabular text-xs text-[var(--color-ink-secondary)]">
                {count(offset + 1)}–{count(Math.min(offset + PAGE_SIZE, total))} of {count(total)}
              </p>
              <div className="flex gap-2">
                <Button
                  disabled={offset === 0}
                  onClick={() => update({ offset: Math.max(0, offset - PAGE_SIZE) })}
                >
                  Previous
                </Button>
                <Button
                  disabled={offset + PAGE_SIZE >= total}
                  onClick={() => update({ offset: offset + PAGE_SIZE })}
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
