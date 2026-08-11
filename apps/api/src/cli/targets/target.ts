/**
 * One place the export can be published to.
 *
 * The read side does not care which of these was used — DuckDB needs a base URL
 * that serves GETs with `Range` and preserves paths, and that is the whole
 * contract. So the differences between hosts are confined to this interface
 * rather than leaking into the warehouse.
 */
export interface PublishTarget {
  /** Human-readable destination, for the log line. */
  describe(): string;
  /** Create or verify the bucket. */
  prepare(): Promise<void>;
  /** True when an object of exactly this size is already stored — resume support. */
  isPresent(path: string, bytes: number): Promise<boolean>;
  put(path: string, body: Buffer, kind: 'parquet' | 'manifest'): Promise<void>;
  /** What to set `PARQUET_BASE_URL` to. */
  publicBaseUrl(): string;
}

/** Exports are immutable; the manifest is the one thing that changes in place. */
export const CACHE_CONTROL = {
  parquet: 'public, max-age=31536000, immutable',
  manifest: 'no-cache',
} as const;

export const CONTENT_TYPE = {
  parquet: 'application/vnd.apache.parquet',
  manifest: 'application/json',
} as const;

export function requireEnv(name: string, value: string | undefined): string {
  if (!value || /your-|example\.com/.test(value)) {
    throw new Error(`${name} is not set in .env`);
  }
  return value;
}
