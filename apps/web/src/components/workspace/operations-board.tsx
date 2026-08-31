'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, BellRing, CircleCheck, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { Incident, OperationsView } from '@tangible/types';
import { api } from '@/lib/api';
import { count, day, plural } from '@/lib/format';
import { Button, Field, TextInput } from '@/components/ui/controls';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';

/**
 * Whether the software is up, and what broke while nobody was looking.
 *
 * The screen is built around the failure this whole floor exists to remove: a
 * client uploads a register, the analysis throws, and the firm finds out when
 * the client mentions it. So the two things it leads with are not counts of
 * anything — they are *how long since anything checked* and *whether an alert
 * would reach a person at all*. Both are silences that read as calm.
 *
 * Deliberately small. An operations page that grows into a metrics product is a
 * page nobody opens during a filing season, and the season is the only time it
 * matters.
 */
export function OperationsBoard() {
  const operations = useQuery({ queryKey: ['operations'], queryFn: () => api.operations() });

  if (operations.error) return <ErrorState error={operations.error} />;
  if (!operations.data) return <Loading />;

  const view = operations.data;
  const stale = view.probe.silentForMinutes === null || view.probe.silentForMinutes > 60;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations"
        eyebrow="The floor"
        description="Faults grouped into incidents, and the scheduled sweep that makes silence mean something."
        meta={[
          view.open.length === 0 ? (
            <Badge key="open" tone="good" dot>
              Nothing open
            </Badge>
          ) : (
            <Badge key="open" tone="critical" dot>
              {count(view.open.length)} open
            </Badge>
          ),
          stale ? (
            <Badge key="probe" tone="warning">
              probe quiet
            </Badge>
          ) : (
            <Badge key="probe" tone="neutral">
              probing
            </Badge>
          ),
        ]}
      />

      <ProbeCard view={view} />

      <AlertingCard view={view} />

      <Card>
        <CardHeader
          title="Open incidents"
          icon={view.open.length === 0 ? CircleCheck : ShieldAlert}
          description="One row per distinct fault, however many times it has happened. Closing one asks for a reason."
          help="Faults are grouped by shape, not by occurrence: identifiers, quoted strings and numbers are blanked out of the message before it is fingerprinted, so a hundred uploads failing the same way is one incident with a count of a hundred rather than a hundred rows nobody reads."
        />
        {view.open.length === 0 ? (
          <EmptyState title="Nothing is open">
            {/*
              Deliberately does not say "nothing has broken". This list holds
              open incidents, and an empty one means every fault recorded so far
              was closed with a reason — or that none was ever recorded, which
              looks identical from here and is the reason the sweep above is
              printed first.
            */}
            No fault is waiting on anybody. Whether that is because none has happened or because
            nothing is watching is a question the sweep above answers, not this list.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--color-hairline)]">
            {view.open.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} />
            ))}
          </ul>
        )}
      </Card>

      {view.resolved.length > 0 ? (
        <Card>
          <CardHeader
            title="Closed recently"
            description="The last fortnight, so a fault that comes back has its own history beside it."
            help="A resolved incident that recurs opens a new row rather than reopening the old one. The count starting over is what says “this came back” instead of “this never stopped”, and the closed row keeps the reason somebody gave."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {view.resolved.map((incident) => (
              <IncidentRow key={incident.id} incident={incident} />
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

/**
 * The sweep, led by the number that is easy to miss.
 *
 * `silentForMinutes` is not "the system is down", it is "nothing has checked",
 * which during a season is the same size of problem and looks like a clean
 * screen. It goes first for that reason, ahead of the pass rate.
 */
function ProbeCard({ view }: { view: OperationsView }) {
  const probe = view.probe;
  const silent = probe.silentForMinutes;
  const tone = silent === null || silent > 60 ? 'critical' : silent > 30 ? 'warning' : 'default';

  return (
    <Card>
      <CardHeader
        title="Last sweep"
        icon={Activity}
        description="A scheduled check of every dependency, written down whether or not anything is wrong."
        help="The sweep runs inside the app, so it cannot see the app being down — a deployment that is not answering at all records nothing, and this card goes quiet rather than red. That is what an external monitor pointed at /api/health is for; this card is what tells you the jobs are running."
        action={
          probe.last ? (
            <Badge tone={probe.last.ok ? 'good' : 'critical'} dot>
              {probe.last.ok ? 'All checks passed' : 'A check failed'}
            </Badge>
          ) : (
            <Badge tone="warning">Never run</Badge>
          )
        }
      />
      <StatGrid columns={4}>
        <StatCell>
          <Stat
            label="Silent for"
            value={silent === null ? 'never checked' : elapsed(silent)}
            tone={tone}
            note={probe.last ? `last sweep ${probe.last.ms} ms` : 'no sweep has ever run'}
            help="Minutes since any sweep at all. Past an hour the scheduler itself is the thing to look at — the cron runs every fifteen minutes."
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Passed"
            value={
              probe.windowCount === 0
                ? '—'
                : `${count(probe.windowOkCount)}/${count(probe.windowCount)}`
            }
            note="in the last 24 hours"
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Last clean"
            value={probe.lastOkAt === null ? '—' : day(probe.lastOkAt)}
            note={probe.lastOkAt === null ? 'no sweep has ever passed' : 'it was fine until then'}
          />
        </StatCell>
        <StatCell>
          <Stat label="Checked at" value={probe.last === null ? '—' : day(probe.last.checkedAt)} />
        </StatCell>
      </StatGrid>

      {probe.last === null ? (
        <div className="px-5 pb-5">
          <Callout tone="warning" icon={TriangleAlert} title="No sweep has ever run">
            Either the schedule is not configured on this deployment or it has never fired. Until it
            does, an outage leaves no trace at all — the first evidence would be a client saying
            their report never arrived.
          </Callout>
        </div>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)]">
          {probe.last.checks.map((check) => (
            <li key={check.name} className="flex items-start gap-3 px-5 py-3 text-sm">
              <span className="shrink-0 pt-0.5">
                <Badge tone={check.ok ? 'good' : 'critical'} dot>
                  {check.ok ? 'ok' : 'failed'}
                </Badge>
              </span>
              <span className="min-w-0 flex-1">
                <span className="font-medium text-[var(--color-ink)]">{check.name}</span>
                {check.detail ? (
                  <span className="block text-xs text-[var(--color-ink-muted)]">
                    {check.detail}
                  </span>
                ) : null}
              </span>
              <span className="tabular shrink-0 text-xs text-[var(--color-ink-muted)]">
                {count(check.ms)} ms
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Whether an alert would actually reach a person.
 *
 * On the screen because alerting nobody configured is worse than none: it is
 * the same silence, believed to be coverage. Both halves are printed — who the
 * mail goes to, and whether the scheduler that raises most of it is set up.
 */
function AlertingCard({ view }: { view: OperationsView }) {
  const alerting = view.alerting;
  const reaches = alerting.mailConfigured && alerting.recipients.length > 0;

  return (
    <Card>
      <CardHeader
        title="Alerting"
        icon={BellRing}
        description="Who hears about a new incident, and how loud it is allowed to get."
        action={
          <Badge tone={reaches ? 'good' : 'critical'} dot>
            {reaches ? 'Mail configured' : 'Nobody is mailed'}
          </Badge>
        }
      />
      <StatGrid columns={3}>
        <StatCell>
          <Stat
            label="Recipients"
            value={alerting.recipients.length === 0 ? 'none' : count(alerting.recipients.length)}
            note={
              alerting.recipients.length === 0
                ? 'set AUTH_ALLOWED_EMAILS'
                : alerting.recipients.join(', ')
            }
            tone={alerting.recipients.length === 0 ? 'critical' : 'default'}
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Sent this hour"
            value={`${count(alerting.sentLastHour)} of ${count(alerting.alertCap)}`}
            note="the cap that stops a storm"
            help="Past the cap a new incident is still recorded and still appears here, but no mail goes out — and it is marked as alerted anyway, so it never arrives hours later once the storm has passed. The page is the record; the mail is only the interruption."
            tone={alerting.sentLastHour >= alerting.alertCap ? 'warning' : 'default'}
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Scheduler"
            value={alerting.cronConfigured ? 'configured' : 'not configured'}
            tone={alerting.cronConfigured ? 'default' : 'critical'}
            note={alerting.cronConfigured ? 'CRON_SECRET is set' : 'set CRON_SECRET'}
            help="The same secret gates the run drainer and the health probe. Unset, both refuse to run rather than running open — so abandoned analyses are never requeued and no sweep is ever recorded."
          />
        </StatCell>
      </StatGrid>

      {reaches ? null : (
        <div className="px-5 pb-5">
          {/*
            Names only what is actually missing. A blanket "set these three"
            beside a card that has just printed two recipients reads as a bug in
            the page rather than a gap in the deployment, and a person who has
            been told something wrong once stops reading the rest of it.
          */}
          <Callout tone="critical" icon={ShieldAlert} title="An incident would reach nobody">
            Faults are still recorded and still listed on this page, but nothing interrupts anyone —
            which means somebody has to think to open this page. Set{' '}
            {missing(alerting.mailConfigured, alerting.recipients.length > 0)} on the deployment.
          </Callout>
        </div>
      )}
    </Card>
  );
}

/** One fault: what broke, whose work it interrupted, and how to close it. */
function IncidentRow({ incident }: { incident: Incident }) {
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [closing, setClosing] = useState(false);

  const resolve = useMutation({
    mutationFn: () => api.resolveIncident(incident.id, { resolution: reason.trim() }),
    onSuccess: (view) => {
      client.setQueryData(['operations'], view);
      setClosing(false);
      setReason('');
    },
  });

  const open = incident.resolvedAt === null;

  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-[var(--color-ink)]">{incident.label}</span>
        <Badge tone="neutral">{incident.surface}</Badge>
        {incident.occurrences > 1 ? (
          <Badge tone={incident.occurrences > 20 ? 'critical' : 'warning'}>
            {count(incident.occurrences)}×
          </Badge>
        ) : null}
        {incident.recurred ? (
          <Badge tone="serious">
            came back{' '}
            <InfoTip
              size={12}
              content="This fingerprint was closed once already and has happened again since. The earlier row keeps whoever's reason for closing it."
            />
          </Badge>
        ) : null}
        {open && incident.alertedAt === null ? (
          <Badge tone="warning">
            not alerted{' '}
            <InfoTip
              size={12}
              content="No mail went out for this one — either mail is unconfigured or the hourly cap was already reached when it opened."
            />
          </Badge>
        ) : null}
        {open ? null : <Badge tone="good">closed</Badge>}
      </div>

      <p className="text-sm break-words text-[var(--color-ink-secondary)]">{incident.message}</p>

      <p className="text-xs text-[var(--color-ink-muted)]">
        {incident.occurrences > 1
          ? `${day(incident.firstSeenAt)} → ${day(incident.lastSeenAt)}`
          : day(incident.firstSeenAt)}
        {incident.client ? ` · ${incident.client.name}` : ''}
        {incident.engagement ? ` · ${incident.engagement.taxYear}` : ''}
      </p>

      {incident.detail ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--color-ink-muted)]">Stack</summary>
          <pre className="mt-1.5 overflow-x-auto rounded-lg bg-[var(--color-sunken)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
            {incident.detail}
          </pre>
        </details>
      ) : null}

      {open ? (
        closing ? (
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <Field
              label="Why is it closed"
              help="Required. A fault closed with no reason is a fault hidden."
              className="min-w-[18rem] flex-1"
            >
              <TextInput
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Fixed in the register parser — the latin-1 fallback now covers it."
              />
            </Field>
            <div className="flex items-center gap-2 pb-0.5">
              <Button
                variant="primary"
                onClick={() => resolve.mutate()}
                disabled={reason.trim().length === 0 || resolve.isPending}
              >
                {resolve.isPending ? 'Closing…' : 'Close it'}
              </Button>
              <Button onClick={() => setClosing(false)} disabled={resolve.isPending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button onClick={() => setClosing(true)}>Close this incident</Button>
        )
      ) : (
        <p className="text-xs text-[var(--color-ink-muted)]">
          {incident.resolution}
          {incident.resolvedBy ? ` — ${incident.resolvedBy}` : ''}
          {incident.resolvedAt ? `, ${day(incident.resolvedAt)}` : ''}
        </p>
      )}

      {resolve.error ? (
        <Callout tone="critical">
          {resolve.error instanceof Error ? resolve.error.message : String(resolve.error)}
        </Callout>
      ) : null}
    </li>
  );
}

/** Which half of the alerting path is unset — mail transport, recipients, or both. */
function missing(mailConfigured: boolean, hasRecipients: boolean): string {
  if (!mailConfigured && !hasRecipients) {
    return 'RESEND_API_KEY, MAIL_FROM and AUTH_ALLOWED_EMAILS';
  }
  if (!mailConfigured) return 'RESEND_API_KEY and MAIL_FROM';
  return 'AUTH_ALLOWED_EMAILS';
}

/** Minutes, said the way a person would say them. */
function elapsed(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${count(whole)} ${plural(whole, 'minute')}`;
  const hours = Math.round(whole / 60);
  if (hours < 48) return `${count(hours)} ${plural(hours, 'hour')}`;
  const days = Math.round(hours / 24);
  return `${count(days)} ${plural(days, 'day')}`;
}

function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations"
        eyebrow="The floor"
        description="Faults grouped into incidents, and the scheduled sweep that makes silence mean something."
      />
      <Card>
        <div className="space-y-2 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-full max-w-xl" />
        </div>
        <ul className="divide-y divide-[var(--color-hairline)]">
          {[0, 1, 2].map((row) => (
            <li key={row} className="px-5 py-4">
              <Skeleton className="h-4 w-full max-w-md" />
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <div className="space-y-2 p-5">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-3.5 w-full max-w-lg" />
        </div>
      </Card>
    </div>
  );
}
