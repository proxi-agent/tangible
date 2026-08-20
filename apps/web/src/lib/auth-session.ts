/**
 * How long a signed-in session survives in the browser.
 *
 * Supabase's default writes its auth cookies without an explicit lifetime, so
 * they behave as session cookies and a closed browser is a sign-out. For an
 * internal tool that a handful of people keep open across a filing season, being
 * asked to sign in again every morning is friction with no security return —
 * the allowlist is what actually decides who gets in, and it is checked on every
 * single request rather than at sign-in.
 *
 * A year of cookie life is not a year of unconditional access. The gate re-reads
 * the allowlist on each request, so removing an email locks that person out
 * immediately regardless of what cookie they hold, and revoking the session in
 * Supabase invalidates the refresh token the same way.
 *
 * What it does mean: a stolen browser profile is a stolen session for as long as
 * it takes to notice. That is a real trade, made deliberately for an internal
 * ops tool, and it should be revisited if this ever becomes customer-facing.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Applied to every auth cookie the SSR client writes, on both the browser and
 * the proxy — a lifetime set on only one of them is the confusing case, where a
 * session survives until the first token refresh and then quietly does not.
 */
export const SESSION_COOKIE_OPTIONS = {
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const;
