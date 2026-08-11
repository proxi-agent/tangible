import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface WarehouseOptions {
  /** Path to the DuckDB file. Use ':memory:' for tests. */
  path: string;
  /** Query memory ceiling; DuckDB spills to disk beyond this. */
  memoryLimit?: string;
  threads?: number;
  /**
   * Open without taking the write lock. Required anywhere the filesystem is
   * read-only, and worth setting for any pure read path — several processes can
   * then share one warehouse file instead of blocking each other.
   */
  readOnly?: boolean;
  /**
   * Statements run once, in order, immediately after connecting. This is where
   * a read-only deployment mounts its data: the serverless build has no DuckDB
   * file at all and instead defines views over remote Parquet here.
   */
  initSql?: readonly string[];
}

/**
 * Thin wrapper over a single DuckDB instance.
 *
 * DuckDB is embedded and single-writer, so the process holds one instance and
 * hands out connections. Reads are concurrent; writes (ingest) are serialized
 * through `withWriteLock`.
 */
export class Warehouse {
  #instance: DuckDBInstance | null = null;
  #connection: DuckDBConnection | null = null;
  #connecting: Promise<DuckDBConnection> | null = null;
  #writeQueue: Promise<unknown> = Promise.resolve();
  readonly options: WarehouseOptions;

  constructor(options: WarehouseOptions) {
    this.options = options;
  }

  /**
   * The in-flight connection is memoized, not just the finished one. A warm
   * serverless instance takes several requests at once on a cold connection,
   * and without this each would open its own DuckDB handle and re-run `initSql`.
   */
  async connect(): Promise<DuckDBConnection> {
    if (this.#connection) return this.#connection;
    this.#connecting ??= this.#open().finally(() => {
      this.#connecting = null;
    });
    return this.#connecting;
  }

  async #open(): Promise<DuckDBConnection> {
    const { path, readOnly, initSql } = this.options;

    // Creating the directory is a write, and a read-only warehouse pointed at a
    // path that does not exist should say so rather than conjure an empty one.
    if (path !== ':memory:' && !readOnly) {
      await mkdir(dirname(resolve(path)), { recursive: true });
    }

    this.#instance = await DuckDBInstance.create(path, {
      threads: String(this.options.threads ?? 4),
      memory_limit: this.options.memoryLimit ?? '4GB',
      ...(readOnly ? { access_mode: 'READ_ONLY' } : {}),
    });

    const connection = await this.#instance.connect();
    for (const statement of initSql ?? []) {
      await connection.run(statement);
    }

    this.#connection = connection;
    return connection;
  }

  /** Run a statement for its side effects. */
  async exec(sql: string): Promise<void> {
    const conn = await this.connect();
    await conn.run(sql);
  }

  /** Run a query and materialize every row as a plain object. */
  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const conn = await this.connect();
    const reader = await conn.runAndReadAll(sql);
    return reader.getRowObjects() as T[];
  }

  /** Run a query expected to return at most one row. */
  async queryOne<T = Record<string, unknown>>(sql: string): Promise<T | null> {
    const rows = await this.query<T>(sql);
    return rows[0] ?? null;
  }

  /**
   * Serialize a write against the warehouse. DuckDB allows one writer, and
   * concurrent ingest runs would otherwise fail with a transaction conflict.
   */
  async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#writeQueue.then(fn, fn);
    // Keep the chain alive even when a write throws.
    this.#writeQueue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    this.#connecting = null;
    this.#connection?.closeSync();
    this.#connection = null;
    this.#instance?.closeSync();
    this.#instance = null;
  }
}
