import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

/**
 * Walk up from the current working directory to the workspace root — the
 * directory holding pnpm-workspace.yaml.
 */
export function findRepoRoot(startDir = process.cwd()): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(startDir);
    dir = parent;
  }
}

/**
 * Resolve a configured path against the repo root rather than the process's
 * working directory.
 *
 * `DUCKDB_PATH=./data/tangible.duckdb` must mean the same file whether it is
 * read by the API (cwd `apps/api`), the ingest CLI (cwd wherever you ran it),
 * or a script. Left cwd-relative, seeding and serving quietly use different
 * databases and the dashboard comes up empty for no visible reason.
 */
export function resolveDataPath(configured: string, repoRoot = findRepoRoot()): string {
  if (configured === ':memory:') return configured;
  if (isAbsolute(configured)) return configured;
  return resolve(repoRoot, configured);
}
