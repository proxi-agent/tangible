import 'server-only';
import { getDb, schema, type Database } from '@tangible/db';
import { HttpError } from '@/lib/http';
import { currentScope } from '@/lib/db-scope';

/**
 * The workspace domain lives in Supabase Postgres — the first thing in this app
 * that does. The market pages keep working without it; client work cannot, so
 * a missing DATABASE_URL is reported as exactly that rather than a stack trace.
 *
 * When a client's request is being served, `handle()` has already opened a
 * transaction on the role that enforces row-level security, and this returns
 * that transaction instead. Every caller — the forty-odd functions in this
 * directory, none of which knows who is asking — gets the right connection
 * without a `db` argument threaded through all of them, and the two cases the
 * threading would inevitably get wrong (a helper called from both wings, a new
 * helper written by someone who has not read this file) get it right by
 * default.
 */
export function requireDb(): Database {
  const scoped = currentScope();
  if (scoped) return scoped;

  if (!process.env.DATABASE_URL) {
    throw new HttpError(
      503,
      'The workspace needs Supabase Postgres. Set DATABASE_URL in .env — the market pages run without it, client engagements do not.',
    );
  }
  return getDb();
}

export { schema };
