import 'server-only';
import { desc, gte, sql } from 'drizzle-orm';
import type { HealthCheck, HealthReport, ProbeSummary } from '@tangible/types';
import { getDb, schema } from '@tangible/db';
import { recordIncident } from '@/lib/incidents';
import { firmRecipients } from '@/lib/notify';
import { getWarehouse } from '@/lib/warehouse';

/**
 * Is any of this actually working?
 *
 * Two audiences, and they need different things from the same checks.
 *
 * An **external monitor** wants a status code. It calls `/api/health` from
 * outside the deployment, which is the only vantage point that can tell the
 * difference between "the app says it is unwell" and "the app is not there".
 * Nothing inside this process can see its own absence, and a self-hosted probe
 * that claims to be uptime monitoring is the most expensive kind of comfort.
 *
 * The **probe** wants a row. It runs on the same cron as the run drainer and
 * writes down every sweep, which is what turns silence into evidence: without
 * a trail, a system that has stopped running its jobs and a system with nothing
 * to do produce the same quiet screen. It covers the larger class of failure
 * where the app is up and something underneath it is not — Postgres refusing
 * connections, the warehouse gone, an environment variable that did not survive
 * a deploy.
 *
 * The checks are cheap on purpose. A health endpoint that does real work is a
 * denial-of-service vector on an unauthenticated route, and one that takes
 * eleven seconds gets marked down by the monitor watching it.
 */

/** A check that hangs is a check that failed, and slowly. */
const CHECK_TIMEOUT_MS = 8000;

async function timed(name: string, check: () => Promise<string | null>): Promise<HealthCheck> {
  const started = Date.now();
  try {
    const detail = await Promise.race([
      check(),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`no answer in ${CHECK_TIMEOUT_MS}ms`)),
          CHECK_TIMEOUT_MS,
        ).unref?.(),
      ),
    ]);
    return { name, ok: true, ms: Date.now() - started, detail };
  } catch (error) {
    return {
      name,
      ok: false,
      ms: Date.now() - started,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Ask each dependency whether it answers.
 *
 * Postgres is checked with `getDb()` rather than `requireDb()`: this runs
 * outside any request, so there is no client scope to inherit, and the
 * unscoped connection is the one whose failure means the database is down
 * rather than that a policy said no.
 */
export async function runHealthChecks(): Promise<HealthReport> {
  const started = Date.now();
  const checks = await Promise.all([
    timed('database', async () => {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
      const [row] = await getDb()
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.engagements);
      return `${row?.n ?? 0} engagements`;
    }),
    timed('warehouse', async () => {
      const row = await (
        await getWarehouse()
      ).queryOne<{ n: unknown }>('SELECT count(*) AS n FROM account_year;');
      return `${Number(row?.n ?? 0).toLocaleString('en-US')} account-years`;
    }),
    /**
     * Mail and cron are configuration rather than dependencies, and they are
     * checked here because their failure mode is the quietest one in the
     * system: everything works, nothing is delivered, and the first symptom is
     * an incident nobody was told about.
     */
    timed('alerting', async () => {
      const recipients = firmRecipients();
      if (recipients.length === 0) throw new Error('AUTH_ALLOWED_EMAILS names nobody to alert.');
      if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) {
        throw new Error('No mail transport: RESEND_API_KEY and MAIL_FROM are unset.');
      }
      return `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`;
    }),
    timed('scheduler', async () => {
      if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET is unset, so the cron refuses.');
      return 'configured';
    }),
  ]);

  return {
    ok: checks.every((check) => check.ok),
    checkedAt: new Date().toISOString(),
    ms: Date.now() - started,
    checks,
  };
}

/**
 * Run the checks, write the row, and raise an incident on the way down.
 *
 * The incident is raised on the *transition* into failure, not on every failing
 * sweep. A dependency that is down for six hours is one problem, and six-per-
 * hour is how a mailbox becomes unreadable — the incident's own occurrence
 * count carries the duration instead. That grouping is `recordIncident`'s job,
 * so all this has to do is stop calling once per failed check per sweep, which
 * it does by naming the incident after the check.
 */
export async function recordProbe(source: 'cron' | 'manual'): Promise<HealthReport> {
  const report = await runHealthChecks();

  try {
    await getDb().insert(schema.healthProbes).values({
      ok: report.ok,
      checks: report.checks,
      ms: report.ms,
      source,
    });
  } catch (error) {
    /** A probe that cannot write is itself the finding, and it still returns. */
    console.error('[health] could not record the probe', error);
  }

  for (const check of report.checks) {
    if (check.ok) continue;
    await recordIncident({
      surface: 'probe',
      label: `health · ${check.name}`,
      error: new Error(check.detail ?? 'The check failed without saying why.'),
    });
  }

  return report;
}

/**
 * What the probes add up to.
 *
 * `silentForMinutes` is the number the screen leads with, and the reason the
 * table exists at all. A probe that has not run in four hours is not a system
 * that is fine; it is a system nobody has asked.
 */
export async function probeSummary(): Promise<ProbeSummary> {
  const db = getDb();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [recent, window, lastOk] = await Promise.all([
    db.select().from(schema.healthProbes).orderBy(desc(schema.healthProbes.checkedAt)).limit(1),
    db
      .select({
        count: sql<number>`count(*)::int`,
        okCount: sql<number>`count(*) filter (where ${schema.healthProbes.ok})::int`,
      })
      .from(schema.healthProbes)
      .where(gte(schema.healthProbes.checkedAt, dayAgo)),
    db
      .select({ checkedAt: schema.healthProbes.checkedAt })
      .from(schema.healthProbes)
      .where(sql`${schema.healthProbes.ok}`)
      .orderBy(desc(schema.healthProbes.checkedAt))
      .limit(1),
  ]);

  const last = recent[0];
  return {
    last:
      last === undefined
        ? null
        : {
            ok: last.ok,
            checkedAt: last.checkedAt.toISOString(),
            ms: last.ms,
            checks: (last.checks as HealthCheck[]) ?? [],
          },
    silentForMinutes:
      last === undefined
        ? null
        : Math.max(0, Math.round((Date.now() - last.checkedAt.getTime()) / 60000)),
    windowCount: window[0]?.count ?? 0,
    windowOkCount: window[0]?.okCount ?? 0,
    lastOkAt: lastOk[0]?.checkedAt.toISOString() ?? null,
  };
}
