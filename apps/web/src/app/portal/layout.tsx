import { Suspense, type ReactNode } from 'react';
import { PortalProvider } from '@/components/portal/portal-context';
import { Skeleton } from '@/components/ui/primitives';

/**
 * The client wing. One business, one season — see {@link PortalProvider} for
 * why the scope comes from the session rather than from anything on the page.
 *
 * The Suspense boundary is required, not decorative: the provider reads
 * `?client=` for the firm's preview, and a `useSearchParams()` with no boundary
 * above it opts every route under this layout out of static rendering and fails
 * the build.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <Suspense fallback={<Skeleton className="h-40 w-full" />}>
        <PortalProvider>{children}</PortalProvider>
      </Suspense>
    </div>
  );
}
