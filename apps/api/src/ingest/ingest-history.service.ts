import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDb, ingestRuns, type Database } from '@tangible/db';
import type { IngestRun } from '@tangible/types';
import { sql } from 'drizzle-orm';
import type { Env } from '../config/env.js';

/**
 * Persists ingest history to Supabase Postgres.
 *
 * Supabase is optional locally: without `DATABASE_URL` the app still runs
 * entirely off the warehouse, and history is simply not durable. Failures here
 * are logged and swallowed — losing an audit row must never abort an ingest
 * that is otherwise succeeding.
 */
@Injectable()
export class IngestHistoryService {
  private readonly logger = new Logger(IngestHistoryService.name);
  private db: Database | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {
    const url = this.config.get('DATABASE_URL', { infer: true });
    if (!url) {
      this.logger.warn('DATABASE_URL is not set — ingest history will not be persisted.');
      return;
    }
    try {
      this.db = getDb(url);
    } catch (error) {
      this.logger.warn(`Postgres unavailable, history disabled: ${(error as Error).message}`);
    }
  }

  get enabled(): boolean {
    return this.db !== null;
  }

  async record(run: IngestRun): Promise<void> {
    if (!this.db) return;
    try {
      await this.db
        .insert(ingestRuns)
        .values({
          id: run.id,
          jurisdictionId: run.jurisdictionId,
          connectorId: run.connectorId,
          taxYears: run.taxYears,
          status: run.status,
          message: run.message,
          error: run.error,
          rowsLoaded: run.rowsLoaded,
          filesProcessed: run.filesProcessed,
          startedAt: new Date(run.startedAt),
          finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
        })
        .onConflictDoUpdate({
          target: ingestRuns.id,
          set: {
            status: sql`excluded.status`,
            message: sql`excluded.message`,
            error: sql`excluded.error`,
            rowsLoaded: sql`excluded.rows_loaded`,
            filesProcessed: sql`excluded.files_processed`,
            finishedAt: sql`excluded.finished_at`,
          },
        });
    } catch (error) {
      this.logger.warn(`Could not persist ingest run ${run.id}: ${(error as Error).message}`);
    }
  }
}
