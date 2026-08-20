import 'server-only';
import { getDb, schema, type Database } from '@tangible/db';
import { HttpError } from '@/lib/route';

/**
 * The workspace domain lives in Supabase Postgres — the first thing in this app
 * that does. The market pages keep working without it; client work cannot, so
 * a missing DATABASE_URL is reported as exactly that rather than a stack trace.
 */
export function requireDb(): Database {
  if (!process.env.DATABASE_URL) {
    throw new HttpError(
      503,
      'The workspace needs Supabase Postgres. Set DATABASE_URL in .env — the market pages run without it, client engagements do not.',
    );
  }
  return getDb();
}

export { schema };
