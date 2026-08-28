'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import type { Viewer } from '@tangible/types';
import { api } from '@/lib/api';

/**
 * Which audience is looking at the app.
 *
 * The shell draws two different products off this: the firm's workspace, and a
 * single business's portal. It is deliberately the only place in the browser
 * that knows, so nothing else has to reason about it — a component asks
 * `useViewer()` and gets an answer that came from the session rather than from
 * anything the page could influence.
 *
 * Nothing here is a security boundary. Hiding a nav item does not stop a
 * request; the proxy and the route handlers do that, twice. This exists so the
 * app does not offer a client links that would answer 403.
 */

interface ViewerValue {
  viewer: Viewer | null;
  isLoading: boolean;
}

const ViewerContext = createContext<ViewerValue>({ viewer: null, isLoading: true });

export function useViewer(): ViewerValue {
  return useContext(ViewerContext);
}

export function ViewerProvider({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['viewer'],
    queryFn: () => api.viewer(),
    // The audience does not change inside a session. Refetching it on every
    // navigation would be a round-trip per page for an answer that is fixed
    // until sign-out, which clears the whole cache anyway.
    staleTime: Infinity,
    retry: false,
  });

  return (
    <ViewerContext.Provider value={{ viewer: data ?? null, isLoading }}>
      {children}
    </ViewerContext.Provider>
  );
}
