import type { ReactNode } from 'react';
import { PortalProvider } from '@/components/portal/portal-context';

/**
 * The client wing. One business, one season, no ids in the URL — see
 * {@link PortalProvider} for why the scope is held rather than addressed.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <PortalProvider>{children}</PortalProvider>
    </div>
  );
}
