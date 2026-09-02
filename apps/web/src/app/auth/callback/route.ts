import { createServerClient, type SetAllCookies } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { SESSION_COOKIE_OPTIONS, safeNext } from '@/lib/auth-session';
import { audienceFor } from '@/lib/portal-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where a link in an email lands.
 *
 * Until this existed the product could mail a client and had nowhere to put
 * them: `portal_users` granted reach, Supabase sent an invitation, and the link
 * in it arrived at an application with no route that could turn it into a
 * session. The grant was real, the mail went out, and the business could not
 * sign in — which is the worst shape a failure can take, because everything
 * upstream reports success.
 *
 * Two forms are accepted, because two different things generate these links and
 * they do not agree on a format:
 *
 *   - **`?code=`** — the PKCE exchange. This is what the login form's magic
 *     link produces: the browser client stored a verifier in a cookie when it
 *     asked for the mail, and the exchange here needs both halves, which is why
 *     it happens on the server rather than in the page.
 *   - **`?token_hash=&type=`** — the older one-shot form, still what Supabase's
 *     own templates emit for recovery and email-change. Costs ten lines and
 *     means a link generated from the dashboard works rather than dead-ending.
 *
 * The audience is decided here rather than left to the next request, for one
 * reason: an address on neither list would otherwise be handed a working
 * session and bounced around the proxy to a login page it is already past. It
 * gets the plain refusal instead, which is the screen that has a sign-out
 * button on it.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  const to = (path: string) => NextResponse.redirect(new URL(path, request.nextUrl.origin));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  /**
   * Auth unconfigured is the local development mode and the app runs open, so
   * there is no session to establish and nothing to refuse. Sending them to the
   * workspace is the same answer the proxy gives every other request.
   */
  if (!url || !anonKey) return to('/clients');

  /**
   * Supabase reports its own refusals on the query string rather than by
   * failing the redirect: an expired link, or one that has already been spent.
   * Both are ordinary — a magic link is single-use and a client who clicks the
   * mail twice hits this — so it is worth its own message rather than the
   * generic one.
   */
  if (params.get('error') ?? params.get('error_description')) return to('/login?error=link');

  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  if (!code && !tokenHash) return to('/login?error=link');

  /**
   * Held rather than written as they arrive. The refreshed cookies have to ride
   * on the redirect, and the redirect's destination is not known until the
   * exchange below has said who this is.
   */
  const pending: Parameters<SetAllCookies>[0] = [];
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies) => {
        pending.push(...cookies);
      },
    },
  });

  const { data, error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: (params.get('type') ?? 'email') as EmailOtpType,
      });

  if (error || !data.user?.email) {
    console.info('[auth] a sign-in link did not resolve', error?.message);
    return to('/login?error=link');
  }

  const decided = await audienceFor(data.user.email);
  const destination =
    decided.audience === 'none'
      ? '/login?error=denied'
      : (safeNext(params.get('next')) ??
        (decided.audience === 'firm' ? '/clients' : '/portal'));

  const response = NextResponse.redirect(new URL(destination, request.nextUrl.origin));
  for (const { name, value, options } of pending) {
    // The long lifetime is applied here as well as in the browser and the
    // proxy. A session that began at a mailed link and quietly expired in a day
    // — because this one write used Supabase's default — is the confusing case.
    response.cookies.set(name, value, { ...options, ...SESSION_COOKIE_OPTIONS });
  }
  return response;
}
