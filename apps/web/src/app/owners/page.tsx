'use client';

import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { OwnerSortFieldSchema, SortDirectionSchema, type SegmentKey } from '@tangible/types';
import { Card, CardHeader, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { OwnersTable } from '@/components/owners-table';
import { Button, ChipGroup, Field, Select, TextInput } from '@/components/ui/controls';
import { useScope } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count, money, plural } from '@/lib/format';

const PAGE_SIZE = 50;

export default function OwnersPage() {
  return (
    <Suspense
      // Filters card over table rows — the page's settled shape.
      fallback={
        <div className="space-y-4">
          <Card>
            <div className="space-y-2 p-5">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-3.5 w-full max-w-lg" />
            </div>
            <div className="px-5 pb-5">
              <Skeleton className="h-16 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-2 p-5">
              <Skeleton className="h-5 w-28" />
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
      <Owners />
    </Suspense>
  );
}

function Owners() {
  const scope = useScope();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Non-filers are the point of this page, so that is what it opens on — but
   * only where the county publishes who filed. All but two of the counties
   * loaded here do not, and opening them on a filing filter meant landing on
   * "0 owners" for a query that cannot match anything, which reads as "this
   * county is clean" rather than "this county does not say". Those open on
   * taxable owners instead, which is the largest question their data can
   * actually answer.
   */
  const defaultSegment: SegmentKey = scope.current?.publishesFilingStatus ? 'unfiled' : 'taxable';
  const segments = (searchParams.get('segments') ?? defaultSegment)
    .split(',')
    .filter(Boolean) as SegmentKey[];
  const minAccounts = Number(searchParams.get('minAccounts') ?? 2);
  const search = searchParams.get('search') ?? '';
  const offset = Number(searchParams.get('offset') ?? 0);
  const sortBy = OwnerSortFieldSchema.catch('estimatedAnnualPenalty').parse(
    searchParams.get('sortBy'),
  );
  const sortDir = SortDirectionSchema.catch('desc').parse(searchParams.get('sortDir'));
  const scopeQuery = scope.linkQuery;

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
  const page = owners.data?.items ?? [];

  /**
   * How far the reader has moved from where the page opened. The twin accounts
   * page has had this since it shipped, and the reason applies here too: a
   * filter set narrow enough to return nothing looks identical to a county with
   * nothing in it, and the way out is a button that says how many choices are
   * standing between the reader and the whole list.
   */
  const narrowed =
    (segments.join(',') === defaultSegment ? 0 : 1) +
    (minAccounts === 2 ? 0 : 1) +
    (search ? 1 : 0);

  /**
   * The text boxes below are uncontrolled — they have to be, or every keystroke
   * would round-trip through the URL and lose the caret. That makes clearing
   * the filters a half-move: the query goes but the typed word stays sitting in
   * a box that is no longer filtering on it. Bumping this remounts them, so the
   * boxes end up saying what the results are actually showing.
   */
  const [cleared, setCleared] = useState(0);

  const reset = () => {
    update({ segments: undefined, minAccounts: undefined, search: undefined });
    setCleared((n) => n + 1);
  };

  // The page's own totals, said in the two units this page is about: what the
  // penalties come to, and how many locations one conversation would cover.
  const pagePenalty = page.reduce((sum, owner) => sum + owner.estimatedAnnualPenalty, 0);
  const pageLocations = page.reduce((sum, owner) => sum + owner.accountCount, 0);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Multi-account owners"
        description="The same businesses as the accounts page, rolled up to the entity that answers the phone. A business with twelve locations carries twelve penalties, and one conversation covers all of them — which makes the entity, not the account, the unit worth contacting."
      />

      <Card>
        <CardHeader
          title="Filters"
          help="Narrow the list with the buttons — hover any of them to see what it means. Picking several narrows further: an owner has to satisfy every one of the chosen filters."
          action={
            narrowed > 0 ? (
              <Button variant="ghost" onClick={reset}>
                <X size={14} /> Clear {narrowed}
              </Button>
            ) : null
          }
        />
        <div className="space-y-4 p-5">
          {segmentDefs.data ? (
            <ChipGroup
              options={segmentDefs.data.map((s) => ({
                value: s.key,
                label: s.label,
                description: s.description,
                caveat: s.caveat,
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

          <div key={cleared} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label="Search owner"
              help="Matches part of a business name. Case does not matter."
            >
              <TextInput
                placeholder="e.g. logistics"
                defaultValue={search}
                onChange={(e) => update({ search: e.target.value.trim() || undefined })}
              />
            </Field>
            <Field
              label="Minimum locations"
              help="Hides businesses with fewer locations than this. Raise it to find the operators where one conversation covers many penalties at once."
            >
              <Select value={minAccounts} onChange={(e) => update({ minAccounts: e.target.value })}>
                {[1, 2, 3, 5, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n === 1 ? 'Any (1+)' : `${n}+ locations`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title={owners.data ? `${count(total)} owners` : 'Owners'}
          description={
            page.length > 0
              ? `${money(pagePenalty)} in annual penalties across the ${count(page.length)} ${plural(page.length, 'owner')} on this page, covering ${count(pageLocations)} ${plural(pageLocations, 'location')}`
              : undefined
          }
        />

        {owners.error ? (
          <ErrorState error={owners.error} />
        ) : (
          /* The table draws its own loading state — skeleton rows beneath the
             real column headings — rather than a stack of bars that says
             nothing about what is arriving. */
          <OwnersTable
            loading={owners.isPending}
            owners={owners.data?.items ?? []}
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
