import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { migrate, Warehouse } from '@tangible/analytics';
import type { Env } from '../config/env.js';

/**
 * The warehouse handle, held only while it is being written to.
 *
 * DuckDB allows one writer or many readers, never both, and this process is now
 * only the writer — the dashboard reads the same file from its own process. So
 * the handle is acquired when an ingest starts and released when it finishes,
 * rather than held for the lifetime of the server. Held open at boot, it would
 * lock the dashboard out of the file for as long as this process ran.
 */
@Injectable()
export class WarehouseService implements OnModuleDestroy {
  private readonly logger = new Logger(WarehouseService.name);
  readonly warehouse: Warehouse;
  #open = false;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.warehouse = new Warehouse({
      path: this.config.get('DUCKDB_PATH', { infer: true }),
      memoryLimit: this.config.get('DUCKDB_MEMORY_LIMIT', { infer: true }),
      threads: this.config.get('DUCKDB_THREADS', { infer: true }),
    });
  }

  /** The configured file, reported without opening it. */
  get path(): string {
    return this.warehouse.options.path;
  }

  get isOpen(): boolean {
    return this.#open;
  }

  /**
   * Take the write lock and apply the schema. The DDL is `IF NOT EXISTS`
   * throughout, so re-running it after a release costs nothing.
   */
  async acquire(): Promise<Warehouse> {
    if (!this.#open) {
      await migrate(this.warehouse);
      this.#open = true;
      this.logger.log(`Opened ${this.path} for writing`);
    }
    return this.warehouse;
  }

  /** Give the file back, so readers can have it again. */
  async release(): Promise<void> {
    if (!this.#open) return;
    await this.warehouse.close();
    this.#open = false;
    this.logger.log(`Released ${this.path}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.release();
  }
}
