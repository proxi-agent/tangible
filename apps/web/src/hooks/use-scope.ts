'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { JurisdictionSummary } from '@tangible/types';
import { api } from '@/lib/api';

export interface Scope {
  jurisdictionId: string;
  taxYear: number;
  jurisdictions: JurisdictionSummary[];
  current: JurisdictionSummary | undefined;
  availableYears: number[];
  isLoading: boolean;
  error: unknown;
  setScope: (patch: { jurisdictionId?: string; taxYear?: number }) => void;
}

export function useJurisdictions() {
  return useQuery({ queryKey: ['jurisdictions'], queryFn: api.jurisdictions });
}

/**
 * Jurisdiction and tax year live in the URL, so any view a person is looking at
 * can be pasted to someone else and land on the same numbers. Defaults fall back
 * to the jurisdiction with the most data and its newest year.
 */
export function useScope(): Scope {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading, error } = useJurisdictions();

  const jurisdictions = useMemo(() => data ?? [], [data]);
  const withData = useMemo(
    () => jurisdictions.filter((j) => j.accountCount > 0),
    [jurisdictions],
  );

  const jurisdictionId =
    searchParams.get('jurisdictionId') ?? withData[0]?.id ?? jurisdictions[0]?.id ?? '';

  const current = jurisdictions.find((j) => j.id === jurisdictionId);
  const availableYears = current?.availableYears ?? [];

  const yearParam = searchParams.get('taxYear');
  const parsedYear = yearParam ? Number(yearParam) : NaN;
  const taxYear =
    Number.isInteger(parsedYear) && (availableYears.length === 0 || availableYears.includes(parsedYear))
      ? parsedYear
      : (availableYears.at(-1) ?? new Date().getFullYear());

  const setScope = useCallback(
    (patch: { jurisdictionId?: string; taxYear?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (patch.jurisdictionId !== undefined) {
        params.set('jurisdictionId', patch.jurisdictionId);
        // The year is only meaningful within a jurisdiction; let it re-default.
        params.delete('taxYear');
      }
      if (patch.taxYear !== undefined) params.set('taxYear', String(patch.taxYear));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  return {
    jurisdictionId,
    taxYear,
    jurisdictions,
    current,
    availableYears,
    isLoading,
    error,
    setScope,
  };
}
