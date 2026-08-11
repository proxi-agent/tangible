import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

let cachedDb: Database | null = null;
let cachedSql: ReturnType<typeof postgres> | null = null;

/**
 * Drizzle client over Supabase Postgres.
 *
 * Point `DATABASE_URL` at the pooled (6543) connection for the running app and
 * the direct (5432) connection for migrations — Supabase's transaction pooler
 * does not support prepared statements, which is why they are disabled here.
 */
export function getDb(connectionString = process.env.DATABASE_URL): Database {
  if (cachedDb) return cachedDb;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set — copy .env.example to .env and fill it in.');
  }

  cachedSql = postgres(connectionString, { prepare: false, max: 10 });
  cachedDb = drizzle(cachedSql, { schema });
  return cachedDb;
}

export async function closeDb(): Promise<void> {
  await cachedSql?.end();
  cachedSql = null;
  cachedDb = null;
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
  return createClient(url, key, { auth: { persistSession: false } });
}

export { schema };
