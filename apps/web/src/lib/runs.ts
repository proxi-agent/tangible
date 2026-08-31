import 'server-only';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import type { AnalysisRunRow } from '@tangible/db';
import { fromSavingsReport } from '@tangible/findings';
import { SAVINGS_RULES_VERSION } from '@tangible/savings';
import type { AnalysisRun, RunProgress, RunStep, RunTrigger, SavingsReport } from '@tangible/types';
import { analyzeLoaded, loadSavingsInputs } from '@/lib/analysis';
import { recordIncident, siteOf } from '@/lib/incidents';
import { notifyReportPublished } from '@/lib/notify';
import { writeFindingSet } from '@/lib/findings';
import { HttpError } from '@/lib/http';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Analysis as a job, and the record that it finished.
 *
 * The firm's savings report is derived on read and stays that way — a preparer
 * settling one more row wants the number to move under them. This is the other
 * audience. A business outside the firm reads the last *published* run: a dated
 * row carrying the set it committed, the fingerprint of the data it read, the
 * rules release that examined it and the depreciation guide it applied. That is
 * what makes a figure quotable eighteen months later, and it is also what lets
 * the work take four minutes without an HTTP request waiting on it.
 *
 * Three rules hold the whole thing together:
 *
 *   - **One open run per engagement.** Requesting again while a run is queued
 *     or running returns the existing one rather than stacking duplicates. Two
 *     workers pricing the same register would publish two sets and the client
 *     would be emailed twice about one upload.
 *   - **A claim is a conditional update.** Picking work up is `WHERE
 *     status = 'queued'` with a returning clause, so two processes racing for
 *     the same row produce one winner and one empty result — not two jobs.
 *   - **A run that finds nothing still publishes.** A clean register is an
 *     answer, and the client is waiting for one. The empty-set refusal in
 *     `commitFindings` is right for a partner clicking commit and wrong here.
 */

/** How long a `running` row may go untouched before the reaper assumes nobody holds it. */
const STALL_MS = 10 * 60_000;

/**
 * A job that crashes deterministically — a malformed register, a schedule that
 * throws — would otherwise be requeued forever, and the queue would never drain
 * past it. Three is enough to survive a deploy landing mid-run.
 */
const MAX_ATTEMPTS = 3;

export function runDto(row: AnalysisRunRow): AnalysisRun {
  return {
    id: row.id,
    engagementId: row.engagementId,
    taxYear: row.taxYear,
    status: row.status as AnalysisRun['status'],
    trigger: row.trigger as RunTrigger,
    step: (row.step as RunStep | null) ?? null,
    setId: row.setId,
    inputFingerprint: row.inputFingerprint,
    rulesVersion: row.rulesVersion,
    scheduleVersion: row.scheduleVersion,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    failedAt: row.failedAt?.toISOString() ?? null,
    error: row.error,
    attempts: row.attempts,
  };
}

/**
 * What the client is told about a run in flight.
 *
 * `error` and `attempts` are dropped rather than nulled: they are the firm's
 * business, and a taxpayer reading "attempt 3" learns only that something is
 * wrong in a way they cannot act on.
 */
function progressDto(row: AnalysisRunRow): RunProgress {
  return {
    runId: row.id,
    status: row.status as RunProgress['status'],
    step: (row.step as RunStep | null) ?? null,
    requestedAt: row.requestedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  };
}

export async function listRuns(engagementId: string): Promise<AnalysisRun[]> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(schema.analysisRuns)
    .where(eq(schema.analysisRuns.engagementId, engagementId))
    .orderBy(desc(schema.analysisRuns.requestedAt))
    .limit(50);
  return rows.map(runDto);
}

/**
 * Ask for a run, and get back the one that is already coming if there is one.
 *
 * Deliberately not an error when a run is in flight. The caller is usually an
 * upload handler or a client clicking a button, and "a run is already queued"
 * is the same outcome they wanted — the report is coming. Returning the open
 * row means the portal starts following the right progress line either way.
 */
export async function requestRun(
  engagementId: string,
  trigger: RunTrigger,
  requestedBy: string | null,
): Promise<AnalysisRun> {
  const db = requireDb();

  const [engagement] = await db
    .select({ taxYear: schema.engagements.taxYear })
    .from(schema.engagements)
    .where(eq(schema.engagements.id, engagementId));
  if (!engagement) throw new HttpError(404, 'No record with that id.');

  const [open] = await db
    .select()
    .from(schema.analysisRuns)
    .where(
      and(
        eq(schema.analysisRuns.engagementId, engagementId),
        inArray(schema.analysisRuns.status, ['queued', 'running']),
      ),
    )
    .orderBy(desc(schema.analysisRuns.requestedAt))
    .limit(1);
  if (open) return runDto(open);

  const [row] = await db
    .insert(schema.analysisRuns)
    .values({
      engagementId,
      taxYear: engagement.taxYear,
      source: 'savings',
      status: 'queued',
      trigger,
      requestedBy,
    })
    .returning();
  if (!row) throw new HttpError(500, 'The run could not be queued.');
  return runDto(row);
}

/** The last run the client is allowed to see, and the report it published. */
export async function publishedReport(engagementId: string): Promise<{
  report: SavingsReport | null;
  runId: string | null;
  publishedAt: string | null;
  inFlight: RunProgress | null;
}> {
  const db = requireDb();

  const [published] = await db
    .select({ run: schema.analysisRuns, report: schema.findingSets.report })
    .from(schema.analysisRuns)
    .leftJoin(schema.findingSets, eq(schema.findingSets.id, schema.analysisRuns.setId))
    .where(
      and(
        eq(schema.analysisRuns.engagementId, engagementId),
        eq(schema.analysisRuns.status, 'published'),
      ),
    )
    .orderBy(desc(schema.analysisRuns.publishedAt))
    .limit(1);

  const [open] = await db
    .select()
    .from(schema.analysisRuns)
    .where(
      and(
        eq(schema.analysisRuns.engagementId, engagementId),
        inArray(schema.analysisRuns.status, ['queued', 'running']),
      ),
    )
    .orderBy(desc(schema.analysisRuns.requestedAt))
    .limit(1);

  return {
    /**
     * Null when the set behind a published run has since been deleted. The run
     * survives that on purpose — `set_id` is `on delete set null`, so the fact
     * that something was published on a date is not erased along with the
     * document — but there is no report to show, and inventing the live one
     * here would hand the client an undated number under a run id.
     */
    report: withRateSource((published?.report as SavingsReport | null) ?? null),
    runId: published?.run.id ?? null,
    publishedAt: published?.run.publishedAt?.toISOString() ?? null,
    inFlight: open ? progressDto(open) : null,
  };
}

/**
 * A published report predates the rate disclosure, so say what it was.
 *
 * `report` is JSON on the run row, written by whatever version of the engine
 * was running that day, and read back with a cast rather than a parse. Every
 * report published before the rate work used the jurisdiction's single blended
 * constant, so the honest backfill is not a neutral placeholder — it is the
 * estimate label, which is what those figures actually rest on. Filling it here
 * rather than at each screen means one place knows the old shape.
 */
function withRateSource(report: SavingsReport | null): SavingsReport | null {
  if (!report || report.rateSource) return report;
  return {
    ...report,
    rateSource: {
      kind: 'estimated',
      label: 'county-wide estimate',
      detail:
        'A single blended rate for the whole county, not this account\u2019s own units. This report was published before the account\u2019s own taxing units were available, and that estimate runs above the true rate for most accounts — so the figures overstate rather than understate the position.',
    },
  };
}

/**
 * Take the row, if it is still there to take.
 *
 * The `status = 'queued'` predicate is the lock. Two runners hitting the same
 * row both issue this update; Postgres serializes them, the second sees a row
 * that is no longer queued, matches nothing, and returns undefined.
 */
async function claim(runId: string): Promise<AnalysisRunRow | null> {
  const db = requireDb();
  const [row] = await db
    .update(schema.analysisRuns)
    .set({
      status: 'running',
      step: 'reading',
      startedAt: new Date(),
      attempts: sql`${schema.analysisRuns.attempts} + 1`,
      updatedAt: new Date(),
      error: null,
    })
    .where(and(eq(schema.analysisRuns.id, runId), eq(schema.analysisRuns.status, 'queued')))
    .returning();
  return row ?? null;
}

/**
 * Move the progress line, and touch the row.
 *
 * `updatedAt` is what the reaper reads to tell a long job from a dead one, so
 * every step that takes real time has to move it. A step that failed to write
 * is not worth failing the run over — the work is still correct, only the
 * progress line is stale — which is why this swallows.
 */
async function advance(runId: string, step: RunStep): Promise<void> {
  try {
    const db = requireDb();
    await db
      .update(schema.analysisRuns)
      .set({ step, updatedAt: new Date() })
      .where(eq(schema.analysisRuns.id, runId));
  } catch (error) {
    console.error('[runs] could not record progress', runId, step, error);
  }
}

/**
 * Do the work: read the register, value it, write the set, mark it published.
 *
 * Returns quietly when the row was not claimable — already running, already
 * published, or picked up by another process a millisecond earlier. That is a
 * normal outcome of two triggers firing at once, not a fault.
 */
export async function executeRun(runId: string): Promise<void> {
  const held = await claim(runId);
  if (!held) return;

  const db = requireDb();
  try {
    const inputs = await loadSavingsInputs(held.engagementId);

    await advance(runId, 'valuing');
    const report = analyzeLoaded(held.engagementId, inputs);

    await advance(runId, 'publishing');
    const setId = await writeFindingSet({
      engagementId: held.engagementId,
      normalized: fromSavingsReport(report),
      report,
      fingerprint: inputs.fingerprint,
      priorDocumentId: null,
      taxYear: report.taxYear,
      label: null,
      // Nobody committed this: a run publishes, a person commits. Stamping the
      // requester here would put a name on a decision they did not make.
      actor: null,
    });

    await db
      .update(schema.analysisRuns)
      .set({
        status: 'published',
        step: null,
        setId,
        inputFingerprint: inputs.fingerprint,
        rulesVersion: SAVINGS_RULES_VERSION,
        /**
         * The guide actually applied, not the engagement's year. A district
         * that has not published the current schedule falls back to its most
         * recent one, and a run is only reproducible if it says which.
         */
        scheduleVersion: inputs.schedule
          ? `${inputs.schedule.jurisdictionId}:${inputs.schedule.taxYear}`
          : null,
        publishedAt: new Date(),
        failedAt: null,
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.analysisRuns.id, runId));

    /**
     * After the row, and never inside the transaction that wrote it. Mail that
     * goes out for a publish that then rolls back cannot be recalled, and a
     * provider timing out is not a reason to lose the report.
     */
    await notifyReportPublished(runId).catch((error) =>
      console.error('[runs] published, but the notification failed', runId, error),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[runs] failed', runId, error);
    /**
     * The one fault in this app a client actually feels: they sent a register,
     * the analysis threw, and the report never appears. Awaited rather than
     * detached — nothing is waiting on this response, and the invocation ends
     * when the function returns.
     */
    await recordIncident({
      surface: 'run',
      label: `analysis · ${siteOf(error) ?? 'run'}`,
      error,
      engagementId: held.engagementId,
    });
    /**
     * Failed, not requeued. A run that threw goes back to `queued` only through
     * the reaper, and only while attempts remain — so a register that breaks
     * the analyzer stops after three tries instead of spinning.
     */
    await db
      .update(schema.analysisRuns)
      .set({
        status: held.attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
        step: null,
        failedAt: new Date(),
        error: message.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(schema.analysisRuns.id, runId));
  }
}

/**
 * Pick up whatever is waiting, plus whatever was abandoned.
 *
 * Called on a schedule. The stalled sweep is the half that matters in a
 * serverless deployment: a run is started inside the request that queued it and
 * finished after the response, and a process that is torn down mid-run leaves a
 * `running` row with nothing behind it. Elapsed time is the only signal that
 * tells that apart from a long job, hence `STALL_MS` rather than a heartbeat.
 */
export async function drainRuns(limit = 5): Promise<{ started: string[]; requeued: number }> {
  const db = requireDb();

  const stalled = await db
    .update(schema.analysisRuns)
    .set({ status: 'queued', step: null, updatedAt: new Date() })
    .where(
      and(
        eq(schema.analysisRuns.status, 'running'),
        lt(schema.analysisRuns.updatedAt, new Date(Date.now() - STALL_MS)),
        lt(schema.analysisRuns.attempts, MAX_ATTEMPTS),
      ),
    )
    .returning({ id: schema.analysisRuns.id });

  /**
   * A run that stalled with its attempts spent is not left in `running`
   * forever: nothing would ever pick it up, and the portal would show a
   * progress line that never moves. It is called what it is.
   */
  await db
    .update(schema.analysisRuns)
    .set({ status: 'failed', step: null, failedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(schema.analysisRuns.status, 'running'),
        lt(schema.analysisRuns.updatedAt, new Date(Date.now() - STALL_MS)),
      ),
    );

  const queued = await db
    .select({ id: schema.analysisRuns.id })
    .from(schema.analysisRuns)
    .where(eq(schema.analysisRuns.status, 'queued'))
    .orderBy(schema.analysisRuns.requestedAt)
    .limit(limit);

  const started: string[] = [];
  for (const row of queued) {
    await executeRun(row.id);
    started.push(row.id);
  }

  return { started, requeued: stalled.length };
}
