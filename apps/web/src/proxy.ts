import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_OPTIONS } from '@/lib/auth-session';
import { audienceFor, claimGrant } from '@/lib/portal-access';

/**
 * The auth gate, for two audiences.
 *
 * The app holds confidential business data — client registers and filed
 * renditions, confidential under Tax Code 22.27 — so everything, pages and API
 * alike, sits behind sign-in whenever Supabase auth is configured. Without the
 * public URL and anon key the app runs open, which is the local development
 * mode; the market pages hold only public-record data, so that is a policy
 * choice rather than an accident.
 *
 * What changed here is that "signed in" is no longer one thing. The firm is
 * admitted by the `AUTH_ALLOWED_EMAILS` allowlist and reaches the whole
 * workspace. A client is admitted by a `portal_users` grant and reaches exactly
 * one wing: `/portal`, and the handful of endpoints it calls. That second rule
 * is enforced twice on purpose — here by path, and again in each handler by
 * asking whether the row belongs to the caller's own client. This layer cannot
 * do the second check, because `/api/engagements/<uuid>/savings` does not say
 * whose engagement it is; the handlers cannot do the first cheaply, because
 * there are eighty-eight of them.
 */

export async function proxy(request: NextRequest) {
  /**
   * The scheduled runner is not a person and has no session. It presents
   * `CRON_SECRET` instead, checked by the handler itself, and refuses when that
   * is unset — so letting it past the session gate here does not open anything.
   * It is written as an exact path, not a prefix: `/api/runs/` as a prefix
   * would admit whatever else is put under it later.
   */
  if (request.nextUrl.pathname === '/api/runs/drain') return NextResponse.next();

  /**
   * An uptime monitor cannot sign in either, and one that could would only be
   * proving that sign-in works. This is the endpoint it calls, and it answers
   * anonymously with which dependencies replied and nothing more — the detail
   * and the warehouse diagnostics need `CRON_SECRET`, checked in the handler.
   * Exact path again, for the same reason: a prefix admits whatever is added
   * under it later.
   */
  if (request.nextUrl.pathname === '/api/health') return NextResponse.next();

  /** The probe beside it is the scheduled runner again, and checks the same secret. */
  if (request.nextUrl.pathname === '/api/health/probe') return NextResponse.next();

  /**
   * And the weekly engine digest, which is the same runner a third time. Exact
   * path, and note that it is deliberately *not* `/api/quality/digest` — that
   * one is the firm's screen and must stay behind the session gate. The sibling
   * `/send` is the only thing here a machine calls.
   */
  if (request.nextUrl.pathname === '/api/quality/digest/send') return NextResponse.next();

  /**
   * Where a mailed link lands, and the one route that has to run *before* there
   * is a session — establishing one is its whole job. Sent through the gate it
   * would be redirected to the login page it was on its way to replace, which
   * is how the invitation mail dead-ended before this route existed.
   *
   * Letting it past opens nothing: it accepts a Supabase authorization code or
   * token hash and does nothing at all without one, and the account it signs in
   * is admitted by the same two lists as every other account.
   */
  if (request.nextUrl.pathname === '/auth/callback') return NextResponse.next();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        // Refreshed session cookies must reach both the handler (request) and
        // the browser (response) — dropping either half logs users out at
        // exactly the token-refresh boundary, which reads as random.
        for (const { name, value } of cookies) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookies) {
          // The long lifetime is applied here as well as in the browser client:
          // a refresh that rewrote the cookie with Supabase's default would
          // silently shorten a session that started out as a year.
          response.cookies.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const decided = user?.email ? await audienceFor(user.email) : null;

  if (pathname.startsWith('/login')) {
    // Somebody already admitted has no business on the login page. Where they
    // go depends on which product they are: the firm's home is the client list,
    // and a business's home is its own report.
    if (decided && decided.audience !== 'none') {
      const home = request.nextUrl.clone();
      home.pathname = decided.audience === 'firm' ? '/clients' : '/portal';
      home.search = '';
      return NextResponse.redirect(home);
    }
    return response;
  }

  if (decided?.audience === 'firm') return response;

  if (decided?.audience === 'client') {
    /**
     * Stamped once, the first time a grant is used. Awaited rather than
     * detached: middleware returning ends the invocation, and a floating
     * promise on a serverless platform is a write that may or may not land.
     * It is one indexed update against a row already in cache.
     */
    if (user?.id) {
      const already = request.cookies.get(CLAIM_COOKIE)?.value === decided.grantId;
      if (!already) {
        await claimGrant(decided.grantId, user.id);
        response.cookies.set(CLAIM_COOKIE, decided.grantId, {
          httpOnly: true,
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 30,
          path: '/',
        });
      }
    }

    if (clientMayReach(pathname)) return response;

    /**
     * A refusal here is about a *wing*, not a record. Nothing is confirmed by
     * saying the workspace exists — its existence is not the secret, the data
     * inside it is — so this answers plainly rather than pretending the route
     * is missing. The handlers take the opposite line: a client asking for
     * another business's engagement gets a 404, because there a 403 would
     * confirm the id is real.
     */
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ statusCode: 403, message: DENIAL.wing }, { status: 403 });
    }
    const portal = request.nextUrl.clone();
    portal.pathname = '/portal';
    portal.search = '';
    return NextResponse.redirect(portal);
  }

  const reason = user === null ? 'signin' : firmListEmpty() ? 'noallowlist' : 'denied';

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ statusCode: 401, message: DENIAL[reason] }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = '/login';
  login.search = '';
  if (reason !== 'signin') login.searchParams.set('error', reason);
  /**
   * Carry where they were trying to go. A session that lapses overnight sends
   * the practitioner here from a half-finished return, and without this they
   * sign back in and land on the client list with the address gone. Only the
   * path and query travel — the login page refuses anything that is not a
   * same-origin path, so this cannot become an open redirect.
   */
  if (pathname !== '/' && reason === 'signin') {
    login.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
  }
  return NextResponse.redirect(login);
}

/** Remembers that this grant has been stamped, so the write happens once. */
const CLAIM_COOKIE = 'tangible-portal-claim';

function firmListEmpty(): boolean {
  return (process.env.AUTH_ALLOWED_EMAILS ?? '').trim().length === 0;
}

/**
 * What the client wing is allowed to address.
 *
 * An allowlist rather than a blocklist, and written as whole-path patterns
 * rather than prefixes. The distinction matters: `/api/clients/` as a prefix
 * would also admit `/api/clients/<id>/deletion`, which erases a business.
 *
 * Every entry here corresponds to something a page under `/portal` actually
 * calls. Adding a call to the client wing means adding a line here, which is
 * the intended friction — the alternative is a wing that quietly grows reach
 * because a component imported a convenient endpoint.
 */
const UUID = '[0-9a-fA-F-]{36}';
const CLIENT_ROUTES: RegExp[] = [
  // Who this browser is. The shell asks before it can draw anything at all,
  // so a client refused here sees an empty portal rather than their own.
  /^\/api\/viewer$/,
  // The business itself, and its seasons. The handler checks it is their own.
  new RegExp(`^/api/clients/${UUID}$`),
  // How far along the season is — what the shell asks before it draws the rail.
  new RegExp(`^/api/engagements/${UUID}/stage$`),
  // The report, and the run that published it.
  new RegExp(`^/api/engagements/${UUID}/savings$`),
  new RegExp(`^/api/engagements/${UUID}/report$`),
  new RegExp(`^/api/engagements/${UUID}/runs$`),
  new RegExp(`^/api/engagements/${UUID}/sites$`),
  // Sending files, and seeing what was received.
  new RegExp(`^/api/engagements/${UUID}/intake$`),
  // The questions we ask, and the answers they give.
  new RegExp(`^/api/engagements/${UUID}/asks$`),
  new RegExp(`^/api/asks/${UUID}$`),
  // Asking the record a question of their own.
  new RegExp(`^/api/engagements/${UUID}/ask$`),
  // The ranked queue across every finding — the way the report is worked.
  new RegExp(`^/api/engagements/${UUID}/findings/queue$`),
  // Working a finding row by row: the population, the decisions, the workpaper.
  new RegExp(`^/api/engagements/${UUID}/findings/rows$`),
  new RegExp(`^/api/engagements/${UUID}/findings/rows/export$`),
  // One asset in full. The handler withholds the firm's own working notes.
  new RegExp(`^/api/engagements/${UUID}/assets/${UUID}$`),
  // What was claimed on their behalf and what came back. Read-only, and a
  // different path from the firm's `/recovery`, which also records settlements
  // — this layer matches paths and cannot tell a GET from a POST.
  new RegExp(`^/api/engagements/${UUID}/recovery/statement$`),
  // Where their returns stand: the deadline, what was filed, what the district
  // answered. Again a sub-path rather than the firm's `/season`, which carries
  // our own blocker list and is not theirs to read.
  new RegExp(`^/api/engagements/${UUID}/returns/statement$`),
  // How much confidence they want to see by default. Theirs to set.
  new RegExp(`^/api/clients/${UUID}/portal-settings$`),
];

function clientMayReach(pathname: string): boolean {
  if (pathname === '/portal' || pathname.startsWith('/portal/')) return true;
  if (!pathname.startsWith('/api/')) return false;
  return CLIENT_ROUTES.some((pattern) => pattern.test(pathname));
}

const DENIAL: Record<string, string> = {
  signin: 'Sign in required.',
  denied: 'This account has not been given access to anything in this workspace.',
  noallowlist:
    'No AUTH_ALLOWED_EMAILS allowlist is configured, so no firm account can be admitted. Set it to the emails that may use this workspace.',
  wing: 'This account reaches its own portal only.',
};

export const config = {
  // Static assets stay public; everything else goes through the gate.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
