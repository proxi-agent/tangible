/**
 * Upload a Parquet export to object storage.
 *
 *   pnpm publish:parquet            # target chosen from .env
 *   pnpm publish:parquet r2
 *   pnpm publish:parquet supabase
 *
 * Whatever the target, the requirements are the same: serve plain HTTP GETs,
 * honour `Range`, and preserve paths. The bucket ends up public, which is both
 * required — DuckDB reads these unauthenticated — and appropriate: this is
 * county appraisal roll data, already public record. Nothing derived from a
 * private source goes through here.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST_FILENAME, resolveDataPath, type ParquetManifest } from '@tangible/analytics';
import type { Env } from '../config/env.js';
import { loadEnv } from './env.js';
import { reportAndExit } from './fail.js';
import { r2Target } from './targets/r2.js';
import { supabaseTarget } from './targets/supabase.js';
import type { PublishTarget } from './targets/target.js';

const CONCURRENCY = 6;

async function main(): Promise<void> {
  const env = loadEnv();
  const dir = resolveDataPath(process.env.PARQUET_DIR ?? './data/parquet');
  // Skip flags and pnpm's `--` separator when looking for the target name.
  const target = await pick(
    env,
    process.argv.slice(2).find((arg) => !arg.startsWith('-')),
  );

  const manifest = JSON.parse(
    await readFile(join(dir, MANIFEST_FILENAME), 'utf8'),
  ) as ParquetManifest;

  const files = manifest.tables.flatMap((table) => table.files);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);

  console.log(`Publishing ${files.length} files (${mb(total)}) to ${target.describe()}`);
  console.log(`Destination is publicly readable: ${target.publicBaseUrl()}`);

  // Publishing puts data on the open internet under someone's account, and a
  // dry run is the difference between checking what this command would do and
  // discovering it afterwards.
  if (process.argv.includes('--dry-run')) {
    console.log('\n--dry-run: nothing uploaded.');
    return;
  }

  await target.prepare();

  let uploaded = 0;
  let skipped = 0;
  await inParallel(files, CONCURRENCY, async (file) => {
    if (await target.isPresent(file.path, file.bytes)) {
      skipped++;
    } else {
      await target.put(file.path, await readFile(join(dir, file.path)), 'parquet');
      uploaded++;
    }
    process.stdout.write(`\r  ${uploaded + skipped}/${files.length}`);
  });

  // Written last, and never cached. The manifest is how a deployment discovers
  // which files exist, so a run that dies partway leaves the previous export
  // still fully described rather than pointing at objects that are not there.
  await target.put(MANIFEST_FILENAME, await readFile(join(dir, MANIFEST_FILENAME)), 'manifest');

  console.log(`\r  ${uploaded} uploaded, ${skipped} already present, manifest written.\n`);
  console.log('Set this on the Vercel project:');
  console.log(`  PARQUET_BASE_URL=${target.publicBaseUrl()}`);
}

/**
 * Explicit argument first, then whichever target is actually configured. R2
 * wins a tie: its egress is free, and this export is re-downloaded by every
 * cold instance.
 */
async function pick(env: Env, requested?: string): Promise<PublishTarget> {
  const targets: Record<string, () => PublishTarget> = {
    r2: () => r2Target(env),
    supabase: () => supabaseTarget(env),
  };

  if (requested) {
    const build = targets[requested.toLowerCase()];
    if (!build) throw new Error(`Unknown target '${requested}'. Use 'r2' or 'supabase'.`);
    return build();
  }

  if (env.R2_ACCOUNT_ID) return targets.r2!();
  if (env.SUPABASE_URL) return targets.supabase!();

  throw new Error(
    'No storage target configured. Set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY ' +
      '(recommended — R2 egress is free) or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.',
  );
}

async function inParallel<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) await worker(items[i]!);
    }),
  );
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

void main().catch(reportAndExit);
