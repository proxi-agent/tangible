import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Who is doing this, for the fields that record a decision.
 *
 * The proxy has already decided whether the request is allowed; this only asks
 * *whose* it is. Two reasons it reads the session again rather than trusting a
 * header: a header the proxy sets is a header a caller could set, and the
 * dispositions this stamps are the audit trail for what a client was told and
 * agreed to — the one place in the app where the name being wrong is worse
 * than it being absent.
 *
 * Null when auth is not configured, which is the local development mode. A row
 * with no name recorded is honest about a deployment where there were no names
 * to record; inventing "system" would not be.
 */
export async function currentActor(): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const store = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      // Read-only: a route handler cannot always write cookies, and a refresh
      // performed here would be discarded anyway — the proxy already refreshed
      // this session on the way in.
      setAll: () => {},
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.email ?? null;
}
