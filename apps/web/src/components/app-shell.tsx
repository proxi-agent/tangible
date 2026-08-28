'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Briefcase,
  Building2,
  CalendarRange,
  Database,
  FlaskConical,
  FolderUp,
  ListOrdered,
  LogOut,
  Menu,
  MessageCircleQuestion,
  Sparkles,
  Table2,
  TrendingDown,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useScope } from '@/hooks/use-scope';
import { authConfigured, getSupabaseBrowser } from '@/lib/supabase-browser';
import { Segmented, Select } from '@/components/ui/controls';
import { Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { Tooltip } from '@/components/ui/tooltip';
import { ThemeToggle } from '@/components/theme-toggle';
import { CoverageGuideButton } from '@/components/coverage-guide';
import { AssistantProvider, AssistantTrigger } from '@/components/assistant/assistant-provider';
import { useViewer } from '@/components/viewer-context';

/**
 * Two wings, one shell. The Workspace is client engagements — FAR intake,
 * mapping, assets — scoped by client, not by county. The Market is the public
 * appraisal-roll analysis, scoped by state/county/year. The county selectors
 * therefore live with the Market group alone: showing them over a client page
 * would imply the numbers on screen change with the county, and they do not.
 *
 * Navigation is a left rail rather than a top strip. The top bar had been
 * carrying two nav wings, two wing labels, three scope selectors, a coverage
 * button, a theme switch and an account menu in a single row, and wrapped to
 * two lines on anything narrower than a desktop. Down the side, the wings have
 * room to be labelled and the top bar is left to say one thing: what this page
 * is scoped to.
 */
/**
 * Above both wings and belonging to neither, because it reads across both: a
 * question can start at a client's register and end at what the county's roll
 * shows for the same account. It is a nav item as well as a drawer so that it
 * is findable — a surface reachable only by keyboard shortcut is a surface most
 * people never learn exists.
 */
const ASSISTANT_NAV = {
  href: '/assistant',
  label: 'Assistant',
  icon: Sparkles,
  hint: 'Ask about a client, a county, or the Tax Code. Every answer says what it read to get there.',
};

/**
 * The client wing.
 *
 * Same portal, other side of the engagement. A business's whole relationship
 * with us is four questions — did you get my files, what do you still need from
 * me, is my return going out on time, and what did it save me — and the wing is
 * those four questions in that order. The last of them went unanswered for a
 * long time: the report says what a position is worth, which is not the same
 * claim as what it recovered, and until the results page existed a client could
 * only be told the first. Nothing here takes an id from the URL:
 * the identity is held by the portal layout, so there is no address a client
 * can edit into somebody else's account.
 *
 * It is a wing rather than a nav group because the two audiences must not share
 * a rail. A client scrolling past "Market — Accounts, Owners" is looking at a
 * list of every business in the county, which is our analysis and not their
 * portal; and a firm user with the client's four items always on screen has
 * eleven nav items for a job that needs seven.
 */
const PORTAL_NAV = [
  {
    href: '/portal',
    label: 'Your report',
    icon: TrendingDown,
    hint: 'What we found in your register, and what it is worth.',
  },
  {
    // Second, not first. The report is what a business asks for; this is what
    // they do about it, and it only makes sense once they have read the top of
    // the other page.
    href: '/portal/queue',
    label: 'What to do first',
    icon: ListOrdered,
    hint: 'Every finding as one ranked list, worth the most first.',
  },
  {
    href: '/portal/documents',
    label: 'Documents',
    icon: FolderUp,
    hint: 'Send us your register and prior-year tax documents.',
  },
  {
    href: '/portal/questions',
    label: 'Questions',
    icon: MessageCircleQuestion,
    hint: 'Things only you can answer about your own property.',
  },
  {
    // The fourth question, and the last one to have an answer. Everything above
    // is what a position is worth; this is what came back from the district,
    // and it stays empty until something actually has.
    href: '/portal/results',
    label: 'What it saved',
    icon: BadgeCheck,
    hint: 'What we claimed on your behalf, and what the district allowed.',
  },
];

const WORKSPACE_NAV = [
  // Above the client list rather than under it. The season is the one workspace
  // question that is not about a client — it is about which return crosses a
  // deadline next, and the answer spans all of them.
  {
    href: '/season',
    label: 'Season',
    icon: CalendarRange,
    hint: 'Every return this season across all clients, ordered by which deadline arrives first.',
  },
  {
    href: '/clients',
    label: 'Clients',
    icon: Briefcase,
    hint: 'The client list, and each client’s engagements, sites and filings.',
  },
  // Firm-only, and about the tooling rather than about any client. It sits in
  // the workspace nav because the people who work the queues are the people
  // whose decisions the numbers are made of.
  {
    href: '/quality',
    label: 'Quality',
    icon: FlaskConical,
    hint: 'How often each finding type is right, and the citation behind every rule the engine applies.',
  },
];

const MARKET_NAV = [
  {
    href: '/market',
    label: 'Overview',
    icon: BarChart3,
    hint: 'How much personal property a county has on its roll, and how much of it went unrendered.',
  },
  {
    href: '/accounts',
    label: 'Accounts',
    icon: Table2,
    hint: 'Every business personal property account on the selected roll, one row each.',
  },
  {
    href: '/owners',
    label: 'Owners',
    icon: Building2,
    hint: 'Accounts grouped by the owner named on them — one company, all its locations.',
  },
  {
    href: '/data',
    label: 'Data sources',
    icon: Database,
    hint: 'Which files are loaded, when they were published, and what each one leaves out.',
  },
];

type Wing = 'client' | 'proxi';

function wingOf(pathname: string): Wing {
  return pathname.startsWith('/portal') ? 'client' : 'proxi';
}

function isMarketPath(pathname: string): boolean {
  return (
    pathname.startsWith('/market') ||
    pathname.startsWith('/accounts') ||
    pathname.startsWith('/owners') ||
    pathname.startsWith('/data')
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scope = useScope();
  const [navOpen, setNavOpen] = useState(false);

  const { viewer } = useViewer();
  const isClient = viewer?.audience === 'client';

  const onMarket = isMarketPath(pathname) && !isClient;

  // A drawer that survives the navigation it just performed covers the page the
  // reader asked for.
  useEffect(() => setNavOpen(false), [pathname]);

  // Carry the current scope across market navigation so switching tabs never
  // silently changes which numbers you are looking at. Workspace links carry
  // nothing — a client page has no county scope to preserve.
  const scopeQuery = new URLSearchParams();
  for (const key of ['state', 'jurisdictionId', 'taxYear']) {
    const value = searchParams.get(key);
    if (value) scopeQuery.set(key, value);
  }
  const suffix = scopeQuery.toString() ? `?${scopeQuery}` : '';

  const notes = onMarket ? (scope.current?.dataNotes ?? []) : [];

  // The login page is its own room, not a view inside the app chrome.
  if (pathname.startsWith('/login')) {
    return <main className="min-h-screen">{children}</main>;
  }

  const rail = <NavRail pathname={pathname} suffix={suffix} onNavigate={() => setNavOpen(false)} />;

  return (
    <AssistantProvider>
      <div className="flex min-h-screen">
        {/* Desktop: a permanent rail. It scrolls with its own overflow so a long
          nav never drags the page down. */}
        <aside
          data-chrome="true"
          className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-[var(--color-hairline)] bg-[var(--color-surface)] lg:flex"
        >
          {rail}
        </aside>

        {/* Phone and tablet: the same rail, in a drawer. */}
        {navOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setNavOpen(false)}
              className="absolute inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-[2px]"
            />
            <aside className="relative flex h-full w-64 flex-col border-r border-[var(--color-hairline)] bg-[var(--color-surface)] shadow-[var(--shadow-overlay)]">
              {rail}
            </aside>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header
            data-chrome="true"
            className="sticky top-0 z-20 border-b border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-surface)_88%,transparent)] backdrop-blur"
          >
            {/*
              Below `lg` the scope controls drop to a line of their own. They are
              four controls totalling ~600px; sharing a row with the breadcrumb on
              a phone wrapped them into three stacked lines and squeezed the page
              title down to "A…". On their own line they scroll sideways instead —
              a filter strip a thumb can swipe, and a header that stays two lines
              tall rather than five.
            */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 lg:flex-nowrap lg:px-6">
              <button
                type="button"
                aria-label="Open navigation"
                aria-expanded={navOpen}
                onClick={() => setNavOpen(true)}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-[var(--radius-control)] text-[var(--color-ink-secondary)] transition-colors outline-none hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)] lg:hidden"
              >
                {navOpen ? <X size={17} strokeWidth={2} /> : <Menu size={17} strokeWidth={2} />}
              </button>

              <Breadcrumb pathname={pathname} onMarket={onMarket} />

              {/* On every page, market or not: the questions worth asking are
                asked at whatever is on screen. */}
              {/* Not for a client: the assistant answers across every client and
                the county roll, which is the firm's own instrument. */}
              {isClient ? null : (
                <div className="order-1 ml-auto flex shrink-0 items-center gap-2 lg:order-3 lg:ml-0">
                  <AssistantTrigger />
                </div>
              )}

              {onMarket ? (
                <div
                  className={cn(
                    'order-2 -mx-4 w-full overflow-x-auto px-4',
                    'lg:mx-0 lg:ml-auto lg:w-auto lg:overflow-visible lg:px-0',
                  )}
                >
                  <div className="flex w-max items-center gap-2 lg:w-auto">
                    {/* These three set what every number on every page refers to, so
                    they say what they are rather than relying on the reader
                    inferring it from the county names inside. They also nest: the
                    counties are this state's, and the years are this county's. */}
                    <ScopeSelect
                      label="State"
                      hint="States publish business personal property on completely different terms — Texas names who failed to render, Florida publishes no filing field at all and has it inferred from penalty rates in the ten counties where that holds up, and Virginia keeps the accounts confidential. Changing this changes which questions the pages below can answer, not just which places they cover."
                    >
                      <Select
                        value={scope.stateCode}
                        onChange={(e) => scope.setScope({ stateCode: e.target.value })}
                        compact
                        // A select with nothing in it yet shrinks to its chevron,
                        // so the whole scope bar shuffled sideways the moment the
                        // jurisdictions arrived. Held at the width the names need.
                        className="w-28"
                        disabled={scope.states.length === 0}
                      >
                        {scope.states.map((s) => (
                          <option key={s.code} value={s.code}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </ScopeSelect>

                    <ScopeSelect
                      label="County"
                      hint="Which county's public records you are looking at, within the selected state. Counties with nothing loaded yet are marked — that is usually a download away, except where the state does not publish the file at all."
                    >
                      <Select
                        value={scope.jurisdictionId}
                        onChange={(e) => scope.setScope({ jurisdictionId: e.target.value })}
                        compact
                        className="w-44"
                        disabled={scope.countiesInState.length === 0}
                      >
                        {scope.countiesInState.map((j) => (
                          <option key={j.id} value={j.id}>
                            {j.name}
                            {j.accountCount === 0 ? ' — no data' : ''}
                          </option>
                        ))}
                      </Select>
                    </ScopeSelect>

                    <ScopeSelect
                      label="Year"
                      hint="Only the years this county has actually published and loaded appear here. Texas districts go back to 2020; Florida's state portal posts the current roll only, so most Florida counties offer a single year until the back years are requested."
                    >
                      <Select
                        value={scope.taxYear}
                        onChange={(e) => scope.setScope({ taxYear: Number(e.target.value) })}
                        compact
                        className="w-20"
                        disabled={scope.availableYears.length === 0}
                      >
                        {(scope.availableYears.length ? scope.availableYears : [scope.taxYear]).map(
                          (y) => (
                            <option key={y} value={y}>
                              {y}
                            </option>
                          ),
                        )}
                      </Select>
                    </ScopeSelect>

                    <CoverageGuideButton />
                  </div>
                </div>
              ) : null}
            </div>

            {notes.length > 0 ? (
              <div className="flex items-start gap-2 border-t border-[color-mix(in_oklab,var(--color-warning)_35%,transparent)] bg-[var(--color-warning-soft)] px-4 py-2 lg:px-6">
                <AlertTriangle
                  size={14}
                  strokeWidth={2}
                  className="mt-0.5 shrink-0 text-[var(--color-warning)]"
                />
                <ul className="space-y-0.5 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
                  {notes.map((note) => (
                    <li key={note}>
                      <strong className="font-semibold text-[var(--color-ink)]">
                        What this file omits:
                      </strong>{' '}
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </header>

          <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 lg:px-6 lg:py-7">
            {children}
          </main>
        </div>
      </div>
    </AssistantProvider>
  );
}

function NavRail({
  pathname,
  suffix,
  onNavigate,
}: {
  pathname: string;
  suffix: string;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const { viewer } = useViewer();
  // A client signs in to one product. There is no second wing behind the
  // toggle for them — every link it would offer answers 404 — so the control
  // is absent rather than disabled: a disabled control still advertises that
  // something is there.
  const isClient = viewer?.audience === 'client';
  const wing = isClient ? 'client' : wingOf(pathname);

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <Link
          href={wing === 'client' ? '/portal' : '/season'}
          onClick={onNavigate}
          className="flex items-center gap-2"
        >
          <span className="grid size-7 place-items-center rounded-md bg-[var(--color-accent)] text-xs font-bold text-[var(--color-on-accent)]">
            T
          </span>
          <span className="text-sm font-semibold tracking-tight">Tangible</span>
        </Link>
      </div>

      {/* Which side of the engagement you are looking from. It sits above the
        nav rather than inside it because it does not select a page — it
        selects which pages exist. */}
      {isClient ? null : (
        <div className="px-3 pb-3">
          <Segmented
            ariaLabel="Point of view"
            grow
            size="sm"
            className="w-full"
            value={wing}
            options={[
              {
                value: 'proxi',
                label: 'Proxi',
                title: 'The firm\u2019s workspace and county analysis.',
              },
              {
                value: 'client',
                label: 'Client',
                title: 'The portal a client sees: send files, answer questions, watch the return.',
              },
            ]}
            onChange={(next) => {
              onNavigate();
              router.push(next === 'client' ? '/portal' : '/season');
            }}
          />
        </div>
      )}

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4">
        {wing === 'client' ? (
          <NavGroup label="Your account">
            {PORTAL_NAV.map((item) => (
              <NavLink
                key={item.href}
                {...item}
                onNavigate={onNavigate}
                active={
                  item.href === '/portal'
                    ? pathname === '/portal' || pathname.startsWith('/portal/report')
                    : pathname.startsWith(item.href)
                }
              />
            ))}
          </NavGroup>
        ) : (
          <>
            <div className="space-y-0.5">
              <NavLink
                {...ASSISTANT_NAV}
                onNavigate={onNavigate}
                active={pathname.startsWith(ASSISTANT_NAV.href)}
              />
            </div>

            <NavGroup label="Workspace">
              {WORKSPACE_NAV.map((item) => (
                <NavLink
                  key={item.href}
                  {...item}
                  onNavigate={onNavigate}
                  active={
                    pathname.startsWith(item.href) ||
                    // A filed form lives at /filings/… but is reached from a
                    // client's engagement — with no nav lit, the page reads as
                    // outside the app.
                    (item.href === '/clients' && pathname.startsWith('/filings'))
                  }
                />
              ))}
            </NavGroup>

            <NavGroup label="Market">
              {MARKET_NAV.map((item) => (
                <NavLink
                  key={item.href}
                  {...item}
                  href={`${item.href}${suffix}`}
                  onNavigate={onNavigate}
                  active={pathname.startsWith(item.href)}
                />
              ))}
            </NavGroup>
          </>
        )}
      </nav>

      <div className="shrink-0 space-y-2 border-t border-[var(--color-hairline)] p-3">
        <UserMenu />
        <ThemeToggle />
      </div>
    </>
  );
}

function NavGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="eyebrow px-2.5 pb-1.5">{label}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  hint,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: typeof BarChart3;
  hint: string;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Tooltip title={label} content={hint} className="block w-full">
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-2.5 py-1.5 text-sm',
          'transition-colors outline-none',
          'focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
          active
            ? 'bg-[var(--color-accent-soft)] font-medium text-[var(--color-accent-ink)]'
            : 'text-[var(--color-ink-secondary)] hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)]',
        )}
      >
        <Icon
          size={16}
          strokeWidth={2}
          className={active ? 'text-[var(--color-accent)]' : undefined}
        />
        {label}
      </Link>
    </Tooltip>
  );
}

/**
 * Where this page sits, named rather than numbered.
 *
 * This had stopped at two levels — "Workspace / Clients" — on the reasoning
 * that everything below is addressed by id, and a crumb built from the URL
 * could only print the id. True of the URL, but not of the app: a page under an
 * engagement already loads that engagement, and an EngagementDetail carries its
 * client alongside it. So the names are in hand for one cached read, and the
 * five-deep pages get a trail that says Acme Machining LLC rather than repeating
 * the rail item already lit beside it.
 *
 * It stops at the engagement. The leaf — this document, this asset, this file —
 * is the page's own <h1> two lines below, and printing it twice buys nothing.
 */
function Breadcrumb({ pathname, onMarket }: { pathname: string; onMarket: boolean }) {
  // Longest href first: '/portal' is a prefix of every other portal route, so
  // unsorted the overview would win the match on every page in the wing.
  const all = [ASSISTANT_NAV, ...WORKSPACE_NAV, ...MARKET_NAV, ...PORTAL_NAV].sort(
    (a, b) => b.href.length - a.href.length,
  );
  const section = all.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  const inClient = /^\/clients\/([^/]+)(?:\/engagements\/([^/]+))?/.exec(pathname);
  const clientId = inClient?.[1];
  const engagementId = inClient?.[2];

  // One request covers both names, because an engagement is returned with its
  // client attached. Both keys are the ones the pages themselves use, so on
  // every path that reaches here this is already in cache and costs nothing.
  const engagement = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => api.engagement(engagementId!),
    enabled: Boolean(engagementId),
    staleTime: 5 * 60_000,
  });
  const client = useQuery({
    queryKey: ['client', clientId],
    queryFn: () => api.client(clientId!),
    enabled: Boolean(clientId) && !engagementId,
    staleTime: 5 * 60_000,
  });

  const clientName = engagementId
    ? (engagement.data?.client.name ?? null)
    : (client.data?.client.name ?? null);

  const trail: { label: string | null; href: string }[] = [];
  if (section) trail.push({ label: section.label, href: section.href });
  if (clientId) trail.push({ label: clientName, href: `/clients/${clientId}` });
  if (engagementId) {
    trail.push({
      label: engagement.data ? `${engagement.data.engagement.taxYear} season` : null,
      href: `/clients/${clientId}/engagements/${engagementId}`,
    });
  }

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
      <span className="hidden shrink-0 text-[var(--color-ink-muted)] sm:inline">
        {wingOf(pathname) === 'client' ? 'Your account' : onMarket ? 'Market' : 'Workspace'}
      </span>
      {trail.map((crumb, index) => {
        const isCurrent = index === trail.length - 1 && pathname === crumb.href;
        return (
          <span
            key={crumb.href}
            className={cn(
              'flex min-w-0 items-center gap-1.5',
              // Below `sm` only the page you are on survives. The full trail is
              // wider than a phone, and left to wrap it pushed the assistant
              // button onto a line of its own. Nothing is lost: every page that
              // has a parent also carries a "← parent" link in its own header.
              index < trail.length - 1 && 'hidden sm:flex',
            )}
          >
            <span
              className="hidden shrink-0 text-[var(--color-ink-muted)] sm:inline"
              aria-hidden="true"
            >
              /
            </span>
            {crumb.label === null ? (
              // The segment is known to exist and its name is still loading.
              // Holding the space keeps the bar from reflowing under the
              // reader as the name arrives.
              <Skeleton className="h-3.5 w-24" />
            ) : isCurrent ? (
              <span aria-current="page" className="truncate font-medium">
                {crumb.label}
              </span>
            ) : (
              <Link
                href={crumb.href}
                className="truncate text-[var(--color-ink-secondary)] transition-colors outline-none hover:text-[var(--color-ink)] focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}

/** A scope selector with its name attached, so the control is never a bare menu. */
function ScopeSelect({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <Tooltip title={label} content={hint}>
      <label className="flex items-center gap-1.5">
        <span className="eyebrow">{label}</span>
        {children}
      </label>
    </Tooltip>
  );
}

function UserMenu() {
  const enabled = authConfigured();
  const { data: email } = useQuery({
    queryKey: ['auth-user'],
    enabled,
    staleTime: Infinity,
    queryFn: async () => {
      const { data } = await getSupabaseBrowser().auth.getUser();
      return data.user?.email ?? null;
    },
  });

  if (!enabled || !email) return null;

  return (
    <div className="flex items-center gap-2 px-1">
      <span className="text-2xs grid size-7 shrink-0 place-items-center rounded-full bg-[var(--color-sunken)] font-semibold text-[var(--color-ink-secondary)] uppercase ring-1 ring-[var(--color-hairline)]">
        {email.slice(0, 2)}
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-[var(--color-ink-muted)]">{email}</span>
      <Tooltip title="Sign out" content="End this session and return to the login page.">
        <button
          type="button"
          aria-label="Sign out"
          onClick={() => {
            void getSupabaseBrowser()
              .auth.signOut()
              .then(() => window.location.assign('/login'));
          }}
          className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[var(--radius-control)] text-[var(--color-ink-muted)] transition-colors outline-none hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
        >
          <LogOut size={14} strokeWidth={2} />
        </button>
      </Tooltip>
    </div>
  );
}
