'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, FileText, Gavel, MapPinOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { appraisalDistrictName } from '@tangible/filing/districts';
import type {
  AssessmentNotice,
  FilingSeason,
  RenditionExtension,
  SeasonReturn,
  UnblockPlanRecord,
} from '@tangible/types';
import { api } from '@/lib/api';
import { count, day, dayShort, money, moneyExact, plural } from '@/lib/format';
import { Button, LinkButton } from '@/components/ui/controls';
import { ExtensionPanel } from '@/components/workspace/extension-panel';
import { NoticePanel } from '@/components/workspace/notice-panel';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { InfoTip, Tooltip } from '@/components/ui/tooltip';

/**
 * The season: every return this engagement owes, and where each one stands.
 *
 * The screens either side of this one are about a document. The draft is one
 * form, the filing record is one return that went out, and between them there
 * was nowhere that answered "what is left". An engagement with two sites owes
 * two renditions and the engagement page used to say "1 return filed" — true,
 * and the wrong half of the fact.
 *
 * So the rows here are every return, filed or not, in the order somebody would
 * work them: what is stuck, then what can go out, then what has gone.
 *
 * Each row carries its own deadline. The header's April date is the statutory
 * one and every row starts there, but an extension under Tax Code 22.23(b) is
 * granted per account — one site's request buys that site until May and says
 * nothing about the one next door. Printing the April date against an extended
 * row would be wrong in the direction that makes people file early for nothing;
 * printing May against an unextended one is how a 22.28 penalty happens.
 */
export function ReturnsBoard({
  clientId,
  engagementId,
}: {
  clientId: string;
  engagementId: string;
}) {
  const season = useQuery({
    queryKey: ['engagement-season', engagementId],
    queryFn: () => api.season(engagementId),
  });
  // Its own query rather than a field on the season, because the season carries
  // the extension that *stands* and this needs the ones that do not: a refused
  // request and an outstanding one both move nothing, and both are exactly what
  // somebody opening this panel is looking for.
  const extensions = useQuery({
    queryKey: ['engagement-extensions', engagementId],
    queryFn: () => api.extensions(engagementId),
  });

  if (season.error) return <ErrorState error={season.error} />;
  if (!season.data) return <Skeleton className="h-40 w-full" />;

  // Nothing placed and nothing filed is an engagement that has not reached
  // filing yet — the sites card is what it needs, not a board of no returns.
  if (season.data.returns.length === 0) return null;

  const draft = `/clients/${clientId}/engagements/${engagementId}/filing`;
  const { returns, taxYear, unplacedCount, unplacedCost } = season.data;
  const outstanding = returns.filter((entry) => entry.status !== 'filed');

  // Grouped by site, this year only. An extension recorded against last year's
  // return is history the moment the engagement rolls over, and showing it
  // beside a live deadline would read as one that still stands.
  const bySite = new Map<string, RenditionExtension[]>();
  for (const extension of extensions.data ?? []) {
    if (extension.taxYear !== taxYear) continue;
    const bucket = bySite.get(extension.locationId);
    if (bucket) bucket.push(extension);
    else bySite.set(extension.locationId, [extension]);
  }

  return (
    <Card>
      <CardHeader
        title={heading(returns)}
        description={<Calendar season={season.data} outstanding={outstanding} />}
        action={<LinkButton href={draft}>The draft</LinkButton>}
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {returns.map((entry) => (
          <ReturnRow
            key={entry.locationId}
            entry={entry}
            draft={draft}
            engagementId={engagementId}
            season={season.data}
            extensions={bySite.get(entry.locationId) ?? []}
          />
        ))}
        {unplacedCount > 0 ? <Unplaced n={unplacedCount} cost={unplacedCost} /> : null}
      </ul>
      {returns.length > 1 ? <Footer returns={returns} /> : null}
      {returns.some((entry) => entry.status === 'blocked') ? (
        <UnblockPlanSection engagementId={engagementId} />
      ) : null}
    </Card>
  );
}

/**
 * The unblock plan: the work that releases the blocked returns, and the one
 * client email it requires — drafted from the board's own blockers.
 *
 * Facts frozen at draft time, same as the protest brief, so a plan read after
 * the season moved still says what was blocked then. When it has moved, the
 * answer is Redraft: a new row, never an edit. The email is a draft to copy;
 * nothing here sends anything.
 */
function UnblockPlanSection({ engagementId }: { engagementId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['unblock-plan', engagementId],
    queryFn: () => api.unblockPlan(engagementId),
  });
  const draft = useMutation({
    mutationFn: () => api.draftUnblockPlan(engagementId),
    onSuccess: (result) => {
      queryClient.setQueryData(['unblock-plan', engagementId], result);
    },
  });

  const record = query.data?.plan ?? null;

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-plane)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--color-ink)]">
          Unblock plan{' '}
          <InfoTip
            size={12}
            className="align-text-bottom"
            content="Drafting turns the blockers above into a worked plan: what the firm does here, what needs the client, and one draft email that asks for all of it. Nothing is sent — the email is yours to copy."
          />
        </span>
        <Button variant="ghost" onClick={() => draft.mutate()} disabled={draft.isPending}>
          {draft.isPending
            ? 'Drafting…'
            : record
              ? 'Redraft from the board'
              : 'Draft from the board'}
        </Button>
      </div>

      {draft.isError ? (
        <p className="text-[11px] text-[var(--color-critical)]">
          {draft.error instanceof Error ? draft.error.message : 'The draft failed.'}
        </p>
      ) : null}

      {record ? (
        <UnblockPlanBody record={record} />
      ) : query.isLoading ? null : (
        <p className="text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
          Each blocker above says what clears it; drafting turns the list into a worked plan.
        </p>
      )}
    </div>
  );
}

function UnblockPlanBody({ record }: { record: UnblockPlanRecord }) {
  const { plan } = record;
  const firm = plan.steps.filter((step) => step.owner === 'firm');
  const client = plan.steps.filter((step) => step.owner === 'client');
  return (
    <div className="space-y-2 text-[11px] leading-relaxed">
      <p className="text-[var(--color-ink-muted)]">
        Drafted {dayShort(record.createdAt.slice(0, 10))} from the board as it stood then — redraft
        after clearing anything.
      </p>
      <p className="text-[var(--color-ink-secondary)]">{plan.summary}</p>

      {firm.length > 0 ? <StepList label="For the firm" steps={firm} /> : null}
      {client.length > 0 ? <StepList label="Needs the client" steps={client} /> : null}

      {plan.clientEmail ? (
        <div className="rounded border border-[var(--color-hairline)] p-2">
          <p className="font-medium text-[var(--color-ink)]">
            Draft email — {plan.clientEmail.subject}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-[var(--color-ink-secondary)]">
            {plan.clientEmail.body}
          </p>
        </div>
      ) : null}

      {plan.notes.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-[var(--color-ink-muted)]">
          {plan.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StepList({ label, steps }: { label: string; steps: UnblockPlanRecord['plan']['steps'] }) {
  return (
    <div>
      <p className="font-medium text-[var(--color-ink)]">{label}</p>
      <ul className="mt-0.5 space-y-0.5">
        {steps.map((step) => (
          <li key={`${step.returnLabel}:${step.blockerKey}`} className="flex gap-1.5">
            <span className="text-[var(--color-ink-muted)]">{step.returnLabel}:</span>
            <span className="text-[var(--color-ink-secondary)]">{step.action}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function heading(returns: SeasonReturn[]): string {
  const left = returns.filter((entry) => entry.status !== 'filed').length;
  const n = returns.length;
  if (left === 0) return `${count(n)} ${plural(n, 'return')} filed`;
  if (left === n) return `${count(n)} ${plural(n, 'return')} to file`;
  return `${count(left)} of ${count(n)} returns still to file`;
}

/**
 * Which district this return goes to.
 *
 * Shown on every row rather than only where two of them disagree, because a
 * reader cannot tell a checked answer from an unchecked one — and the case
 * worth catching is a site that never named a district and quietly took the
 * engagement's. Where the id is one we do not recognise there is no form to
 * print for it, so the raw slug is the honest thing to show rather than a
 * district name we invented.
 */
function District({ jurisdictionId }: { jurisdictionId: string | null }) {
  if (jurisdictionId === null) {
    return <span className="text-xs text-[var(--color-warning)]">no district</span>;
  }
  return (
    <span className="text-xs text-[var(--color-ink-secondary)]">
      {appraisalDistrictName(jurisdictionId) ?? jurisdictionId}
    </span>
  );
}

/**
 * The statutory calendar, and what it means today.
 *
 * Phrased against the returns still out rather than against the calendar. Once
 * everything has gone the date is history and saying "12 days left" over a
 * finished season would be noise dressed as urgency.
 *
 * What this does *not* say any more is that a request moves "every return
 * here". It moves one, and the rows below say which.
 */
function Calendar({ season, outstanding }: { season: FilingSeason; outstanding: SeasonReturn[] }) {
  if (outstanding.length === 0) {
    return (
      <>
        Frozen as they went out.{' '}
        <InfoTip
          size={12}
          className="align-text-bottom"
          content="These figures do not move when the register does — which is the point, and what a 22.28 penalty would be measured against."
        />
      </>
    );
  }

  const extended = outstanding.filter((entry) => entry.extension !== null).length;

  return (
    <>
      Due {day(season.dueOn)} under Tax Code 22.23(a)
      {season.daysToDue >= 0
        ? `, ${count(season.daysToDue)} ${plural(season.daysToDue, 'day')} away`
        : ''}
      .
      {extended > 0
        ? ` ${count(extended)} of the ones still out ${plural(extended, 'is', 'are')} on an extension.`
        : ''}{' '}
      <InfoTip
        size={12}
        className="align-text-bottom"
        content={
          <>
            A written request on or before the due date moves one return to{' '}
            {dayShort(season.extendedDueOn)} under 22.23(b) — per account rather than per
            engagement, so each row works to its own date. A late return draws 10% of the taxes due
            on the property it covers (22.28), per return rather than per engagement.
          </>
        }
      />
    </>
  );
}

const TONE = {
  blocked: 'critical',
  ready: 'accent',
  filed: 'good',
} as const;

const STATUS_LABEL = {
  blocked: 'blocked',
  ready: 'ready',
  filed: 'filed',
} as const;

function ReturnRow({
  entry,
  draft,
  engagementId,
  season,
  extensions,
}: {
  entry: SeasonReturn;
  draft: string;
  engagementId: string;
  season: FilingSeason;
  extensions: RenditionExtension[];
}) {
  const site = `${draft}?site=${encodeURIComponent(entry.locationId)}`;
  // One panel at a time rather than two booleans. A row is a return, and the
  // two things there are to say about it — what we asked the district for, and
  // what it said back — are read one after the other, not side by side.
  const [panel, setPanel] = useState<'extension' | 'notice' | null>(null);

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <Badge tone={TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Badge>
        <span className="font-medium">{entry.label}</span>
        <span className="text-xs text-[var(--color-ink-secondary)]">
          {entry.accountId ? (
            `account ${entry.accountId}`
          ) : (
            <span className="text-[var(--color-warning)]">no account number</span>
          )}
        </span>
        <District jurisdictionId={entry.jurisdictionId} />
        {entry.status === 'filed' ? (
          <Protest entry={entry} taxYear={season.taxYear} />
        ) : (
          <Due entry={entry} statutory={season.dueOn} />
        )}
        {/* `ml-auto` belongs on the tooltip rather than the span inside it: the
            wrapper is the flex item, and a margin on the child pushes nothing. */}
        <Tooltip
          className="ml-auto"
          title={entry.status === 'filed' ? 'What was filed' : 'What this would file'}
          content={
            entry.status === 'filed'
              ? `${moneyExact(entry.filing?.totalHistoricalCost)} across ${count(entry.filing?.assetCount)} ${plural(entry.filing?.assetCount ?? 0, 'asset')}, frozen the day it went out. The register at this site now holds ${moneyExact(entry.registerCost)}.`
              : `${moneyExact(entry.renderedCost)} on the schedules, out of ${moneyExact(entry.registerCost)} the register holds here. The difference is property the rendition sets aside — disposed before January 1, intangible, or removed by an accepted finding.`
          }
        >
          {/* A filed row reports the return, not the register: those are the
              same numbers only until the register moves, and the row exists to
              say what went out. The unfiled ones report what would go out. */}
          <span className="tabular text-xs text-[var(--color-ink-secondary)]">
            {entry.status === 'filed'
              ? `${count(entry.filing!.assetCount)} ${plural(entry.filing!.assetCount, 'asset')} · ${money(entry.filing!.totalHistoricalCost)}`
              : `${count(entry.assetCount)} ${plural(entry.assetCount, 'asset')} · ${money(entry.renderedCost)}`}
          </span>
        </Tooltip>
        {entry.status === 'filed' ? (
          <LinkButton href={`/filings/${entry.filing!.id}`}>The form as filed</LinkButton>
        ) : (
          <LinkButton href={site}>
            <FileText size={12} strokeWidth={2} />
            {entry.status === 'blocked' ? 'Open it' : 'File it'}
          </LinkButton>
        )}
      </div>
      <Detail entry={entry} noticeOpen={panel === 'notice'} />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4">
        {/* Offered on a filed row only where something is already on file. The
            request that carried a return past April is part of its story; a form
            for asking is not, once the thing has gone out. */}
        {entry.status !== 'filed' || extensions.length > 0 ? (
          <Toggle
            open={panel === 'extension'}
            onClick={() => setPanel((was) => (was === 'extension' ? null : 'extension'))}
          >
            {panel === 'extension'
              ? 'Hide the extension record'
              : extensions.length > 0
                ? `The extension record · ${count(extensions.length)} on file`
                : 'Ask for an extension'}
          </Toggle>
        ) : null}
        {/* Only once a return has gone out. A notice answers a rendition, and
            offering to record one against a return still sitting in the drafts
            is offering to record somebody else's mail. */}
        {entry.status === 'filed' ? (
          <Toggle
            open={panel === 'notice'}
            onClick={() => setPanel((was) => (was === 'notice' ? null : 'notice'))}
          >
            {panel === 'notice'
              ? 'Hide the district’s answer'
              : entry.notice
                ? 'The district’s answer'
                : 'Record the notice'}
          </Toggle>
        ) : null}
      </div>
      {panel === 'extension' ? (
        <ExtensionPanel
          engagementId={engagementId}
          locationId={entry.locationId}
          label={entry.label}
          statutoryDueOn={season.dueOn}
          extendedDueOn={season.extendedDueOn}
          extensions={extensions}
        />
      ) : null}
      {panel === 'notice' ? (
        <NoticePanel
          engagementId={engagementId}
          locationId={entry.locationId}
          label={entry.label}
          taxYear={season.taxYear}
          notice={entry.notice}
        />
      ) : null}
    </li>
  );
}

function Toggle({
  open,
  onClick,
  children,
}: {
  open: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="cursor-pointer text-xs font-medium text-[var(--color-ink-secondary)] hover:underline"
    >
      {children}
    </button>
  );
}

/**
 * Where a filed return stands with the district.
 *
 * This is the half of the season the board used to stop short of. A return
 * going out is not the end of the exposure — it is the point at which the
 * district gets to answer, and 41.44 gives the later of May 15 and thirty days
 * from delivery to disagree with the answer. After that the value stands for
 * the year, and nothing in the software or the statute reopens it.
 *
 * A filed row with no notice says so only once notices are actually late: under
 * 25.19 the chief appraiser has until May 1 for personal property, so before
 * then "no notice" is the expected state and printing it would be an alarm
 * about the calendar working correctly.
 */
function Protest({ entry, taxYear }: { entry: SeasonReturn; taxYear: number }) {
  if (entry.notice === null) {
    const noticesDue = `${taxYear}-05-01`;
    if (today() <= noticesDue) return null;
    return (
      <Tooltip
        title="No notice recorded"
        content={`Under 25.19 the district delivers a notice of appraised value for personal property by ${day(noticesDue)}. Either one has not come — worth a call, because the protest window runs from delivery whether or not anybody opened the envelope — or one came and is not recorded here.`}
      >
        <span className="text-xs text-[var(--color-warning)]">no notice recorded</span>
      </Tooltip>
    );
  }

  const { protest } = entry.notice;
  // Whichever clock runs out first. The waiver has no May 15 under it and so
  // usually closes weeks before the protest window does — counting down to the
  // protest date while the penalty waiver quietly expires is the exact failure
  // this row exists to prevent.
  const soonest =
    protest.waiverDeadline &&
    entry.notice.protestFiledOn === null &&
    protest.waiverDeadline < protest.deadline
      ? { date: protest.waiverDeadline, what: 'waiver' as const }
      : { date: protest.deadline, what: 'protest' as const };
  const left = daysUntil(soonest.date);

  if (entry.notice.protestFiledOn !== null) {
    return (
      <Tooltip title="Protested" content={protest.standing}>
        <span className="inline-flex items-center gap-1 text-xs text-[var(--color-good)]">
          <Gavel size={11} strokeWidth={2} />
          protested {dayShort(entry.notice.protestFiledOn)}
        </span>
      </Tooltip>
    );
  }

  const colour = !protest.open
    ? 'text-[var(--color-ink-muted)]'
    : left <= 14
      ? 'text-[var(--color-warning)]'
      : 'text-[var(--color-ink-secondary)]';

  return (
    <Tooltip
      title={protest.open ? 'The protest window' : 'The protest window has closed'}
      content={
        protest.standing +
        (protest.waiverDeadline && soonest.what === 'waiver'
          ? ` The 22.30(b) penalty waiver has to be asked for by ${day(protest.waiverDeadline)}, which comes first.`
          : '')
      }
    >
      <span className={`tabular inline-flex items-center gap-1 text-xs ${colour}`}>
        <Gavel size={11} strokeWidth={2} />
        {soonest.what === 'waiver' ? 'waiver by ' : 'protest by '}
        {dayShort(soonest.date)}
        {protest.open ? ` · ${countdown(left)}` : ' · closed'}
      </span>
    </Tooltip>
  );
}

/** Today in UTC, to compare against dates that are dates rather than instants. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Whole days from today to an ISO date, in UTC on both sides.
 *
 * The same rule the season uses on the server. A statutory date is a date, not
 * an instant, and subtracting a local midnight from a UTC one is how a deadline
 * reads as a day nearer or further depending on the reader's timezone.
 */
function daysUntil(iso: string): number {
  const now = new Date();
  const from = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - from) / 86_400_000);
}

/**
 * The date this one return is working to.
 *
 * Coloured off how long is left rather than off the status, because a blocked
 * return three weeks out and a blocked return two days out are the same row
 * with completely different amounts of trouble in them. An extended row says so
 * on its face: the date alone would look like an app that had lost track of
 * April.
 */
function Due({ entry, statutory }: { entry: SeasonReturn; statutory: string }) {
  const extended = entry.extension !== null;
  const colour =
    entry.daysToDue < 0
      ? 'text-[var(--color-critical)]'
      : entry.daysToDue <= 14
        ? 'text-[var(--color-warning)]'
        : 'text-[var(--color-ink-secondary)]';

  return (
    <Tooltip
      title={extended ? 'Extended under 22.23(b)' : 'The statutory deadline'}
      content={
        extended
          ? entry.extension!.standing
          : `${day(statutory)} under Tax Code 22.23(a), with nothing on file that moves it. A written request reaching the chief appraiser on or before that day would — he has no discretion to refuse one.`
      }
    >
      <span className={`tabular inline-flex items-center gap-1 text-xs ${colour}`}>
        {extended ? <CalendarClock size={11} strokeWidth={2} /> : null}
        due {dayShort(entry.dueOn)} · {countdown(entry.daysToDue)}
      </span>
    </Tooltip>
  );
}

function countdown(days: number): string {
  if (days === 0) return 'today';
  if (days > 0) return `${count(days)} ${plural(days, 'day')} left`;
  return `${count(-days)} ${plural(-days, 'day')} overdue`;
}

/**
 * The line under a row: why it is stuck, or what has happened since it went out.
 *
 * A blocked return names its first blocker in full rather than a count. The
 * count is what the draft screen already shows and it tells nobody whether the
 * thing to do is five minutes' typing or a call to the client.
 */
function Detail({ entry, noticeOpen }: { entry: SeasonReturn; noticeOpen: boolean }) {
  if (entry.status === 'blocked') {
    const [first, ...rest] = entry.blockers;
    return (
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {first?.message}
        {rest.length > 0 ? ` Plus ${count(rest.length)} more on the draft.` : ''}
      </p>
    );
  }

  if (entry.status === 'ready') {
    return (
      <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">
        Nothing is holding this up.
        {entry.warnings > 0
          ? ` ${count(entry.warnings)} ${plural(entry.warnings, 'thing')} on the draft ${plural(entry.warnings, 'is', 'are')} worth reading before you sign it.`
          : ''}
      </p>
    );
  }

  const filing = entry.filing!;
  const drift = entry.driftedBy ?? 0;
  // Against the deadline this return was actually working to, extension and
  // all. Both halves are worth saying: a return that beat an extension it had
  // to ask for is the reason somebody asked, and one that missed its date is a
  // 22.28 exposure nobody should have to work out from two dates on a screen.
  const late = filing.filedOn > entry.dueOn;

  return (
    <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
      Sent {filing.filedOn}
      {filing.confirmation ? ` · ${filing.confirmation}` : ''}
      {late ? (
        <>
          {' · '}
          <span className="text-[var(--color-critical)]">
            after the {dayShort(entry.dueOn)} deadline — 22.28 puts 10% of the taxes on this
            property at risk
          </span>
        </>
      ) : entry.extension !== null ? (
        <>
          {' · '}
          <span className="text-[var(--color-ink-muted)]">
            inside the extension to {dayShort(entry.dueOn)}
          </span>
        </>
      ) : null}
      {drift !== 0 ? (
        <>
          {' · '}
          <span className="text-[var(--color-warning)]">
            the register has moved {money(Math.abs(drift))} {drift > 0 ? 'up' : 'down'} since
          </span>
        </>
      ) : null}
      {noticeOpen ? null : (
        <>
          <Contradiction notice={entry.notice} />
          <Divergence notice={entry.notice} />
        </>
      )}
    </p>
  );
}

/**
 * A notice that contradicts our own filing record, said out loud on the row.
 *
 * Only the critical one, and only on the row rather than behind the panel
 * toggle. A district applying the 22.28 penalty to a return we can prove was
 * postmarked in time is both an error to correct and the likeliest explanation
 * for a value that ignores what we rendered — and it comes with 22.30(b)'s
 * thirty days attached, which is not enough time to find it by opening panels.
 *
 * It stands down once the panel is open, where the same sentence sits three
 * lines below in the check list. Saying it twice in one screen reads as two
 * problems until somebody reads both.
 */
function Contradiction({ notice }: { notice: AssessmentNotice | null }) {
  const critical = notice?.checks.find((check) => check.severity === 'critical');
  if (!critical) return null;
  return (
    <>
      <br />
      <span className="text-[var(--color-critical)]">{critical.message}</span>
    </>
  );
}

/**
 * A noticed value above our own filed schedule, with no protest on file.
 *
 * The arithmetic already lives in the notice panel's checks; what the row has
 * to say is the combination — the district ignored what we rendered *and*
 * nobody has answered. While the Chapter 41 window is open that is a deadline
 * running against found money. Once it shuts unanswered the value stood, and
 * the honest thing left to point at is the panel's 25.25 outlook rather than
 * a protest nobody can file any more.
 *
 * Stands down with Contradiction when the panel is open, for the same reason:
 * the panel's check list says this three lines down.
 */
function Divergence({ notice }: { notice: AssessmentNotice | null }) {
  if (!notice || notice.protestFiledOn !== null) return null;
  const above = notice.checks.find((check) => check.key === 'above-schedule');
  if (!above) return null;
  if (notice.protest.open) {
    return (
      <>
        <br />
        <span className="text-[var(--color-warning)]">
          {above.message} No protest is on file — the window runs to{' '}
          {dayShort(notice.protest.deadline)} ({countdown(daysUntil(notice.protest.deadline))}).
        </span>
      </>
    );
  }
  return (
    <>
      <br />
      <span className="text-[var(--color-ink-muted)]">
        {above.message} The protest window closed with nothing filed, so that value stood for{' '}
        {notice.taxYear} — the notice panel says whether a 25.25 route back into it is still open.
      </span>
    </>
  );
}

/**
 * Property on no return at all.
 *
 * Its own row rather than folded into a site, because which site it belongs to
 * is exactly what nobody knows — and under-rendering is what 22.28 penalises,
 * whichever site it turns out to sit at.
 */
function Unplaced({ n, cost }: { n: number; cost: number }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 bg-[var(--color-plane)] px-5 py-3 text-sm">
      <MapPinOff size={13} strokeWidth={2} className="text-[var(--color-warning)]" />
      <span className="font-medium">On no return</span>
      <span className="text-xs text-[var(--color-ink-secondary)]">
        {count(n)} held {plural(n, 'asset')} at no resolved site. Place them so each lands on the
        return for the site it sits at.
      </span>
      <span className="tabular ml-auto text-xs">{money(cost)}</span>
    </li>
  );
}

/** What the season adds up to, once there is more than one return in it. */
function Footer({ returns }: { returns: SeasonReturn[] }) {
  const filed = returns
    .filter((entry) => entry.status === 'filed')
    .reduce((sum, entry) => sum + (entry.filing?.totalHistoricalCost ?? 0), 0);
  const outstanding = returns
    .filter((entry) => entry.status !== 'filed')
    .reduce((sum, entry) => sum + entry.renderedCost, 0);

  return (
    <div className="flex flex-wrap items-baseline gap-x-6 border-t border-[var(--color-hairline)] px-5 py-3 text-sm">
      <span className="font-semibold">Across every site</span>
      <span className="tabular ml-auto text-xs text-[var(--color-ink-secondary)]">
        {moneyExact(filed)} rendered
        {outstanding > 0 ? ` · ${moneyExact(outstanding)} still to go out` : ''}
      </span>
    </div>
  );
}
