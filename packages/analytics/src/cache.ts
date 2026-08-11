import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ParquetFile, ParquetManifest } from './remote.js';

/**
 * Copying a published export onto the instance's local disk.
 *
 * Reading Parquet over HTTP works, but every query pays the round trip on each
 * of the couple of thousand range requests a page load makes. Measured against
 * a same-region object store that costs roughly 1.5x, and against a distant one
 * closer to 2.5x. The data is a hundred megabytes and does not change between
 * exports, so the instance can just hold a copy.
 *
 * This is a cache, not a dependency: every failure path falls back to reading
 * over HTTP. A deployment that cannot write to disk, or has less space than the
 * export needs, gets slower — never broken.
 */

export interface ParquetCacheOptions {
  /** Where to put the copy. Defaults to a directory under the system temp dir. */
  dir?: string;
  /**
   * Refuse to cache an export larger than this. Serverless temp space is small
   * and fixed — Vercel gives 512 MB — and filling it fails in ways that have
   * nothing to do with the query being run.
   */
  maxBytes?: number;
  /** Files fetched at once. Cold start is dominated by this. */
  concurrency?: number;
  logger?: (message: string) => void;
}

export interface ParquetCacheResult {
  /** Local directory to read from, usable as a base URL. */
  dir: string;
  downloaded: number;
  reused: number;
  bytes: number;
  durationMs: number;
}

export const DEFAULT_CACHE_MAX_BYTES = 400 * 1024 * 1024;

export function defaultCacheDir(): string {
  return join(tmpdir(), 'tangible-parquet');
}

function manifestFiles(manifest: ParquetManifest): ParquetFile[] {
  return manifest.tables.flatMap((table) => table.files);
}

export function manifestBytes(manifest: ParquetManifest): number {
  return manifest.tables.reduce((sum, table) => sum + table.bytes, 0);
}

/**
 * Ensure every file in the manifest exists locally, and return the directory.
 *
 * Throws only when the cache cannot be used at all; the caller is expected to
 * fall back to the remote base URL.
 */
export async function cacheParquet(
  baseUrl: string,
  manifest: ParquetManifest,
  options: ParquetCacheOptions = {},
): Promise<ParquetCacheResult> {
  const dir = options.dir ?? defaultCacheDir();
  const maxBytes = options.maxBytes ?? DEFAULT_CACHE_MAX_BYTES;
  const log = options.logger ?? (() => undefined);
  const started = performance.now();

  const total = manifestBytes(manifest);
  if (total > maxBytes) {
    throw new Error(
      `Export is ${mb(total)} but the cache budget is ${mb(maxBytes)}. Reading over HTTP instead; ` +
        `raise PARQUET_CACHE_MAX_MB if the host has the space.`,
    );
  }

  // The export is versioned by the directory it lands in, so a republished
  // dataset simply does not find its files and fetches them.
  const target = join(dir, exportKey(manifest));
  await mkdir(target, { recursive: true });
  await prune(dir, target, log);

  const files = manifestFiles(manifest);
  const pending: ParquetFile[] = [];
  let reused = 0;

  for (const file of files) {
    if (await isComplete(join(target, file.path), file.bytes)) reused++;
    else pending.push(file);
  }

  if (pending.length) {
    log(`Caching ${pending.length} of ${files.length} files (${mb(total)}) to ${target}`);
    await inParallel(pending, options.concurrency ?? 8, (file) =>
      download(baseUrl, target, file),
    );
  }

  const durationMs = Math.round(performance.now() - started);
  log(
    `Parquet cache ready: ${pending.length} downloaded, ${reused} reused, ${mb(total)} in ${durationMs}ms`,
  );

  return { dir: target, downloaded: pending.length, reused, bytes: total, durationMs };
}

/**
 * A stable directory name for one export.
 *
 * Keyed on the export timestamp so a republished dataset never reads a mix of
 * old and new files — the sizes might even match, and a silently blended
 * warehouse is far worse than a slow one.
 */
function exportKey(manifest: ParquetManifest): string {
  return manifest.exportedAt.replace(/[^0-9A-Za-z]/g, '');
}

/**
 * Drop copies of superseded exports.
 *
 * Temp space is per-instance and finite; without this, an instance that
 * outlives a few republishes accumulates a full copy of each. Unlinking a file
 * another handle still has open is safe on POSIX — the descriptor stays valid
 * until it is closed — so this cannot pull the floor out from a query in
 * flight.
 */
async function prune(dir: string, keep: string, log: (message: string) => void): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (!entry.isDirectory() || path === keep) continue;
      await rm(path, { recursive: true, force: true });
      log(`Removed superseded export ${entry.name}`);
    }
  } catch {
    // Pruning is housekeeping. Failing it should never fail a request.
  }
}

async function isComplete(path: string, bytes: number): Promise<boolean> {
  try {
    return (await stat(path)).size === bytes;
  } catch {
    return false;
  }
}

async function download(baseUrl: string, target: string, file: ParquetFile): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, '')}/${file.path}`;
  const destination = join(target, file.path);
  await mkdir(dirname(destination), { recursive: true });

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not fetch ${url}: ${response.status} ${response.statusText}`);
  }

  // Written to a scratch name and renamed, so a request that arrives mid-download
  // never sees a partial file at the real path. Rename is atomic within a
  // filesystem, which is what makes the size check on reuse trustworthy.
  const scratch = `${destination}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(scratch));
    const written = (await stat(scratch)).size;
    if (written !== file.bytes) {
      throw new Error(`${file.path} is ${written} bytes, manifest says ${file.bytes}`);
    }
    await rename(scratch, destination);
  } catch (error) {
    await rm(scratch, { force: true });
    throw error;
  }
}

/** Run `worker` over every item, at most `limit` at a time. */
async function inParallel<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      await worker(items[i]!);
    }
  });
  await Promise.all(runners);
}

function mb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
