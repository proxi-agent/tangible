'use client';

import { BarChart3, Building2, Database, Table2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useScope } from '@/hooks/use-scope';
import { Select } from '@/components/ui/controls';
import { Tooltip } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/theme-toggle';
import { CoverageGuideButton } from '@/components/coverage-guide';

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
  for (const key of ['state', 'jurisdictionId', 'taxYear']) {
    const value = searchParams.get(key);
    if (value) scopeQuery.set(key, value);
  }
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
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm outline-none transition-colors',
                    'focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
                    active
                      ? 'bg-[var(--color-plane)] font-medium text-[var(--color-ink)] ring-1 ring-[var(--color-hairline)]'
                      : 'text-[var(--color-ink-secondary)] hover:bg-[var(--color-plane)] hover:text-[var(--color-ink)]',
                  )}
                >
                  <Icon size={15} strokeWidth={2} />
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/* These three set what every number on every page refers to, so
                they say what they are rather than relying on the reader
                inferring it from the county names inside. They also nest: the
                counties are this state's, and the years are this county's. */}
            <Tooltip
              title="State"
              content="States publish business personal property on completely different terms — Texas names who failed to render, Florida publishes no filing field at all and has it inferred from penalty rates in the ten counties where that holds up, and Virginia keeps the accounts confidential. Changing this changes which questions the pages below can answer, not just which places they cover."
            >
              <label className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                State
                <Select
                  value={scope.stateCode}
                  onChange={(e) => scope.setScope({ stateCode: e.target.value })}
                  className="h-8 text-[13px]"
                  disabled={scope.states.length === 0}
                >
                  {scope.states.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </label>
            </Tooltip>

            <Tooltip
              title="County"
              content="Which county's public records you are looking at, within the selected state. Counties with nothing loaded yet are marked — that is usually a download away, except where the state does not publish the file at all."
            >
              <label className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                County
                <Select
                  value={scope.jurisdictionId}
                  onChange={(e) => scope.setScope({ jurisdictionId: e.target.value })}
                  className="h-8 max-w-56 text-[13px]"
                  disabled={scope.countiesInState.length === 0}
                >
                  {scope.countiesInState.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                      {j.accountCount === 0 ? ' — no data' : ''}
                    </option>
                  ))}
                </Select>
              </label>
            </Tooltip>

            <Tooltip
              title="Tax year"
              content="Only the years this county has actually published and loaded appear here. Texas districts go back to 2020; Florida's state portal posts the current roll only, so most Florida counties offer a single year until the back years are requested."
            >
              <label className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                Year
                <Select
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
              </label>
            </Tooltip>

            <CoverageGuideButton className="h-8 text-[13px]" />

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
