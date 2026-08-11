import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectorForJurisdiction, runIngest, seedFixture } from '@tangible/ingest';
import type { IngestRun, StartIngestRequest } from '@tangible/types';
import type { Env } from '../config/env.js';
import { WarehouseService } from '../warehouse/warehouse.service.js';
import { IngestHistoryService } from './ingest-history.service.js';

/**
 * Runs ingests in the background and reports progress.
 *
 * A county archive takes minutes to fetch and load, so the HTTP call starts the
 * work and returns a run id; the UI polls. Runs are tracked in memory for the
 * live view and persisted to Postgres when it is configured, so history
 * survives a restart.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);
  private readonly runs = new Map<string, IngestRun>();
  /** Only one ingest at a time — DuckDB takes a single writer. */
  private active: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly warehouseService: WarehouseService,
    private readonly config: ConfigService<Env, true>,
    private readonly history: IngestHistoryService,
  ) {}

  listRuns(): IngestRun[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  getRun(id: string): IngestRun | null {
    return this.runs.get(id) ?? null;
  }

  start(request: StartIngestRequest): IngestRun {
    const connector = getConnectorForJurisdiction(request.jurisdictionId);
    if (!connector) {
      throw new Error(`No connector is registered for jurisdiction ${request.jurisdictionId}`);
    }

    const run: IngestRun = {
      id: randomUUID(),
      jurisdictionId: request.jurisdictionId,
      connectorId: connector.id,
      taxYears: request.taxYears,
      status: 'pending',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      rowsLoaded: 0,
      filesProcessed: 0,
      message: 'Queued',
      error: null,
    };
    this.runs.set(run.id, run);
    void this.history.record(run);

    this.active = this.active.then(
      () => this.execute(run, connector, request),
      () => this.execute(run, connector, request),
    );

    return run;
  }

  private async execute(
    run: IngestRun,
    connector: ReturnType<typeof getConnectorForJurisdiction>,
    request: StartIngestRequest,
  ): Promise<void> {
    if (!connector) return;

    this.update(run, { status: 'downloading', message: 'Starting' });

    try {
      const result = await runIngest({
        warehouse: await this.warehouseService.acquire(),
        connector,
        taxYears: request.taxYears,
        dataDir: this.config.get('DATA_DIR', { infer: true }),
        force: request.force,
        logger: {
          info: (m) => this.logger.log(m),
          warn: (m) => this.logger.warn(m),
          error: (m) => this.logger.error(m),
        },
        onProgress: (message) => this.update(run, { status: 'loading', message }),
      });

      const failures = result.years.filter((y) => y.skipped && y.reason !== 'already loaded');

      this.update(run, {
        status: failures.length === result.years.length ? 'failed' : 'completed',
        rowsLoaded: result.totalRows,
        filesProcessed: result.years.filter((y) => !y.skipped).length,
        finishedAt: new Date().toISOString(),
        message: summarize(result.years),
        error: failures.length ? failures.map((f) => `${f.taxYear}: ${f.reason}`).join('; ') : null,
      });
    } catch (error) {
      this.update(run, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: describe(error),
        message: 'Failed',
      });
    } finally {
      // Hand the file back whether the run succeeded or not, so the dashboard
      // can read the results — including a partial load from a failed run.
      await this.warehouseService.release();
    }
  }

  /** Load the synthetic county so the dashboard is explorable without a download. */
  async seedDemoData(accounts = 25_000): Promise<number> {
    try {
      const rows = await seedFixture(await this.warehouseService.acquire(), { accounts });
      this.logger.log(`Seeded ${rows.toLocaleString()} synthetic account-years`);
      return rows;
    } finally {
      await this.warehouseService.release();
    }
  }

  private update(run: IngestRun, patch: Partial<IngestRun>): void {
    Object.assign(run, patch);
    this.runs.set(run.id, run);
    void this.history.record(run);
  }
}

/**
 * The lock error is the one failure a user can actually do something about, and
 * DuckDB's own message does not say what is holding the file or what to do.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/Could not set lock|Conflicting lock/i.test(message)) {
    return (
      'The warehouse is being read by another process — usually the dashboard. ' +
      'DuckDB allows one writer or many readers, not both. Stop the dashboard and retry.'
    );
  }
  return message;
}

function summarize(years: { taxYear: number; rowsLoaded: number; skipped: boolean }[]): string {
  return years
    .map((y) => `${y.taxYear}: ${y.skipped ? 'skipped' : `${y.rowsLoaded.toLocaleString()} rows`}`)
    .join(', ');
}
