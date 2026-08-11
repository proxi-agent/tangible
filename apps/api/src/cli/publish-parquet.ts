/**
 * Upload a Parquet export to Supabase Storage.
 *
 *   pnpm publish:parquet                 # bucket 'warehouse'
 *   pnpm publish:parquet my-bucket
 *
 * Needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. The bucket is public,
 * which is both required — DuckDB reads these with plain unauthenticated GETs —
 * and appropriate: this is county appraisal roll data, already public record.
 * Nothing derived from a private source goes through here.
 */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MANIFEST_FILENAME, resolveDataPath, type ParquetManifest } from '@tangible/analytics';
import { loadEnv } from './env.js';
import { reportAndExit } from './fail.js';

const CONCURRENCY = 6;
/** Exports are immutable — a republish writes a new manifest, not new bytes. */
const CACHE_CONTROL = '31536000';

async function main(): Promise<void> {
  const env = loadEnv();
  const bucket = process.argv[2] ?? process.env.PARQUET_BUCKET ?? 'warehouse';
  const dir = resolveDataPath(process.env.PARQUET_DIR ?? './data/parquet');

  const supabaseUrl = required('SUPABASE_URL', env.SUPABASE_URL);
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY);
  const api = supabaseUrl.replace(/\/+$/, '');

  const manifest = JSON.parse(
    await readFile(join(dir, MANIFEST_FILENAME), 'utf8'),
  ) as ParquetManifest;

  // The manifest is uploaded last, so a run that dies partway leaves the
  // previous export still fully described and readable rather than pointing at
  // files that are not there yet.
  const files = manifest.tables.flatMap((table) => table.files);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);

  console.log(`Publishing ${files.length} files (${mb(total)}) to ${api}/…/${bucket}`);
  await ensureBucket(api, serviceKey, bucket);

  let uploaded = 0;
  let skipped = 0;
  await inParallel(files, CONCURRENCY, async (file) => {
    const url = publicUrl(api, bucket, file.path);
    if (await alreadyThere(url, file.bytes)) {
      skipped++;
      return;
    }
    await upload(api, serviceKey, bucket, file.path, join(dir, file.path));
    uploaded++;
    process.stdout.write(`\r  ${uploaded + skipped}/${files.length}`);
  });

  await upload(api, serviceKey, bucket, MANIFEST_FILENAME, join(dir, MANIFEST_FILENAME), {
    contentType: 'application/json',
    // The one mutable object in the export: it is how a deployment discovers
    // that a new generation exists, so it must not be cached.
    cacheControl: '0',
  });

  console.log(`\r  ${uploaded} uploaded, ${skipped} already present, manifest written.\n`);
  console.log('Set this on the Vercel project:');
  console.log(`  PARQUET_BASE_URL=${api}/storage/v1/object/public/${bucket}`);
}

function required(name: string, value: string | undefined): string {
  if (!value || /your-|example\.com/.test(value)) {
    throw new Error(`${name} is not set in .env (Supabase dashboard → Project Settings → API).`);
  }
  return value;
}

function publicUrl(api: string, bucket: string, path: string): string {
  return `${api}/storage/v1/object/public/${bucket}/${path}`;
}

/**
 * Create the bucket unless it exists. A 409 means someone got there first,
 * which is the desired end state either way.
 */
async function ensureBucket(api: string, key: string, bucket: string): Promise<void> {
  const response = await fetch(`${api}/storage/v1/bucket`, {
    method: 'POST',
    headers: { ...auth(key), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: bucket, name: bucket, public: true }),
  });
  if (response.ok || response.status === 409) return;
  const body = await response.text();
  if (/already exists/i.test(body)) return;
  throw new Error(`Could not create bucket '${bucket}': ${response.status} ${body}`);
}

/** Resume support: a file of the right length is already fully uploaded. */
async function alreadyThere(url: string, bytes: number): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    return response.ok && Number(response.headers.get('content-length')) === bytes;
  } catch {
    return false;
  }
}

async function upload(
  api: string,
  key: string,
  bucket: string,
  path: string,
  source: string,
  options: { contentType?: string; cacheControl?: string } = {},
): Promise<void> {
  const body = await readFile(source);
  const response = await fetch(`${api}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      ...auth(key),
      'Content-Type': options.contentType ?? 'application/vnd.apache.parquet',
      'Cache-Control': options.cacheControl ?? CACHE_CONTROL,
      // Republishing the same path must overwrite rather than 409.
      'x-upsert': 'true',
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Upload of ${path} failed: ${response.status} ${await response.text()}`);
  }
  const written = (await stat(source)).size;
  if (written !== body.byteLength) {
    throw new Error(`${path} changed while uploading; re-run publish.`);
  }
}

function auth(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, apikey: key };
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
