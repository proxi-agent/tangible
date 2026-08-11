import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

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
  },
};

export default config;
