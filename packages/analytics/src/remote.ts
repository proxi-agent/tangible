import { tmpdir } from 'node:os';
import { cacheParquet, type ParquetCacheOptions, type ParquetCacheResult } from './cache.js';
import { MATERIALIZED_SERIES_TABLE } from './series.js';
import { lit } from './sql.js';
import { Warehouse, type WarehouseOptions } from './warehouse.js';

/**
 * Reading the warehouse from object storage instead of a local file.
 *
 * The warehouse is written once by an ingest run and then only ever read. That
 * asymmetry is what makes a serverless deployment possible at all: the 500 MB
 * DuckDB file cannot ship in a function bundle and cannot be written to from
 * one, but the same tables as Parquet are 95 MB, and DuckDB reads them over
 * HTTP with range requests — pulling only the row groups a query touches.
 *
 * The layout is declared once here and consumed by both the exporter and the
 * reader, so the two cannot drift into disagreeing about where a table lives.
 */

export interface ParquetTable {
  name: string;
  /**
   * Hive partition columns. Partitioning by jurisdiction and year is what keeps
   * a Harris query from reading Dallas bytes; without it every request would
   * pull the footer of all 23 files.
   */
  partitionBy?: readonly string[];
  /** SQL type per partition column, so the mounted view matches the DDL. */
  partitionTypes?: Readonly<Record<string, string>>;
  /** Mount only if the manifest lists it, rather than failing without it. */
  optional?: boolean;
}

export const PARQUET_TABLES: readonly ParquetTable[] = [
  {
    name: 'account_year',
    partitionBy: ['jurisdiction_id', 'tax_year'],
    partitionTypes: { jurisdiction_id: 'VARCHAR', tax_year: 'INTEGER' },
  },
  {
    /**
     * The series, precomputed per as-of year. Optional: an export written
     * before this existed simply lacks it, and queries fall back to building
     * the CTE per request.
     */
    name: 'account_series',
    optional: true,
    partitionBy: ['jurisdiction_id', 'as_of_year'],
    partitionTypes: { jurisdiction_id: 'VARCHAR', as_of_year: 'INTEGER' },
  },
  { name: 'jurisdiction' },
  { name: 'tax_policy' },
];

export const MANIFEST_FILENAME = 'manifest.json';

export interface ParquetFile {
  /** Path relative to the base URL, with forward slashes. */
  path: string;
  /**
   * Size on disk at export time. This is what makes a local cache safe to
   * reuse: a file of the expected length was fully written, and a truncated or
   * half-downloaded one is detected without hashing every byte.
   */
  bytes: number;
}

export interface ParquetManifestTable {
  name: string;
  rows: number;
  /**
   * Every file in the table.
   *
   * Listed rather than globbed because a glob needs a directory listing, and
   * object storage does not have one — `read_parquet('.../**\/*.parquet')` works
   * against a local path and fails against HTTP. The export knows exactly what
   * it wrote, so it says so here and the reader names each file.
   */
  files: ParquetFile[];
  bytes: number;
}

/** Written next to the Parquet so a deployment knows what it is serving. */
export interface ParquetManifest {
  exportedAt: string;
  sourceWarehouse: string;
  tables: ParquetManifestTable[];
  jurisdictions: { id: string; accounts: number; years: number[] }[];
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path}`;
}

function isRemote(baseUrl: string): boolean {
  return /^https?:\/\//i.test(baseUrl);
}

/** The `read_parquet(...)` expression for one table under a base URL. */
export function parquetSourceSql(
  baseUrl: string,
  table: ParquetTable,
  manifest?: ParquetManifest,
): string {
  const listed = manifest?.tables.find((t) => t.name === table.name)?.files;

  if (!table.partitionBy?.length) {
    const file = listed?.[0]?.path ?? `${table.name}.parquet`;
    return `read_parquet(${lit(joinUrl(baseUrl, file))})`;
  }

  const source = listed?.length
    ? `[${listed.map((file) => lit(joinUrl(baseUrl, file.path))).join(', ')}]`
    : lit(joinUrl(baseUrl, `${table.name}/**/*.parquet`));

  const types = Object.entries(table.partitionTypes ?? {})
    .map(([column, type]) => `${lit(column)}: ${lit(type)}`)
    .join(', ');

  return [
    `read_parquet(`,
    source,
    `, hive_partitioning = true`,
    // COPY ... PARTITION_BY strips the partition columns out of the files, so
    // they exist only as directory names. Left to inference their types are a
    // guess; pinning them keeps the mounted view identical to the DDL.
    types ? `, hive_types = {${types}}` : '',
    `)`,
  ].join('');
}

export interface RemoteWarehouseOptions extends Omit<WarehouseOptions, 'path' | 'initSql'> {
  /**
   * Where DuckDB may write the httpfs extension. Serverless filesystems are
   * read-only apart from a temp directory, and the default (`~/.duckdb`) fails
   * there with an error that does not mention extensions at all.
   */
  extensionDirectory?: string;
  /**
   * Skip `INSTALL` and only `LOAD`. Set when the extension is already present in
   * `extensionDirectory` — it saves a download on every cold start.
   */
  extensionPreinstalled?: boolean;
  /**
   * The published manifest. Required for an HTTP base URL, where the file list
   * cannot be discovered; optional for a local path, which can be globbed.
   */
  manifest?: ParquetManifest;
}

/**
 * Statements that mount a remote export as the ordinary table names.
 *
 * Every query in this package reads `account_year`, `jurisdiction` and
 * `tax_policy`. Defining those as views means the analytical SQL — the segment
 * predicates, the series CTE, all five query modules — runs unchanged against
 * object storage.
 */
export function remoteInitSql(baseUrl: string, options: RemoteWarehouseOptions = {}): string[] {
  const remote = isRemote(baseUrl);
  const statements: string[] = [];

  if (remote && !options.manifest) {
    throw new Error(
      `No manifest for ${baseUrl}. Object storage cannot be listed, so the Parquet files have ` +
        `to be named explicitly — publish ${MANIFEST_FILENAME} alongside them (pnpm export:parquet writes it).`,
    );
  }

  // Somewhere to spill. `memory_limit` is a hard ceiling, and without a temp
  // directory an in-memory database that reaches it fails the query outright
  // rather than going to disk. Function memory cannot be set from route segment
  // config, so the safe assumption is that there is less of it than we'd like.
  statements.push(`SET temp_directory = ${lit(`${tmpdir()}/duckdb-spill`)};`);

  if (remote) {
    const extensionDir = options.extensionDirectory ?? `${tmpdir()}/duckdb-extensions`;
    statements.push(`SET extension_directory = ${lit(extensionDir)};`);
    statements.push(`SET home_directory = ${lit(tmpdir())};`);
    if (!options.extensionPreinstalled) statements.push(`INSTALL httpfs;`);
    statements.push(`LOAD httpfs;`);
    // Parquet footers are re-read on every query otherwise, which on a warm
    // instance is a round trip per file per request.
    statements.push(`SET enable_object_cache = true;`);
    statements.push(`SET http_keep_alive = true;`);
    statements.push(`SET http_retries = 3;`);
  }

  statements.push(...parquetViewSql(baseUrl, options.manifest));

  return statements;
}

/**
 * Just the view definitions, without any of the session setup.
 *
 * Separated so the source can be re-pointed on a live connection. A view is
 * only SQL; replacing one swaps where every subsequent query reads from,
 * without reopening the database or losing the session's settings.
 */
export function parquetViewSql(baseUrl: string, manifest?: ParquetManifest): string[] {
  return PARQUET_TABLES.filter((table) => !table.optional || hasTable(manifest, table.name)).map(
    (table) =>
      `CREATE OR REPLACE VIEW ${table.name} AS SELECT * FROM ${parquetSourceSql(baseUrl, table, manifest)};`,
  );
}

/** Whether an export actually carries a table, as opposed to the code knowing of it. */
export function hasTable(manifest: ParquetManifest | undefined | null, name: string): boolean {
  return Boolean(manifest?.tables.some((table) => table.name === name && table.files.length > 0));
}

/**
 * An in-memory DuckDB whose tables are views over a published export.
 *
 * There is no database file, so nothing is written and the process needs no
 * disk beyond the extension directory.
 */
export function createRemoteWarehouse(
  baseUrl: string,
  options: RemoteWarehouseOptions = {},
): Warehouse {
  return new Warehouse({
    ...options,
    path: ':memory:',
    initSql: remoteInitSql(baseUrl, options),
  });
}

/** Read the manifest sitting alongside the Parquet, over HTTP or from disk. */
export async function fetchManifest(baseUrl: string): Promise<ParquetManifest | null> {
  const target = joinUrl(baseUrl, MANIFEST_FILENAME);
  try {
    if (!isRemote(baseUrl)) {
      const { readFile } = await import('node:fs/promises');
      return JSON.parse(await readFile(target, 'utf8')) as ParquetManifest;
    }
    const response = await fetch(target);
    if (!response.ok) return null;
    return (await response.json()) as ParquetManifest;
  } catch {
    return null;
  }
}

export interface OpenRemoteOptions extends Omit<RemoteWarehouseOptions, 'manifest'> {
  /**
   * Copy the export to local disk. Pass `false` to always read over HTTP.
   * Ignored for a base URL that is already a local path.
   */
  cache?: ParquetCacheOptions | false;
  /**
   * Wait for the copy before answering anything.
   *
   * Off by default, and that default matters more than it sounds. The export is
   * ~95 MB; blocking on it puts the whole download in front of the first
   * request, so every cold instance makes somebody wait for all four counties
   * before it can answer a question about one. Backgrounding it means the
   * instance serves over HTTP straight away — slower per query, but immediately
   * — and silently upgrades itself to local reads part-way through.
   */
  blockOnCache?: boolean;
}

export interface OpenRemoteResult {
  warehouse: Warehouse;
  manifest: ParquetManifest | null;
  /** Where reads go right now; flips to the cache directory once it is warm. */
  readingFrom: () => string;
  cache: () => ParquetCacheResult | null;
}

/**
 * Open a warehouse backed by a published export, reading its manifest first.
 *
 * This is the entry point a host should use: it is the only one that works for
 * both a local directory and object storage, and the only one that can put a
 * local copy in front of a remote one.
 */
export async function openRemoteWarehouse(
  baseUrl: string,
  options: OpenRemoteOptions = {},
): Promise<OpenRemoteResult> {
  const { cache: cacheOptions, blockOnCache, ...warehouseOptions } = options;
  const manifest = await fetchManifest(baseUrl);
  const log = cacheOptions === false ? undefined : cacheOptions?.logger;

  const wanted = isRemote(baseUrl) && manifest !== null && cacheOptions !== false;
  let readingFrom = baseUrl;
  let cache: ParquetCacheResult | null = null;

  // Warm the cache first only when explicitly asked. Otherwise the instance
  // opens against the remote URL and upgrades itself below.
  if (wanted && blockOnCache) {
    try {
      cache = await cacheParquet(baseUrl, manifest!, cacheOptions ?? {});
      readingFrom = cache.dir;
    } catch (error) {
      log?.(`Parquet cache unavailable, reading over HTTP: ${describe(error)}`);
    }
  }

  const warehouse = createRemoteWarehouse(readingFrom, {
    ...warehouseOptions,
    manifest: manifest ?? undefined,
  });
  warehouse.materializedSeries = hasTable(manifest, MATERIALIZED_SERIES_TABLE);

  if (wanted && !blockOnCache) {
    void (async () => {
      try {
        const result = await cacheParquet(baseUrl, manifest!, cacheOptions ?? {});
        // Re-point the views at the local copy. Every subsequent query reads
        // from disk; anything already running keeps the plan it started with.
        for (const statement of parquetViewSql(result.dir, manifest ?? undefined)) {
          await warehouse.exec(statement);
        }
        cache = result;
        readingFrom = result.dir;
        log?.(`Switched to the local copy after ${result.durationMs}ms`);
      } catch (error) {
        // Reads simply stay remote. This is a speed-up that failed, not a fault.
        log?.(`Parquet cache unavailable, staying on HTTP: ${describe(error)}`);
      }
    })();
  }

  return {
    warehouse,
    manifest,
    readingFrom: () => readingFrom,
    cache: () => cache,
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
