'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { AccountQuery, SegmentKey } from '@tangible/types';

const PAGE_SIZE = 50;

/**
 * The account filter, held entirely in the URL.
 *
 * Everything a person narrows down to is therefore in the address bar: a filtered
 * view can be pasted into Slack and it lands on exactly the same rows.
 */
export function useAccountQuery(jurisdictionId: string, taxYear: number) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query: AccountQuery = useMemo(() => {
    const list = (key: string) =>
      (searchParams.get(key) ?? '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);

    const numberOrUndefined = (key: string) => {
      const raw = searchParams.get(key);
      if (raw === null || raw === '') return undefined;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const hasAgentRaw = searchParams.get('hasAgent');

    return {
      jurisdictionId,
      taxYear,
      segments: list('segments') as SegmentKey[],
      search: searchParams.get('search') || undefined,
      cities: list('cities'),
      stateClasses: list('stateClasses'),
      minValue: numberOrUndefined('minValue'),
      maxValue: numberOrUndefined('maxValue'),
      minYearsUnfiled: numberOrUndefined('minYearsUnfiled'),
      hasAgent: hasAgentRaw === null || hasAgentRaw === '' ? undefined : hasAgentRaw === 'true',
      includeExempt: searchParams.get('includeExempt') === 'true',
      sortBy: (searchParams.get('sortBy') as AccountQuery['sortBy']) || 'estimatedAnnualPenalty',
      sortDir: (searchParams.get('sortDir') as AccountQuery['sortDir']) || 'desc',
      limit: PAGE_SIZE,
      offset: numberOrUndefined('offset') ?? 0,
    };
  }, [jurisdictionId, taxYear, searchParams]);

  const update = useCallback(
    (patch: Partial<Record<string, string | number | boolean | string[] | undefined>>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
          params.delete(key);
        } else {
          params.set(key, Array.isArray(value) ? value.join(',') : String(value));
        }
      }

      // Any filter change invalidates the current page position.
      if (!('offset' in patch)) params.delete('offset');

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const toggleSegment = useCallback(
    (segment: SegmentKey) => {
      const next = query.segments.includes(segment)
        ? query.segments.filter((s) => s !== segment)
        : [...query.segments, segment];
      update({ segments: next });
    },
    [query.segments, update],
  );

  const activeFilterCount =
    query.segments.length +
    query.cities.length +
    query.stateClasses.length +
    (query.search ? 1 : 0) +
    (query.minValue !== undefined ? 1 : 0) +
    (query.hasAgent !== undefined ? 1 : 0) +
    (query.includeExempt ? 1 : 0);

  const reset = useCallback(() => {
    const params = new URLSearchParams();
    if (searchParams.get('jurisdictionId')) {
      params.set('jurisdictionId', searchParams.get('jurisdictionId')!);
    }
    if (searchParams.get('taxYear')) params.set('taxYear', searchParams.get('taxYear')!);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  return { query, update, toggleSegment, reset, activeFilterCount, pageSize: PAGE_SIZE };
}
