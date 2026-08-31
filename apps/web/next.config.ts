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
 * Two bundler facts, both load-bearing.
 *
 * `turbopackScopeHoisting: false` is here because with it on, the Turbopack
 * build dies collecting page data: "Cannot access 'x' before initialization",
 * pointed into @tangible/types. It is not a circular import — that package's 33
 * modules have no cycle, and nothing in the app graph re-enters it. It is the
 * hoisting itself. Turbopack merges every types module into one chunk scope,
 * collapses their separate `import { z } from 'zod'` bindings onto a single
 * name, and then emits a self-referential re-declaration of that name once per
 * merged module — `var nU = nU;`, ninety of them in one chunk, readable in
 * .next/server/chunks. Harmless as `var`; where the same collapse lands in a
 * lexical declaration, evaluating the module is a temporal-dead-zone error.
 * The route named in the failure varies run to run because eleven page-data
 * workers race, so the route is never the cause. Re-try dropping this on a
 * future Next upgrade — the fix is upstream.
 *
 * `next build --webpack` (package.json) is a separate, softer choice. The
 * webpack build was never affected by the above, and it produces a 15 MB
 * .next/server against Turbopack-without-hoisting's 164 MB. That difference is
 * duplication across 147 routes, not weight on any one function — per-function
 * output peaks at 3.0 MB either way, well inside any platform limit — so it is
 * about build and upload time, not about whether we can deploy. Turbopack
 * builds, boots and traces correctly (both blank Comptroller PDFs and the
 * duckdb bindings land in the route .nft.json files); webpack stays the shipped
 * path because it is proven and cheaper, not because Turbopack is broken.
 */
const config: NextConfig = {
  reactStrictMode: true,
  // The shared packages ship TypeScript-built ESM; let Next compile them in-place
  // so a change in a package is picked up without a separate build step.
  transpilePackages: ['@tangible/types'],

  experimental: { turbopackScopeHoisting: false },

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
     * The Comptroller's blank forms — 50-144 (rendition), 50-162 (agent
     * appointment), 50-132 (notice of protest), 50-771 (the 25.25(c) and (c-1)
     * motion) and 50-230 (the (d) motion) — read at runtime by
     * `@tangible/filing` through `new URL('../assets/…', import.meta.url)`.
     * The tracer follows imports, and that is a filesystem read rather than an
     * import, so nothing would point it at the one file each PDF route exists
     * to fill.
     *
     * Every route that reaches a filler needs its own entry: the draft
     * rendition, the *filed* rendition reprinted from its frozen inputs, the
     * appointment, the protest, and the motion. Miss one and it deploys clean,
     * then ENOENTs on the first download — which the route reports as a 409, as
     * though the form had refused to print something misleading.
     *
     * The glob is every blank rather than the one each route reads: naming one
     * file per route is a list that goes stale silently, and a stale entry
     * deploys clean and then breaks on whichever form nobody clicked.
     */
    '/api/engagements/[engagementId]/rendition/pdf': ['../../packages/filing/assets/*.pdf'],
    '/api/engagements/[engagementId]/motion-draft/pdf': ['../../packages/filing/assets/*.pdf'],
    '/api/filings/[filingId]/pdf': ['../../packages/filing/assets/*.pdf'],
    '/api/appointments/[appointmentId]/pdf': ['../../packages/filing/assets/*.pdf'],
    '/api/notices/[noticeId]/protest': ['../../packages/filing/assets/*.pdf'],
  },
};

export default config;
