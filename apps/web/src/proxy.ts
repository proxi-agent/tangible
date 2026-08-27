import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_OPTIONS } from '@/lib/auth-session';

/**
 * The auth gate. The moment the first client FAR lands, this app holds
 * confidential business data, so everything — pages and API alike — sits
 * behind sign-in whenever Supabase auth is configured. Without the public
 * URL and anon key the app runs open, which is the local development mode;
 * the market pages hold only public-record data, so that is a policy choice,
 * not an accident.
 */

export async function proxy(request: NextRequest) {
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
  const allowlist = allowedEmails();
  const allowed =
    user !== null && user.email !== undefined && allowlist.includes(user.email.toLowerCase());

  if (pathname.startsWith('/login')) {
    // A signed-in, allowed user has no business on the login page.
    if (allowed) {
      const home = request.nextUrl.clone();
      home.pathname = '/clients';
      home.search = '';
      return NextResponse.redirect(home);
    }
    return response;
  }

  if (allowed) return response;

  const reason = user === null ? 'signin' : allowlist.length === 0 ? 'noallowlist' : 'denied';

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

const DENIAL: Record<string, string> = {
  signin: 'Sign in required.',
  denied: 'This account is not on the allowlist for this workspace.',
  noallowlist:
    'No AUTH_ALLOWED_EMAILS allowlist is configured, so no account can be admitted. Set it to the emails that may use this workspace.',
};

/**
 * Who may use this workspace, by email.
 *
 * The gate fails closed: with auth configured but no allowlist, nobody gets in.
 * Admitting every authenticated account would be a real hole rather than a
 * lenient default — the anon key ships to the browser by design, Supabase
 * projects allow email signup by default, and what sits behind this gate is
 * confidential client asset data. An empty allowlist is a misconfiguration, and
 * it should read as one instead of quietly opening the door.
 */
function allowedEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export const config = {
  // Static assets stay public; everything else goes through the gate.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
