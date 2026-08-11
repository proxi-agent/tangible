'use client';

import { BarChart3, Building2, Database, Table2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useScope } from '@/hooks/use-scope';
import { Select } from '@/components/ui/controls';
import { ThemeToggle } from '@/components/theme-toggle';

const NAV = [
  { href: '/', label: 'Overview', icon: BarChart3 },
  { href: '/accounts', label: 'Accounts', icon: Table2 },
  { href: '/owners', label: 'Owners', icon: Building2 },
  { href: '/data', label: 'Data sources', icon: Database },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scope = useScope();

  // Carry the current scope across navigation so switching tabs never silently
  // changes which numbers you are looking at.
  const scopeQuery = new URLSearchParams();
  if (searchParams.get('jurisdictionId')) {
    scopeQuery.set('jurisdictionId', searchParams.get('jurisdictionId')!);
  }
  if (searchParams.get('taxYear')) scopeQuery.set('taxYear', searchParams.get('taxYear')!);
  const suffix = scopeQuery.toString() ? `?${scopeQuery}` : '';

  const notes = scope.current?.dataNotes ?? [];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-surface)_85%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-3 px-6 py-3">
          <Link href={`/${suffix}`} className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-[var(--color-series-1)] text-[13px] font-bold text-white">
              T
            </span>
            <span className="text-sm font-semibold tracking-tight">Tangible</span>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={`${href}${suffix}`}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-[var(--color-plane)] font-medium text-[var(--color-ink)]'
                      : 'text-[var(--color-ink-secondary)] hover:bg-[var(--color-plane)]',
                  )}
                >
                  <Icon size={15} strokeWidth={2} />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <Select
              aria-label="Jurisdiction"
              value={scope.jurisdictionId}
              onChange={(e) => scope.setScope({ jurisdictionId: e.target.value })}
              className="h-8 text-[13px]"
            >
              {scope.jurisdictions.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name}
                  {j.accountCount === 0 ? ' — no data' : ''}
                </option>
              ))}
            </Select>

            <Select
              aria-label="Tax year"
              value={scope.taxYear}
              onChange={(e) => scope.setScope({ taxYear: Number(e.target.value) })}
              className="h-8 w-24 text-[13px]"
              disabled={scope.availableYears.length === 0}
            >
              {(scope.availableYears.length ? scope.availableYears : [scope.taxYear]).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </Select>

            <ThemeToggle />
          </div>
        </div>

        {notes.length > 0 ? (
          <div className="border-t border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_12%,transparent)] px-6 py-1.5">
            <ul className="mx-auto max-w-[1200px] space-y-0.5 text-center text-xs leading-relaxed">
              {notes.map((note) => (
                <li key={note}>
                  <strong className="font-semibold">What this file omits:</strong> {note}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>

      <main className="mx-auto max-w-[1600px] px-6 py-6">{children}</main>
    </div>
  );
}
