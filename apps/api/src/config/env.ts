import { z } from 'zod';
import { resolveDataPath } from './paths.js';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  /** DuckDB warehouse file. ':memory:' is valid and useful for tests. */
  DUCKDB_PATH: z.string().default('./data/tangible.duckdb'),
  /** Where downloaded county archives are staged. */
  DATA_DIR: z.string().default('./data/raw'),
  DUCKDB_MEMORY_LIMIT: z.string().default('4GB'),
  DUCKDB_THREADS: z.coerce.number().int().positive().default(4),

  /**
   * Supabase is optional in local development — the warehouse alone is enough to
   * explore the data. Ingest history and saved lists simply are not persisted
   * when it is absent, and the API says so rather than failing at boot.
   */
  DATABASE_URL: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),

  /**
   * Cloudflare R2, the preferred home for the published export.
   *
   * Egress is free, which matters more here than it looks: every cold instance
   * pulls the whole ~95MB export to its local disk, and on a metered store that
   * is the dominant cost of running the dashboard.
   */
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('tangible-warehouse'),
  /** The bucket's public origin — an r2.dev URL or a custom domain. */
  R2_PUBLIC_BASE_URL: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = EnvSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  // Anchor data paths to the repo root so every entry point — API, CLI, scripts —
  // reads and writes the same warehouse regardless of where it was invoked.
  return {
    ...result.data,
    DUCKDB_PATH: resolveDataPath(result.data.DUCKDB_PATH),
    DATA_DIR: resolveDataPath(result.data.DATA_DIR),
  };
}
