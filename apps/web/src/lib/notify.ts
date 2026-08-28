import 'server-only';
import { and, eq, gt } from 'drizzle-orm';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The three messages this product sends.
 *
 * Everything the portal does is asynchronous from the client's side: they send
 * a register and go back to work, we ask a question and they see it whenever
 * they next sign in. Without mail, the loop only closes when the taxpayer
 * happens to look — which for a return that has a February deadline is the
 * difference between a filed rendition and a 10% penalty under 22.28.
 *
 * Three templates, and no more. Each one exists because a person is now waiting
 * on someone else and does not know it:
 *
 *   - **Your report is ready** — the client, after a run publishes.
 *   - **A question is waiting** — the client, when we need a fact only they
 *     have. Sent to admins, because a viewer cannot answer one.
 *   - **They answered** — the firm, when a client settles a question that was
 *     holding up a number.
 *
 * Every send is a row in `notifications`, written whether or not it lands. A
 * failure to mail never fails the thing it was about: the report is published,
 * the question is on the record, and the mail is the copy of that, not the
 * event itself.
 */

type Kind = 'report-published' | 'question-waiting' | 'answer-received';

interface Message {
  subject: string;
  /** Plain text. Deliverability is better and nothing here needs layout. */
  body: string;
}

/**
 * Where the portal lives, for the link in the mail. `NEXT_PUBLIC_APP_URL` in a
 * deployment; Vercel's own variable is the fallback so a preview deployment
 * links to itself rather than to production.
 */
function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : 'http://localhost:3000';
}

/**
 * Send one message, and record that we tried.
 *
 * The transport is Resend over plain fetch — no SDK, because the whole API is
 * one POST and a dependency that wraps it is a dependency to keep current. With
 * no key configured the message is logged instead of sent, which is the local
 * development mode: a laptop should show what would have gone out rather than
 * either failing or quietly mailing real people.
 */
async function deliver(
  to: string,
  message: Message,
  record: { engagementId: string; clientId: string; kind: Kind; runId?: string | null },
): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  let error: string | null = null;

  if (!key || !from) {
    console.info('[notify] no mail transport configured; would have sent', {
      to,
      subject: message.subject,
    });
    error = 'No mail transport is configured in this deployment.';
  } else {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject: message.subject, text: message.body }),
      });
      if (!response.ok) error = `${response.status} ${(await response.text()).slice(0, 500)}`;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
  }

  const db = requireDb();
  await db.insert(schema.notifications).values({
    engagementId: record.engagementId,
    clientId: record.clientId,
    kind: record.kind,
    runId: record.runId ?? null,
    recipient: to.toLowerCase(),
    subject: message.subject,
    sentAt: error === null ? new Date() : null,
    error,
  });

  if (error) console.error('[notify] could not send', record.kind, to, error);
}

/** Who on the client's side hears about this. */
async function recipients(clientId: string, adminsOnly: boolean): Promise<string[]> {
  const db = requireDb();
  const rows = await db
    .select({ email: schema.portalUsers.email, role: schema.portalUsers.role })
    .from(schema.portalUsers)
    .where(eq(schema.portalUsers.clientId, clientId));
  return rows.filter((r) => !adminsOnly || r.role === 'admin').map((r) => r.email);
}

/**
 * The firm's own mailbox, from the same allowlist that admits it to the app.
 *
 * One list rather than a separate setting: an address that may not sign in has
 * no business receiving a client's answer, and keeping the two in sync by hand
 * is how a departed preparer keeps getting mail.
 */
function firmRecipients(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/** Have we already said this about this season, recently enough to not repeat it? */
async function saidRecently(engagementId: string, kind: Kind, withinMs: number): Promise<boolean> {
  const db = requireDb();
  const [row] = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.engagementId, engagementId),
        eq(schema.notifications.kind, kind),
        gt(schema.notifications.createdAt, new Date(Date.now() - withinMs)),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * A report published.
 *
 * Read back off the run rather than passed in, so the mail can only describe a
 * run that actually reached `published` — a caller holding a stale object
 * cannot announce a report that is not there.
 *
 * A `refresh` run does not mail. Those fire when the inputs move under a
 * published report, which during a season is often: a preparer settling a
 * classification would otherwise send the client a fresh "your report is ready"
 * every few minutes, and the third one teaches them to ignore all of them.
 */
export async function notifyReportPublished(runId: string): Promise<void> {
  const db = requireDb();
  const [row] = await db
    .select({
      run: schema.analysisRuns,
      client: schema.clients,
      engagement: schema.engagements,
    })
    .from(schema.analysisRuns)
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.analysisRuns.engagementId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.engagements.clientId))
    .where(eq(schema.analysisRuns.id, runId));

  if (!row || row.run.status !== 'published') return;
  if (row.run.trigger === 'refresh') return;

  const to = await recipients(row.client.id, false);
  if (to.length === 0) return;

  const message: Message = {
    subject: `Your ${row.engagement.taxYear} personal property report is ready`,
    body: [
      `Your ${row.engagement.taxYear} business personal property report is ready to read.`,
      '',
      `${appUrl()}/portal/report`,
      '',
      'It shows what we found in the register you sent, what it is worth on the',
      "appraisal district's own depreciation schedules, and where we think the",
      'assessment can be moved. Anything we still need from you is listed under',
      'Questions.',
      '',
      `Report reference: ${row.run.id}`,
      'Quote that reference to us if you ever need to know exactly which version',
      'of the numbers you were looking at.',
    ].join('\n'),
  };

  for (const address of to) {
    await deliver(address, message, {
      engagementId: row.engagement.id,
      clientId: row.client.id,
      kind: 'report-published',
      runId: row.run.id,
    });
  }
}

/**
 * A question is waiting.
 *
 * One message for however many questions were raised, and at most one an hour.
 * Asks arrive in bursts — a proposal sync can open a dozen at once — and a
 * mail per ask would be a dozen mails about one upload. The message therefore
 * carries a count and a link rather than the questions themselves; it also
 * means the mail cannot go stale against answers given in between.
 */
export async function notifyQuestionsWaiting(engagementId: string): Promise<void> {
  const db = requireDb();
  const [row] = await db
    .select({ client: schema.clients, engagement: schema.engagements })
    .from(schema.engagements)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.engagements.clientId))
    .where(eq(schema.engagements.id, engagementId));
  if (!row) return;

  if (await saidRecently(engagementId, 'question-waiting', 60 * 60_000)) return;

  const open = await db
    .select({ id: schema.mappingAsks.id })
    .from(schema.mappingAsks)
    .where(
      and(
        eq(schema.mappingAsks.engagementId, engagementId),
        eq(schema.mappingAsks.status, 'open'),
      ),
    );
  if (open.length === 0) return;

  const to = await recipients(row.client.id, true);
  if (to.length === 0) return;

  const count = open.length;
  const message: Message = {
    subject:
      count === 1
        ? `A question about your ${row.engagement.taxYear} return`
        : `${count} questions about your ${row.engagement.taxYear} return`,
    body: [
      count === 1
        ? 'There is one question waiting on your account.'
        : `There are ${count} questions waiting on your account.`,
      '',
      `${appUrl()}/portal/questions`,
      '',
      'Each one is a fact only you have — where something sits, what it was used',
      'for, whether it is still there. They are the positions on your report we',
      'cannot price until you answer, so they are usually the ones worth the most.',
    ].join('\n'),
  };

  for (const address of to) {
    await deliver(address, message, {
      engagementId,
      clientId: row.client.id,
      kind: 'question-waiting',
    });
  }
}

/**
 * A client answered.
 *
 * This one goes to the firm, and it is the only one that does. An answer is
 * what unblocks a screening finding — the report has a number it could not
 * compute until now — and nobody on our side is watching the asks table.
 */
export async function notifyAnswerReceived(askId: string): Promise<void> {
  const db = requireDb();
  const [row] = await db
    .select({ ask: schema.mappingAsks, client: schema.clients, engagement: schema.engagements })
    .from(schema.mappingAsks)
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.mappingAsks.engagementId))
    .innerJoin(schema.clients, eq(schema.clients.id, schema.engagements.clientId))
    .where(eq(schema.mappingAsks.id, askId));
  if (!row || row.ask.status !== 'answered') return;

  const to = firmRecipients();
  if (to.length === 0) return;

  const message: Message = {
    subject: `${row.client.name} answered a ${row.engagement.taxYear} question`,
    body: [
      `${row.client.name} answered:`,
      '',
      row.ask.question,
      '',
      `Their answer: ${row.ask.answer ?? '(none recorded)'}`,
      '',
      `${appUrl()}/clients/${row.client.id}`,
      '',
      'If this was holding up a screening finding, that finding can be priced now.',
    ].join('\n'),
  };

  for (const address of to) {
    await deliver(address, message, {
      engagementId: row.engagement.id,
      clientId: row.client.id,
      kind: 'answer-received',
    });
  }
}

/** Never let a notification take down the thing it was about. */
export function fireAndLog(promise: Promise<void>, label: string): void {
  void promise.catch((error) => console.error('[notify]', label, error));
}

export type { Kind as NotificationKind };
