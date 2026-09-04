'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ClientDetail, Engagement, PortalStage } from '@tangible/types';
import { emptyPortalStage } from '@tangible/types';
import { api } from '@/lib/api';
import { useViewer } from '@/components/viewer-context';

/**
 * Which business and which season the client wing is looking at.
 *
 * This used to live inside `PortalProvider`, and could stay there while the
 * only thing that needed it was a page. The rail needs it too now: what the
 * wing draws depends on how far along the season is, and "which season" is this
 * answer. A rail sitting above the provider cannot read its context, and a
 * second copy of the resolution would be two places that disagree about which
 * year is on screen the moment either changed.
 *
 * So the resolution moved out and the picked season moved into a module-level
 * store. That is not a preference for global state: two `useState` copies of
 * the same localStorage key genuinely diverge — the provider's picker writes,
 * the rail never hears, and the nav goes on describing the year the reader just
 * left. An external store is the shape that has one value.
 */

const SEASON_KEY = 'tangible-portal-season';

/**
 * The store's whole value, as one string, and the two sentinels are the reason.
 *
 * `useSyncExternalStore` re-renders on a *changed* snapshot, so a store that
 * held the id alone would go silent at the one transition that matters: reading
 * localStorage and finding nothing leaves null where null already was, the
 * subscribers are never told, and the wing waits forever for a hydration that
 * has already happened. Encoding "not read yet" and "read, nothing stored" as
 * distinct values is what makes that transition observable. Neither sentinel
 * can collide with a uuid.
 */
const UNREAD = '?';
const NONE = '-';

let snap: string = UNREAD;
const listeners = new Set<() => void>();

function announce() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Read on mount, never during render. The server has no localStorage, so
 * seeding from it during render hydrates a different tree than was sent — the
 * same reason the provider gated on `seasonReady` before this.
 */
function hydrate() {
  if (snap !== UNREAD) return;
  try {
    snap = localStorage.getItem(SEASON_KEY) ?? NONE;
  } catch {
    snap = NONE;
  }
  announce();
}

export function pickSeason(id: string | null) {
  snap = id ?? NONE;
  try {
    if (id === null) localStorage.removeItem(SEASON_KEY);
    else localStorage.setItem(SEASON_KEY, id);
  } catch {
    /* A browser refusing storage is not a reason to break the page. */
  }
  announce();
}

function snapshot(): string {
  return snap;
}

function serverSnapshot(): string {
  return UNREAD;
}

export interface PortalScope {
  /** The business on screen: the reader's own, or the one the firm named. */
  clientId: string | null;
  /** True when the firm is looking at somebody else's wing. */
  previewing: boolean;
  /** False until the stored season has been read, so nothing flashes the wrong year. */
  ready: boolean;
  detail: UseQueryResult<ClientDetail>;
  /** One season per tax year, newest first — what the year picker offers. */
  seasons: Engagement[];
  engagement: Engagement | null;
  engagementId: string | null;
  setEngagementId: (id: string) => void;
  /** A link inside the wing, with the firm's preview scope carried along. */
  href: (path: string) => string;
}

export function usePortalScope(): PortalScope {
  const { viewer, isLoading } = useViewer();
  const params = useSearchParams();
  const previewed = params.get('client');

  const stored = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  useEffect(hydrate, []);
  const seasonRead = stored !== UNREAD;
  const season = seasonRead && stored !== NONE ? stored : null;

  // A client is their own scope and the parameter is ignored — the same rule
  // the server applies in `portalScope`, so the two cannot disagree about who
  // is on screen.
  const clientId = viewer?.audience === 'client' ? viewer.clientId : (previewed ?? null);
  const previewing = viewer?.audience === 'firm' && clientId !== null;

  const detail = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.client(clientId!),
    enabled: clientId !== null,
    staleTime: 60_000,
  });

  // Every link inside the wing, written once. A client gets the path untouched:
  // adding `?client=` to their own links would put an id in front of a reader
  // the server ignores it for, and invite the edit it is designed to defeat.
  const href = useCallback(
    (path: string) => {
      if (!previewing || clientId === null) return path;
      return `${path}${path.includes('?') ? '&' : '?'}client=${encodeURIComponent(clientId)}`;
    },
    [previewing, clientId],
  );

  /**
   * One season per tax year.
   *
   * The firm can hold several engagements for the same year — a second one
   * opened by mistake, a rebuild after a bad import — and they are told apart
   * by an id nobody types. A client has no notion of an engagement at all: they
   * have a 2027, and a picker offering three identical "2027"s is a coin toss
   * over which report they see. So a year collapses to its most recently
   * touched engagement, which is the one the firm is actually working in.
   */
  const engagements = detail.data?.engagements;
  const seasons = useMemo(() => {
    const byYear = new Map<number, Engagement>();
    for (const engagement of engagements ?? []) {
      const held = byYear.get(engagement.taxYear);
      if (!held || engagement.updatedAt > held.updatedAt)
        byYear.set(engagement.taxYear, engagement);
    }
    return [...byYear.values()].sort((a, b) => b.taxYear - a.taxYear);
  }, [engagements]);

  const engagement = useMemo(() => {
    if (seasons.length === 0) return null;
    const chosen = seasons.find((e) => e.id === season);
    if (chosen) return chosen;
    // A stored id can name a season that has since been collapsed away or
    // deleted. Keep the year the reader chose where that year still exists,
    // rather than silently dropping them back to the newest one.
    const stored = engagements?.find((e) => e.id === season);
    if (stored) {
      const sameYear = seasons.find((e) => e.taxYear === stored.taxYear);
      if (sameYear) return sameYear;
    }
    // Newest season first — the one a business asking "where are we?" means.
    return seasons[0] ?? null;
  }, [engagements, season, seasons]);

  return {
    clientId,
    previewing,
    ready: !isLoading && seasonRead,
    detail,
    seasons,
    engagement,
    engagementId: engagement?.id ?? null,
    setEngagementId: pickSeason,
    href,
  };
}

/**
 * How much of the wing this season has earned.
 *
 * Separate from the scope because it is a fetch and the scope is a decision,
 * and because the answer is shared: the rail and the pages ask the same query
 * key, so the shell's call is the pages' call.
 *
 * While a run is in flight it polls, on the same five seconds as the report —
 * finishing a run is what turns four nav items into six, and a reader watching
 * the progress card should not have to reload to find the rest of their portal.
 */
export interface StageRead {
  stage: PortalStage;
  /**
   * Whether `stage` is the server’s answer or still the standing-in default.
   *
   * Drawing may act on the default; navigating may not. `emptyPortalStage` says
   * `documents`, so a page that redirects on it sends every reader to the drop
   * box for one render — whatever season they opened, and whatever is already
   * in it. That is a wrong answer arriving faster, which is the one kind of
   * guess a redirect cannot make.
   */
  settled: boolean;
}

export function usePortalStage(engagementId: string | null): StageRead {
  const query = useQuery({
    queryKey: ['portal-stage', engagementId],
    queryFn: () => api.portalStage(engagementId!),
    enabled: engagementId !== null,
    refetchInterval: (q) => (q.state.data?.runInFlight ? 5_000 : false),
  });

  /**
   * A season nobody has opened, and a stage still loading, answer the same way:
   * with the narrowest wing. Guessing wide would flash five dead ends at
   * exactly the reader this work exists for, and guessing narrow costs a
   * returning client one render of a shorter rail.
   */
  return {
    stage: query.data ?? emptyPortalStage(engagementId ?? ''),
    settled: query.data !== undefined,
  };
}
