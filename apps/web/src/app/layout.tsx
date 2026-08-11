import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tangible — business personal property intelligence',
  description:
    'Public appraisal-roll analysis for Texas business personal property: who files, who does not, and what the penalty exposure is worth.',
};

/**
 * Blocking script so the stored theme is applied before first paint. Without it
 * a dark-mode user sees a white flash on every navigation.
 */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem('tangible-theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <Suspense fallback={null}>
            <AppShell>{children}</AppShell>
          </Suspense>
        </Providers>
      </body>
    </html>
  );
}
