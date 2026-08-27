import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Suspense } from 'react';
import { AppShell } from '@/components/app-shell';
import { Providers } from '@/components/providers';
import './globals.css';

/**
 * Inter, loaded as a variable font and exposed as a CSS variable the token
 * layer reads. It is here rather than in a stylesheet link because next/font
 * self-hosts the file — no third-party request on first paint, and no layout
 * shift when the real face arrives.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Tangible — business personal property intelligence',
  description:
    'Public appraisal-roll analysis for business personal property across Texas and Florida: who files, who does not, and what the penalty exposure is worth.',
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
    <html lang="en" className={inter.variable} suppressHydrationWarning>
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
