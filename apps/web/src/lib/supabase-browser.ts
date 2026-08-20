import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Auth is optional the same way Supabase is optional everywhere else here:
 * without the public URL and anon key the app runs open, which is the local
 * development mode. With them set, the proxy (auth gate) enforces sign-in.
 */
export function authConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

let cached: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (!authConfigured()) {
    throw new Error('Supabase auth is not configured in this environment.');
  }
  cached ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
