'use client';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ClientDetail, Engagement } from '@tangible/types';
import { api } from '@/lib/api';
import { useViewer } from '@/components/viewer-context';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * Who the portal is speaking to.
 *
 * The client wing is the same app seen from the other side of the engagement:
 * a business that sent us files and wants to know what happened to them. Every
 * page under /portal is scoped to one client and one season.
 *
 * The scope now comes from the session. A client signs in and *is* one
 * business; there is nothing to pick and nothing stored, because an identity a
 * reader can set is an identity a reader can set to somebody else. The picker
 * that used to live here, and the localStorage key behind it, are gone rather
 * than hidden — a stand-in left in place behind a flag is a stand-in that ships.
 *
 * The firm reaches this wing too, by naming a client explicitly in the URL. That
 * is a preview and says so on screen. It is safe in a way the old picker was
 * not: the parameter only works for a session the server already knows to be
 * the firm, and a client-audience browser ignores it entirely.
 */

const SEASON_KEY = 'tangible-portal-season';

interface PortalValue {
  clientId: string;
  detail: ClientDetail;
  /** One season per tax year, newest first — what the year picker offers. */
  seasons: Engagement[];
  /** The season being viewed — the newest unless one was picked. */
  engagement: Engagement | null;
  engagementId: string | null;
  setEngagementId: (id: string) => void;
  /** True when the firm is looking at somebody else's wing. */
  previewing: boolean;
  /** Whether this reader may send files and answer questions. */
  canAct: boolean;
}

const PortalContext = createContext<PortalValue | null>(null);

export function usePortal(): PortalValue {
  const value = useContext(PortalContext);
  if (!value) throw new Error('usePortal must be used inside the portal layout.');
  return value;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* A browser refusing storage is not a reason to break the page. */
  }
}

export function PortalProvider({ children }: { children: ReactNode }) {
  const { viewer, isLoading } = useViewer();
  const params = useSearchParams();
  const previewed = params.get('client');

  // A client is their own scope and the parameter is ignored — the same rule
  // the server applies in `portalScope`, so the two cannot disagree about who
  // is on screen.
  const clientId = viewer?.audience === 'client' ? viewer.clientId : (previewed ?? null);
  const previewing = viewer?.audience === 'firm' && clientId !== null;
  const canAct = viewer?.audience === 'firm' || viewer?.role === 'admin';

  // Which year is on screen is a preference, not an identity: it survives a
  // reload for convenience and grants nothing. Read on mount rather than during
  // render, because the server has no localStorage and seeding state from it
  // hydrates a different tree than it rendered.
  const [seasonReady, setSeasonReady] = useState(false);
  const [pickedSeason, setPickedSeason] = useState<string | null>(null);

  useEffect(() => {
    setPickedSeason(read(SEASON_KEY));
    setSeasonReady(true);
  }, []);

  const setEngagementId = useCallback((id: string) => {
    setPickedSeason(id);
    write(SEASON_KEY, id);
  }, []);

  const detail = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.client(clientId!),
    enabled: clientId !== null,
    staleTime: 60_000,
  });

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
  const seasons = useMemo(() => {
    const byYear = new Map<number, Engagement>();
    for (const engagement of detail.data?.engagements ?? []) {
      const held = byYear.get(engagement.taxYear);
      if (!held || engagement.updatedAt > held.updatedAt)
        byYear.set(engagement.taxYear, engagement);
    }
    return [...byYear.values()].sort((a, b) => b.taxYear - a.taxYear);
  }, [detail.data]);

  const engagement = useMemo(() => {
    if (seasons.length === 0) return null;
    const picked = seasons.find((e) => e.id === pickedSeason);
    if (picked) return picked;
    // A stored id can name a season that has since been collapsed away or
    // deleted. Keep the year the reader chose where that year still exists,
    // rather than silently dropping them back to the newest one.
    const stored = detail.data?.engagements.find((e) => e.id === pickedSeason);
    if (stored) {
      const sameYear = seasons.find((e) => e.taxYear === stored.taxYear);
      if (sameYear) return sameYear;
    }
    // Newest season first — the one a business asking "where are we?" means.
    return seasons[0] ?? null;
  }, [detail.data, pickedSeason, seasons]);

  if (isLoading || !seasonReady) return <Skeleton className="h-40 w-full" />;

  if (viewer === null) {
    return (
      <Card>
        <EmptyState title="Sign in to see your account">
          This page belongs to one business. Signing in is what says which.
        </EmptyState>
      </Card>
    );
  }

  // The firm arrived without naming a client. There is nothing to guess at:
  // opening the newest client, or the first alphabetically, would be a portal
  // that shows a preparer one business while they believe they are looking at
  // another.
  if (clientId === null) {
    return (
      <Card>
        <EmptyState title="A portal belongs to a business">
          Open a client in the workspace and use “View their portal” to see this wing the way they
          do.
        </EmptyState>
      </Card>
    );
  }

  if (detail.error) {
    return (
      <Card>
        <ErrorState error={detail.error} />
      </Card>
    );
  }
  if (!detail.data) return <Skeleton className="h-40 w-full" />;

  return (
    <PortalContext.Provider
      value={{
        clientId,
        detail: detail.data,
        seasons,
        engagement,
        engagementId: engagement?.id ?? null,
        setEngagementId,
        previewing,
        canAct,
      }}
    >
      {previewing ? <PreviewBanner name={detail.data.client.name} /> : null}
      {children}
    </PortalContext.Provider>
  );
}

/**
 * Said plainly, and at the top.
 *
 * A preparer who forgets they are in a preview will read "you have $84,000 of
 * savings" as a sentence about the firm's own work rather than about this
 * client's, and a screenshot taken from here goes out with the wrong name on it.
 */
function PreviewBanner({ name }: { name: string }) {
  return (
    <div className="rounded-md border border-[var(--color-hairline)] bg-[var(--color-sunken)] px-4 py-2 text-xs text-[var(--color-ink-muted)]">
      You are looking at <span className="font-medium text-[var(--color-ink)]">{name}</span>’s
      portal as the firm. They see this page without this line.
    </div>
  );
}
