'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
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
import { Select } from '@/components/ui/controls';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * Who the portal is speaking to.
 *
 * The client wing is the same app seen from the other side of the engagement:
 * a business that sent us files and wants to know what happened to them. Every
 * page under /portal is scoped to one client and one season, and nothing on
 * them takes a client id from the URL — a portal whose scope is addressable by
 * editing the address bar is one URL away from showing a business somebody
 * else's register.
 *
 * Until clients have logins of their own, the identity is chosen here and kept
 * in localStorage. That is a stand-in and is labelled as one on screen: when
 * auth arrives it is this provider that changes, and no page above it.
 */

const CLIENT_KEY = 'tangible-portal-client';
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
  setClientId: (id: string | null) => void;
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
  // Read on mount rather than during render: the server has no localStorage,
  // and seeding state from it directly hydrates a different tree than it
  // rendered.
  const [ready, setReady] = useState(false);
  const [clientId, setClientIdState] = useState<string | null>(null);
  const [pickedSeason, setPickedSeason] = useState<string | null>(null);

  useEffect(() => {
    setClientIdState(read(CLIENT_KEY));
    setPickedSeason(read(SEASON_KEY));
    setReady(true);
  }, []);

  const setClientId = useCallback((id: string | null) => {
    setClientIdState(id);
    write(CLIENT_KEY, id);
    // A season belongs to a client. Carrying one across the switch would land
    // the new business on a stranger's engagement id and show it nothing.
    setPickedSeason(null);
    write(SEASON_KEY, null);
  }, []);

  const setEngagementId = useCallback((id: string) => {
    setPickedSeason(id);
    write(SEASON_KEY, id);
  }, []);

  const detail = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.client(clientId!),
    enabled: Boolean(clientId) && ready,
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

  if (!ready) return <Skeleton className="h-40 w-full" />;

  if (!clientId) return <ClientChooser onPick={setClientId} />;
  // A stored id whose client has since been deleted would otherwise leave the
  // whole wing stuck on an error with no way back to the picker.
  if (detail.error) {
    return (
      <div className="space-y-4">
        <ErrorState error={detail.error} />
        <ClientChooser onPick={setClientId} />
      </div>
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
        setClientId,
      }}
    >
      {children}
    </PortalContext.Provider>
  );
}

/**
 * The stand-in for a login screen.
 *
 * Deliberately plain and deliberately labelled: this is the one screen in the
 * client wing that will not survive real authentication, and dressing it up as
 * a feature would make it harder to notice when it should be deleted.
 */
function ClientChooser({ onPick }: { onPick: (id: string) => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.clients(),
  });

  return (
    <Card>
      <CardHeader
        title="Which business is this?"
        description="Client logins do not exist yet, so the portal asks who you are instead of proving it."
        help="Everything under this wing is scoped to the business picked here. When clients sign in for themselves, this screen goes away and the identity comes from the session."
        icon={Building2}
      />
      <div className="px-5 py-5">
        {error ? (
          <ErrorState error={error} />
        ) : isLoading || !data ? (
          <Skeleton className="h-9 w-72" />
        ) : data.length === 0 ? (
          <EmptyState title="No businesses on file yet">
            A client has to exist in the Proxi wing before it has a portal to sign in to.
          </EmptyState>
        ) : (
          <Select
            // Controlled at the empty choice and never moved off it: picking a
            // business unmounts this screen, so there is no second render for a
            // stored value to survive into.
            value=""
            className="w-full max-w-sm"
            onChange={(e) => {
              if (e.target.value) onPick(e.target.value);
            }}
          >
            <option value="" disabled>
              Choose a business…
            </option>
            {data.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        )}
      </div>
    </Card>
  );
}
