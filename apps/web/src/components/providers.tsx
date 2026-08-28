'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ViewerProvider } from '@/components/viewer-context';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // The roll is a static snapshot between ingests — refetching on
            // every focus would be pure noise.
            staleTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ViewerProvider>{children}</ViewerProvider>
    </QueryClientProvider>
  );
}
