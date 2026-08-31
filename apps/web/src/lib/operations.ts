import 'server-only';
import { gte, sql } from 'drizzle-orm';
import { getDb, schema } from '@tangible/db';
import type { AlertingStatus, OperationsView } from '@tangible/types';
import { probeSummary } from '@/lib/health';
import { ALERT_CAP, openIncidents, resolvedIncidents } from '@/lib/incidents';
import { firmRecipients } from '@/lib/notify';

/**
 * The one screen that is about the software rather than about a return.
 *
 * It answers three questions in the order somebody asks them at 8am: what is
 * broken, when did anything last check, and if something breaks now, would
 * anybody be told.
 *
 * The third is the one that is easy to leave out and the one that makes the
 * other two worth having. An alerting path nobody configured produces exactly
 * the same quiet as an alerting path with nothing to report, and the difference
 * is only visible if the screen says out loud who the mail goes to.
 */
export async function operationsView(): Promise<OperationsView> {
  const [open, resolved, probe, alerting] = await Promise.all([
    openIncidents(),
    resolvedIncidents(),
    probeSummary(),
    alertingStatus(),
  ]);
  return { open, resolved, probe, alerting };
}

async function alertingStatus(): Promise<AlertingStatus> {
  const recipients = firmRecipients();
  const [recent] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.incidents)
    .where(gte(schema.incidents.alertedAt, new Date(Date.now() - 60 * 60 * 1000)));

  return {
    /** Both halves, because one without the other sends nothing and says so only in a log. */
    mailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM),
    recipients,
    cronConfigured: Boolean(process.env.CRON_SECRET),
    sentLastHour: recent?.count ?? 0,
    alertCap: ALERT_CAP,
  };
}
