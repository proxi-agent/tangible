import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

/**
 * The pool is cached on `globalThis`, not in module scope.
 *
 * Module scope is not stable enough in either place this runs. Next's dev
 * server re-evaluates the module graph on every edit, so a module-scoped cache
 * leaks a whole pool per reload until Postgres starts refusing connections —
 * the classic "too many clients" after twenty minutes of editing. Serverless
 * reuses a warm instance across invocations but not across module identities.
 * A global survives both.
 */
type DbCache = { db: Database | null; sql: ReturnType<typeof postgres> | null };
const cache: DbCache = ((globalThis as { __tangibleDb?: DbCache }).__tangibleDb ??= {
  db: null,
  sql: null,
});
const clientCache: DbCache = ((
  globalThis as { __tangibleClientDb?: DbCache }
).__tangibleClientDb ??= {
  db: null,
  sql: null,
});

/** Vercel and Lambda both set these; neither is set by `next dev` on a laptop. */
function serverless(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Drizzle client over Supabase Postgres.
 *
 * Point `DATABASE_URL` at the pooled (6543) connection for the running app and
 * the direct (5432) connection for migrations — Supabase's transaction pooler
 * does not support prepared statements, which is why they are disabled here.
 *
 * Pool size is per *process*, and serverless multiplies processes: twenty warm
 * lambdas holding ten connections each is two hundred against a pooler that
 * allows a small fraction of that, and the failure is not this request but
 * every other request in the deployment. One connection per instance is the
 * right size when the platform already provides the concurrency — a lambda
 * serves one request at a time, so a second connection only sits idle. Locally
 * one process serves everything, so it keeps the wider pool.
 */
export function getDb(connectionString = process.env.DATABASE_URL): Database {
  if (cache.db) return cache.db;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env and fill it in.');
  }

  cache.sql = postgres(connectionString, {
    prepare: false,
    max: serverless() ? 1 : 10,
    // Hand connections back rather than pinning one per frozen instance; the
    // pooler reclaims them while the lambda waits for its next request.
    idle_timeout: 20,
    // Without this a pooler that accepts the socket and never answers hangs
    // until the platform's own timeout, and an actionable "cannot reach the
    // database" arrives as an opaque 504.
    connect_timeout: 10,
  });
  cache.db = drizzle(cache.sql, { schema });
  return cache.db;
}

/**
 * The same database, reached as a role that does not bypass row-level security.
 *
 * `getDb` connects as the owner, and an owner-level role carries BYPASSRLS — so
 * the policies in `sql/tenancy.sql` are invisible to it. That is correct for the
 * firm's own screens, which read across every client by design, and useless as a
 * boundary. This connection is the boundary: it is what a signed-in client's
 * request runs on, inside a transaction that first says which client is asking.
 *
 * Two pools rather than one connection that switches roles, because `set role`
 * is reversible by anything that can run SQL and a separate login is not. If the
 * variable is unset this throws rather than falling back to `getDb`, since the
 * fallback would be a connection that quietly sees everything.
 */
export function getClientDb(connectionString = process.env.CLIENT_DATABASE_URL): Database {
  if (clientCache.db) return clientCache.db;
  if (!connectionString) {
    throw new Error(
      'CLIENT_DATABASE_URL is not set, so there is no connection that enforces tenancy. Run packages/db/scripts/apply-tenancy.mjs and set the value it prints.',
    );
  }

  clientCache.sql = postgres(connectionString, {
    prepare: false,
    max: serverless() ? 1 : 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  clientCache.db = drizzle(clientCache.sql, { schema });
  return clientCache.db;
}

export async function closeDb(): Promise<void> {
  await cache.sql?.end();
  cache.sql = null;
  cache.db = null;
  await clientCache.sql?.end();
  clientCache.sql = null;
  clientCache.db = null;
}

/**
 * Service-role Supabase client, for anything that needs the platform rather
 * than plain SQL (storage, auth admin). Never expose this key to the browser.
 */
export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.');
  }
  const store = globalThis as { __tangibleSupabaseAdmin?: SupabaseClient };
  return (store.__tangibleSupabaseAdmin ??= createClient(url, key, {
    auth: { persistSession: false },
  }));
}

export { schema };
