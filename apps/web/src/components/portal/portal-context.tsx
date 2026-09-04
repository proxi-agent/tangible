'use client';

import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ClientDetail, Engagement, PortalStage } from '@tangible/types';
import { api } from '@/lib/api';
import { useViewer } from '@/components/viewer-context';
import { usePortalScope, usePortalStage } from '@/components/portal/portal-scope';
import { TextInput } from '@/components/ui/controls';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

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
 *
 * Because the preview lives in the address, it has to be carried: a firm reader
 * who lands on `/portal?client=…` and clicks "Documents" would otherwise arrive
 * at a bare `/portal/documents` with no scope at all, and the wing would empty
 * out under them one click in. `href()` is how every link inside the wing keeps
 * it, and the rail does the same for its own six. For a client the parameter is
 * never added, because a client is already their own scope.
 */

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
  /** A link inside the wing, with the firm's preview scope carried along. */
  href: (path: string) => string;
  /** Whether this reader may send files and answer questions. */
  canAct: boolean;
  /**
   * How far along this season is — the same measurement the rail draws itself
   * against, so a page and the nav beside it can never disagree about whether
   * there is a report.
   */
  stage: PortalStage;
  /**
   * Whether `stage` has come back from the server yet. A page that navigates on
   * the stage has to wait for this; a page that only draws does not.
   */
  stageSettled: boolean;
}

const PortalContext = createContext<PortalValue | null>(null);

export function usePortal(): PortalValue {
  const value = useContext(PortalContext);
  if (!value) throw new Error('usePortal must be used inside the portal layout.');
  return value;
}

export function PortalProvider({ children }: { children: ReactNode }) {
  const { viewer } = useViewer();
  const {
    clientId,
    previewing,
    ready,
    detail,
    seasons,
    engagement,
    engagementId,
    setEngagementId,
    href,
  } = usePortalScope();
  const { stage, settled: stageSettled } = usePortalStage(engagementId);

  const canAct = viewer?.audience === 'firm' || viewer?.role === 'admin';

  if (!ready) return <Skeleton className="h-40 w-full" />;

  if (viewer === null) {
    return (
      <Card>
        <EmptyState title="Sign in to see your account">
          This page belongs to one business. Signing in is what says which.
        </EmptyState>
      </Card>
    );
  }

  // The firm arrived without naming a client — a bare /portal, from a bookmark
  // or typed. There is still nothing to guess at: opening the newest client,
  // or the first alphabetically, would be a portal that shows a preparer one
  // business while they believe they are looking at another. So the page asks
  // rather than assumes, and asks with the list in hand — a sentence telling a
  // reader to go somewhere else and come back is a dead end wearing an
  // explanation.
  if (clientId === null) {
    return <PreviewChooser />;
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
        engagementId,
        setEngagementId,
        previewing,
        href,
        canAct,
        stage,
        stageSettled,
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

/**
 * Which client's portal the firm wants to look at.
 *
 * This is not the picker that was deleted. That one answered "who are you" for
 * a reader whose identity was the whole access decision; this one answers
 * "which of our clients" for a session the server has already established as
 * the firm, and every name in it is a name that reader can open in the
 * workspace anyway. It writes nothing: picking a client sets the same `?client=`
 * the workspace's own "View their portal" link sets, so the address still says
 * who is on screen.
 */
function PreviewChooser() {
  const clients = useQuery({ queryKey: ['clients'], queryFn: api.clients, staleTime: 60_000 });
  const [needle, setNeedle] = useState('');

  const matches = (clients.data ?? []).filter((client) =>
    client.name.toLowerCase().includes(needle.trim().toLowerCase()),
  );

  return (
    <Card>
      <CardHeader
        title="A portal belongs to a business"
        description="Pick a client to see this wing the way they do. The same link sits on their client page, under Portal access."
        icon={Building2}
      />
      {clients.isLoading ? (
        <div className="px-5 py-5">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : clients.error ? (
        <div className="px-5 py-5">
          <ErrorState error={clients.error} />
        </div>
      ) : (clients.data?.length ?? 0) === 0 ? (
        <EmptyState title="No clients yet">
          The client wing is one business&rsquo;s view of an engagement. There is no engagement to
          look at until there is a client.
        </EmptyState>
      ) : (
        <>
          <div className="border-b border-[var(--color-hairline)] px-5 pb-4">
            <TextInput
              value={needle}
              placeholder="Find a client"
              aria-label="Find a client"
              onChange={(e) => setNeedle(e.target.value)}
            />
          </div>
          {matches.length === 0 ? (
            <EmptyState title="No client by that name" />
          ) : (
            <ul className="divide-y divide-[var(--color-hairline)]">
              {matches.map((client) => (
                <li key={client.id}>
                  <Link
                    href={`/portal?client=${encodeURIComponent(client.id)}`}
                    className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-[var(--color-sunken)]"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {client.name}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                      {client.engagementCount === 1
                        ? '1 season'
                        : `${client.engagementCount} seasons`}
                    </span>
                    <ChevronRight
                      size={15}
                      strokeWidth={2}
                      className="shrink-0 text-[var(--color-ink-muted)]"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}
