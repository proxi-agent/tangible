'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { JurisdictionSummary } from '@tangible/types';
import { api } from '@/lib/api';

/** Full names for the states we carry, so a selector never reads "FL". */
const STATE_NAMES: Readonly<Record<string, string>> = {
  FL: 'Florida',
  TX: 'Texas',
};

export function stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}

export interface StateOption {
  code: string;
  name: string;
  /** Counties in this state we can reach, loaded or not. */
  countyCount: number;
  /** Counties with rows in the warehouse. */
  loadedCountyCount: number;
}

export interface Scope {
  stateCode: string;
  jurisdictionId: string;
  taxYear: number;
  /** Every jurisdiction, unfiltered — for pages that summarize across states. */
  jurisdictions: JurisdictionSummary[];
  /** Just the selected state's counties, which is what the county picker shows. */
  countiesInState: JurisdictionSummary[];
  states: StateOption[];
  current: JurisdictionSummary | undefined;
  availableYears: number[];
  /**
   * The whole scope as a query string, for links that have to preserve it.
   *
   * Built here rather than at each call site because it has to carry the state:
   * a link with only a county on it now resolves against whatever state
   * defaults, and a Florida county pasted into a Texas scope silently falls
   * back to a Texas county.
   */
  linkQuery: string;
  isLoading: boolean;
  error: unknown;
  setScope: (patch: { stateCode?: string; jurisdictionId?: string; taxYear?: number }) => void;
}

export function useJurisdictions() {
  return useQuery({ queryKey: ['jurisdictions'], queryFn: api.jurisdictions });
}

/**
 * State, county and tax year live in the URL, so any view a person is looking at
 * can be pasted to someone else and land on the same numbers.
 *
 * The three are a hierarchy rather than three independent filters, and the
 * selectors are only honest if the app enforces that. A county belongs to one
 * state, and a tax year only exists for the counties that published a roll that
 * year — Texas districts go back to 2020 while Florida's DOR posts only the
 * current roll. Picking a value that the level above does not offer is
 * therefore not a state this hook will return: each level falls back to
 * something real whenever the level above it changes underneath it.
 */
export function useScope(): Scope {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data, isLoading, error } = useJurisdictions();

  const jurisdictions = useMemo(() => data ?? [], [data]);

  const states = useMemo((): StateOption[] => {
    const byCode = new Map<string, StateOption>();
    for (const j of jurisdictions) {
      const entry = byCode.get(j.state) ?? {
        code: j.state,
        name: stateName(j.state),
        countyCount: 0,
        loadedCountyCount: 0,
      };
      entry.countyCount += 1;
      if (j.accountCount > 0) entry.loadedCountyCount += 1;
      byCode.set(j.state, entry);
    }
    // States with data first, so the default landing state is one worth looking
    // at; ties break alphabetically rather than by insertion order.
    return [...byCode.values()].sort(
      (a, b) => b.loadedCountyCount - a.loadedCountyCount || a.name.localeCompare(b.name),
    );
  }, [jurisdictions]);

  // The jurisdiction with the most data is the default view, and its state is
  // the default state — so the two defaults always agree with each other.
  const busiest = useMemo(
    () => [...jurisdictions].sort((a, b) => b.accountCount - a.accountCount)[0],
    [jurisdictions],
  );

  const requestedState = searchParams.get('state')?.toUpperCase();
  const stateCode =
    requestedState && states.some((s) => s.code === requestedState)
      ? requestedState
      : (busiest?.state ?? states[0]?.code ?? '');

  const countiesInState = useMemo(
    () => jurisdictions.filter((j) => j.state === stateCode),
    [jurisdictions, stateCode],
  );

  const requestedJurisdiction = searchParams.get('jurisdictionId');
  // A county from another state is ignored rather than honoured: it would show
  // that county's numbers under this state's heading.
  const jurisdictionId =
    countiesInState.find((j) => j.id === requestedJurisdiction)?.id ??
    countiesInState.find((j) => j.accountCount > 0)?.id ??
    countiesInState[0]?.id ??
    '';

  const current = jurisdictions.find((j) => j.id === jurisdictionId);
  const availableYears = current?.availableYears ?? [];

  const yearParam = searchParams.get('taxYear');
  const parsedYear = yearParam ? Number(yearParam) : NaN;
  const taxYear =
    Number.isInteger(parsedYear) &&
    (availableYears.length === 0 || availableYears.includes(parsedYear))
      ? parsedYear
      : (availableYears.at(-1) ?? new Date().getFullYear());

  const setScope = useCallback(
    (patch: { stateCode?: string; jurisdictionId?: string; taxYear?: number }) => {
      const params = new URLSearchParams(searchParams.toString());

      if (patch.stateCode !== undefined) {
        params.set('state', patch.stateCode);
        // Both of the levels below are scoped to the state, so both re-default
        // rather than carrying a county that no longer exists in this list.
        params.delete('jurisdictionId');
        params.delete('taxYear');
      }
      if (patch.jurisdictionId !== undefined) {
        params.set('jurisdictionId', patch.jurisdictionId);
        // The year is only meaningful within a county; let it re-default.
        params.delete('taxYear');
      }
      if (patch.taxYear !== undefined) params.set('taxYear', String(patch.taxYear));

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const linkQuery = useMemo(
    () =>
      new URLSearchParams({
        state: stateCode,
        jurisdictionId,
        taxYear: String(taxYear),
      }).toString(),
    [stateCode, jurisdictionId, taxYear],
  );

  return {
    stateCode,
    jurisdictionId,
    taxYear,
    jurisdictions,
    countiesInState,
    states,
    current,
    availableYears,
    linkQuery,
    isLoading,
    error,
    setScope,
  };
}
