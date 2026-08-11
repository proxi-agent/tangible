import 'server-only';
import {
  openRemoteWarehouse,
  resolveDataPath,
  Warehouse,
  type ParquetCacheOptions,
} from '@tangible/analytics';

/**
 * The process's DuckDB handle, in whichever of the two shapes the environment
 * supports.
 *
 * Local development reads the warehouse file that ingest writes. A deployment
 * has no filesystem to put it on, so it reads the published Parquet export over
 * HTTP instead. Both produce a `Warehouse` whose tables are named
 * `account_year`, `jurisdiction` and `tax_policy`, which is the only thing the
 * analytical SQL knows about — nothing downstream of here can tell which mode
 * it is running in.
 */

export type WarehouseMode = 'parquet' | 'file';

export interface WarehouseInfo {
  mode: WarehouseMode;
  source: string;
  /** When the export being served was produced. Null in file mode. */
  publishedAt?: string | null;
  /** Where queries actually read from — the cache directory, or the base URL. */
  readingFrom?: string;
  /** False while an instance is still serving over HTTP and warming its copy. */
  cacheWarm?: boolean;
  cache?: { downloaded: number; reused: number; bytes: number; durationMs: number } | null;
}

/**
 * Whether to keep a local copy of the export.
 *
 * On by default, because it is the difference between paying an object store's
 * round trip on each of the ~2,000 range requests a page load makes and paying
 * it once per instance. Set `PARQUET_CACHE=off` to read straight over HTTP.
 */
function cacheSettings(): ParquetCacheOptions | false {
  if (process.env.PARQUET_CACHE?.toLowerCase() === 'off') return false;
  const maxMb = Number(process.env.PARQUET_CACHE_MAX_MB ?? 0);
  return {
    dir: process.env.PARQUET_CACHE_DIR,
    maxBytes: maxMb > 0 ? maxMb * 1024 * 1024 : undefined,
    logger: (message) => console.log(`[warehouse] ${message}`),
  };
}

interface Held {
  warehouse: Warehouse;
  /** A function, because the cache warms after the instance starts serving. */
  info: () => WarehouseInfo;
}

async function build(): Promise<Held> {
  const baseUrl = process.env.PARQUET_BASE_URL?.trim();

  if (baseUrl) {
    // Reading the manifest is what makes this work at all: object storage has
    // no directory listing, so the Parquet files have to be named one by one.
    const { warehouse, manifest, readingFrom, cache } = await openRemoteWarehouse(baseUrl, {
      // A serverless function has far less memory than a laptop, and DuckDB
      // treats this as a hard ceiling rather than a hint. Keep it under the
      // configured function memory or queries fail instead of spilling.
      memoryLimit: process.env.DUCKDB_MEMORY_LIMIT ?? '1GB',
      threads: Number(process.env.DUCKDB_THREADS ?? 2),
      extensionDirectory: process.env.DUCKDB_EXTENSION_DIR,
      extensionPreinstalled: process.env.DUCKDB_EXTENSION_DIR !== undefined,
      cache: cacheSettings(),
      // Set PARQUET_CACHE=blocking to wait for the copy before serving. Only
      // useful somewhere with no cold starts to speak of; on Vercel it just
      // moves a 95 MB download in front of the first visitor.
      blockOnCache: process.env.PARQUET_CACHE?.toLowerCase() === 'blocking',
    });

    return {
      warehouse,
      info: () => {
        const result = cache();
        return {
          mode: 'parquet',
          source: baseUrl,
          publishedAt: manifest?.exportedAt ?? null,
          // Read through the accessors, not captured once: the cache warms in
          // the background, so this flips from the URL to a local path
          // part-way through an instance's life.
          readingFrom: readingFrom(),
          cacheWarm: readingFrom() !== baseUrl,
          cache: result && {
            downloaded: result.downloaded,
            reused: result.reused,
            bytes: result.bytes,
            durationMs: result.durationMs,
          },
        };
      },
    };
  }

  const path = resolveDataPath(process.env.DUCKDB_PATH ?? './data/tangible.duckdb');
  return {
    // Read-only so the dashboard never contends with an ingest run for the
    // single write lock, and never creates an empty database by opening a path
    // that does not exist.
    warehouse: new Warehouse({
      path,
      readOnly: true,
      memoryLimit: process.env.DUCKDB_MEMORY_LIMIT ?? '4GB',
      threads: Number(process.env.DUCKDB_THREADS ?? 4),
    }),
    info: () => ({ mode: 'file', source: path, publishedAt: null }),
  };
}

/**
 * Held on `globalThis` rather than in a module binding. Next discards module
 * state on every hot reload in development, and a fresh DuckDB handle per edit
 * leaks file descriptors and re-fetches the manifest.
 *
 * The promise is cached, not the resolved value, so concurrent requests on a
 * cold instance share one setup rather than racing through it.
 */
const globalForWarehouse = globalThis as typeof globalThis & {
  __tangibleWarehouse?: Promise<Held>;
};

function instance(): Promise<Held> {
  globalForWarehouse.__tangibleWarehouse ??= build().catch((error: unknown) => {
    // Do not cache a failed setup — a transient fetch failure for the manifest
    // would otherwise poison the instance for its whole lifetime.
    globalForWarehouse.__tangibleWarehouse = undefined;
    throw error;
  });
  return globalForWarehouse.__tangibleWarehouse;
}

export async function getWarehouse(): Promise<Warehouse> {
  return (await instance()).warehouse;
}

/**
 * Close the handle and forget it.
 *
 * DuckDB permits one writer or many readers, never both, so a local ingest
 * cannot start while this process holds the file open. The ingest request is
 * forwarded through this app, which means it can step out of the way first; the
 * next query reopens on demand.
 */
export async function releaseWarehouse(): Promise<void> {
  const held = globalForWarehouse.__tangibleWarehouse;
  if (!held) return;
  globalForWarehouse.__tangibleWarehouse = undefined;
  await (await held).warehouse.close().catch(() => undefined);
}

export async function getWarehouseInfo(): Promise<WarehouseInfo> {
  return (await instance()).info();
}
