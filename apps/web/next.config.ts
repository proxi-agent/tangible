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
 * The build is Turbopack, on the default settings. Both reasons it was not are
 * gone, and it is worth writing down which one was a bug and which one was a
 * measurement mistake.
 *
 * The bug was real. `experimental.turbopackScopeHoisting: false` used to sit
 * here because with hoisting on, the build died collecting page data —
 * "Cannot access 'x' before initialization", pointed into @tangible/types.
 * Turbopack merged that package's modules into one chunk scope, collapsed their
 * separate `import { z } from 'zod'` bindings onto a single name, and emitted a
 * self-referential re-declaration of it once per merged module. Fixed upstream:
 * on Next 16.3.3 the default build completes, boots, and traces.
 *
 * The measurement was wrong. `next build --webpack` was kept on the grounds
 * that webpack produced a 15 MB `.next/server` against Turbopack's 164 MB. That
 * comparison was source maps against no source maps. Turbopack emits server
 * source maps by default and webpack does not: of Turbopack's 196 MB here, 154
 * MB is `.map` files, and the emitted JavaScript is 28 MB against webpack's
 * 18 MB. No `.map` appears in any of the 156 route `.nft.json` files, so none
 * of it was ever function weight, and the whole `.next` is *smaller* on
 * Turbopack — 538 MB against 667 MB. Keep the maps: they are what makes a
 * production stack trace in the incidents surface readable.
 *
 * What was left is a build that is roughly 40% faster — 23s against 38s on this
 * machine — and one bundler shared with `next dev` instead of two that can
 * disagree.
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
