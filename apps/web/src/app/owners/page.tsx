'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  OwnerSortFieldSchema,
  SortDirectionSchema,
  type SegmentKey,
} from '@tangible/types';
import { Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { OwnersTable } from '@/components/owners-table';
import { ChipGroup, Field, Select, TextInput } from '@/components/ui/controls';
import { useScope } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count } from '@/lib/format';

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
  const sortBy = OwnerSortFieldSchema.catch('estimatedAnnualPenalty').parse(
    searchParams.get('sortBy'),
  );
  const sortDir = SortDirectionSchema.catch('desc').parse(searchParams.get('sortDir'));
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
    queryKey: [
      'owners',
      scope.jurisdictionId,
      scope.taxYear,
      segments,
      minAccounts,
      search,
      sortBy,
      sortDir,
      offset,
    ],
    queryFn: () =>
      api.owners({
        jurisdictionId: scope.jurisdictionId,
        taxYear: scope.taxYear,
        segments,
        minAccounts,
        search: search || undefined,
        sortBy,
        sortDir,
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
        ) : (
          <OwnersTable
            owners={owners.data.items}
            total={total}
            offset={offset}
            limit={PAGE_SIZE}
            sortBy={sortBy}
            sortDir={sortDir}
            onSortChange={(nextSortBy, nextSortDir) =>
              // A different order is a different result set, so page 3 of the
              // old one has nothing to do with page 3 of the new one.
              update({ sortBy: nextSortBy, sortDir: nextSortDir, offset: 0 })
            }
            onOffsetChange={(next) => update({ offset: next })}
            scopeQuery={scopeQuery}
          />
        )}
      </Card>
    </div>
  );
}
