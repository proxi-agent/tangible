import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

/**
 * The single source of env truth is the repo-root .env (apps/api loads the same
 * file). Next only auto-loads env from its own directory, so it is loaded here
 * — this runs before anything else in the server process. Real environment
 * variables win over the file, and a deployment has no file at all: both are
 * the --env-file semantics loadEnvFile follows.
 */
try {
  process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch {
  // No .env — a deployment, or a fresh checkout running on defaults.
}

/**
 * Production builds run webpack (`next build --webpack` in package.json): the
 * Turbopack build chunks this module graph into a cycle and dies collecting
 * page data with "Cannot access 'b' before initialization" in @tangible/types,
 * while dev (Turbopack) and the webpack build are both fine. Re-try dropping
 * the flag on a future Next upgrade.
 */
const config: NextConfig = {
  reactStrictMode: true,
  // The shared packages ship TypeScript-built ESM; let Next compile them in-place
  // so a change in a package is picked up without a separate build step.
  transpilePackages: ['@tangible/types'],

  /**
   * DuckDB is a native addon: a `.node` binding plus a ~70 MB shared library.
   * Bundling would rewrite the require that loads it and the library would not
   * be found at runtime, so it is left external and resolved from node_modules.
   */
  serverExternalPackages: ['@duckdb/node-api'],

  /**
   * File tracing decides which node_modules files get uploaded with the
   * function. In a pnpm monorepo the real packages live in the workspace root's
   * store and are reached through symlinks, so tracing rooted at `apps/web`
   * would follow them out of scope and ship a function without its bindings.
   */
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),

  /**
   * The tracer follows `duckdb.node` but not the 70 MB `libduckdb` shared
   * library it dynamically links against — nothing in the JavaScript references
   * it, so nothing points the tracer at it. Left out, every route deploys
   * cleanly and then fails on the first query with a loader error.
   *
   * The platform package is an optional dependency chosen at install time, so
   * the glob covers all of them and matches whichever one the build host got.
   */
  outputFileTracingIncludes: {
    '/api/**': ['../../node_modules/.pnpm/@duckdb+node-bindings-*/node_modules/@duckdb/**/*'],
    /**
     * The Comptroller's blank forms — 50-144 (rendition) and 50-162 (agent
     * appointment) — read at runtime by `@tangible/filing` through
     * `new URL('../assets/…', import.meta.url)`. The tracer follows imports,
     * and that is a filesystem read rather than an import, so nothing would
     * point it at the one file each PDF route exists to fill.
     *
     * Every route that reaches a filler needs its own entry: the draft
     * rendition, the *filed* rendition reprinted from its frozen inputs, and
     * the appointment. Miss one and it deploys clean, then ENOENTs on the
     * first download — which the route reports as a 409, as though the form
     * had refused to print something misleading.
     */
    '/api/engagements/[engagementId]/rendition/pdf': ['../../packages/filing/assets/*.pdf'],
    '/api/filings/[filingId]/pdf': ['../../packages/filing/assets/*.pdf'],
    '/api/appointments/[appointmentId]/pdf': ['../../packages/filing/assets/*.pdf'],
  },
};

export default config;
