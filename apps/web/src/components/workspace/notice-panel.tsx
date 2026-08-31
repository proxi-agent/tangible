'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  AssessmentNotice,
  NoticeCheck,
  PenaltyOutcome,
  ProtestBriefRecord,
  ProtestResolution,
  ResolutionStage,
} from '@tangible/types';
import { api } from '@/lib/api';
import { day, dayShort, moneyExact } from '@/lib/format';
import { Button, Field, Select, TextArea, TextInput } from '@/components/ui/controls';
import { Badge } from '@/components/ui/primitives';
import { CorrectionRoutes } from '@/components/workspace/correction-routes';
import { DownloadButton } from '@/components/workspace/download-button';
import { today } from '@/lib/today';

/**
 * What the district concluded about one return, and how long there is to argue.
 *
 * The season used to end at "filed". It does not: under 25.19 the chief
 * appraiser delivers a notice of appraised value for personal property by
 * May 1, and that piece of mail is both the first news of whether the filing
 * worked and the last chance to do anything about it. A rendition filed late
 * costs 10% of the taxes on the property (22.28). A value nobody protested
 * costs the difference between what the district decided and what the property
 * is worth, for the whole year.
 *
 * Three clocks come off the one envelope and they are not the same clock —
 * 41.44's protest window, 22.30(b)'s thirty days to ask for a rendition penalty
 * to be waived, and whatever date the district printed. The panel shows all
 * three where they differ, because the difference is the finding.
 */
export function NoticePanel({
  engagementId,
  locationId,
  label,
  taxYear,
  notice,
}: {
  engagementId: string;
  locationId: string;
  label: string;
  taxYear: number;
  notice: AssessmentNotice | null;
}) {
  return (
    <div className="mt-2.5 space-y-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-plane)] p-3">
      {notice ? (
        <Recorded notice={notice} engagementId={engagementId} />
      ) : (
        <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          Nothing recorded for {label}. Under 25.19 the district delivers a notice of appraised
          value for personal property by May 1. Record it the day it lands, even if only the date —
          41.44 runs the protest window to the later of {dayShort(`${taxYear}-05-15`)} and thirty
          days from delivery, and the date is what starts it.
        </p>
      )}
      <RecordForm engagementId={engagementId} locationId={locationId} taxYear={taxYear} />
    </div>
  );
}

const CHECK_TONE = { critical: 'critical', warning: 'warning', note: 'neutral' } as const;

/**
 * One notice on file.
 *
 * The standing sentence sits above the figures rather than under them because
 * the deadline is the thing to act on and the value is only the reason. A
 * notice whose window closed last week is a row somebody needs to see closed,
 * not a set of numbers to read.
 */
function Recorded({ notice, engagementId }: { notice: AssessmentNotice; engagementId: string }) {
  const { protest } = notice;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs">
        <Badge
          tone={
            notice.status !== 'active'
              ? 'neutral'
              : notice.resolution
                ? (notice.resolution.standing.reduction ?? 0) > 0
                  ? 'good'
                  : 'neutral'
                : notice.protestFiledOn
                  ? 'accent'
                  : protest.open
                    ? 'accent'
                    : 'critical'
          }
        >
          {notice.status !== 'active'
            ? notice.status
            : notice.resolution
              ? 'settled'
              : notice.protestFiledOn
                ? 'protested'
                : protest.open
                  ? 'open'
                  : 'closed'}
        </Badge>
        <span className="font-medium">Noticed {dayShort(notice.noticedOn)}</span>
        {notice.deliveredOn ? (
          <span className="text-[var(--color-ink-secondary)]">
            arrived {dayShort(notice.deliveredOn)}
          </span>
        ) : null}
        {notice.districtName ? (
          <span className="text-[var(--color-ink-secondary)]">{notice.districtName}</span>
        ) : null}
        <span
          className={
            protest.open
              ? 'tabular ml-auto font-medium text-[var(--color-good)]'
              : 'tabular ml-auto text-[var(--color-ink-muted)] line-through'
          }
        >
          protest by {dayShort(protest.deadline)}
        </span>
      </div>

      <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {protest.standing}
        {notice.protestNote ? ` ${notice.protestNote}` : ''}
        {notice.voidReason ? ` Voided: ${notice.voidReason}` : ''}
      </p>

      {/* The waiver clock, on its own line and only where it exists. It has no
          May 15 under it, so it usually runs out first — and a firm that
          protested the value in time and let this one pass has still lost 10%
          of the taxes on the property. */}
      {protest.waiverDeadline && !notice.protestFiledOn ? (
        <p className="text-xs leading-relaxed text-[var(--color-warning)]">
          The penalty waiver has to be asked for by {day(protest.waiverDeadline)} — thirty days
          under 22.30(b), with no May 15 beneath it. That is{' '}
          {protest.waiverDeadline < protest.deadline
            ? 'earlier than the protest deadline above'
            : protest.waiverDeadline === protest.deadline
              ? 'the same day as the protest deadline'
              : 'after the protest deadline above, so the protest is the one that closes first'}
          .
        </p>
      ) : null}

      <Values notice={notice} />
      {notice.checks.length > 0 ? (
        <ul className="space-y-1.5">
          {notice.checks.map((check) => (
            <Check key={check.key} check={check} />
          ))}
        </ul>
      ) : null}
      {notice.note ? <p className="text-xs text-[var(--color-ink-muted)]">{notice.note}</p> : null}

      {notice.status === 'active' && notice.appraisedValue !== null && !notice.resolution ? (
        <BriefSection notice={notice} />
      ) : null}

      {notice.status === 'active' && protest.open ? <ProtestForm notice={notice} /> : null}

      {notice.resolution ? (
        <Resolved resolution={notice.resolution} engagementId={engagementId} />
      ) : null}

      {notice.status === 'active' && notice.protestFiledOn === null ? (
        <Close notice={notice} engagementId={engagementId} />
      ) : null}
      {notice.status === 'active' && notice.resolution === null ? (
        <Resolve notice={notice} engagementId={engagementId} />
      ) : null}

      {notice.correction ? <CorrectionRoutes outlook={notice.correction} /> : null}
    </div>
  );
}

/**
 * The protest brief: drafted from the record, read by the person who files.
 *
 * The facts under the draft are frozen on the row, so the sentence naming the
 * over-assessment always agrees with the argument beneath it — even after the
 * record has moved. When it has, the answer is the Redraft button: a new row,
 * never an edit, same as every other record in the season.
 */
function BriefSection({ notice }: { notice: AssessmentNotice }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['notice-brief', notice.id],
    queryFn: () => api.noticeBrief(notice.id),
  });
  const draft = useMutation({
    mutationFn: () => api.draftNoticeBrief(notice.id),
    onSuccess: (result) => {
      queryClient.setQueryData(['notice-brief', notice.id], result);
    },
  });

  const record = query.data?.brief ?? null;

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--color-ink)]">Protest brief</span>
        {/* A real button, not a ghost. This is the one action on the panel and
            it sat as grey prose at the end of the heading row, where it read
            as part of the title rather than as something to press. */}
        <Button
          variant="secondary"
          size="sm"
          onClick={() => draft.mutate()}
          disabled={draft.isPending}
        >
          {draft.isPending
            ? 'Drafting…'
            : record
              ? 'Redraft from the record'
              : 'Draft from the record'}
        </Button>
      </div>

      {draft.isError ? (
        <p className="text-xs text-[var(--color-critical)]">
          {draft.error instanceof Error ? draft.error.message : 'The draft failed.'}
        </p>
      ) : null}

      {record ? (
        <BriefBody record={record} />
      ) : query.isLoading ? null : (
        <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          Every fact the argument needs is already on file — the rendered value, the noticed value,
          the findings behind our number. Drafting assembles them and writes the argument; filing
          the protest stays yours.
        </p>
      )}
    </div>
  );
}

function BriefBody({ record }: { record: ProtestBriefRecord }) {
  const { facts, brief } = record;
  return (
    <div className="space-y-2 text-xs leading-relaxed">
      <p className="text-[var(--color-ink-muted)]">
        Drafted {dayShort(record.createdAt.slice(0, 10))} from the record as it stood then
        {facts.overAssessment !== null ? (
          <>
            {' — '}
            <span
              className={
                facts.overAssessment > 0
                  ? 'font-medium text-[var(--color-ink)]'
                  : 'text-[var(--color-ink-secondary)]'
              }
            >
              {facts.overAssessment > 0
                ? `${moneyExact(facts.overAssessment)} over the rendered value`
                : 'noticed at or under the rendered value'}
            </span>
          </>
        ) : (
          ' — no filed return to measure against'
        )}
        .
      </p>

      <p className="text-[var(--color-ink-secondary)]">{brief.summary}</p>

      {brief.grounds.map((ground) => (
        <div key={ground.heading} className="rounded border border-[var(--color-hairline)] p-2">
          <p className="font-medium text-[var(--color-ink)]">{ground.heading}</p>
          <p className="mt-0.5 text-[var(--color-ink-secondary)]">{ground.argument}</p>
          <p className="mt-0.5 text-[var(--color-ink-muted)]">Rests on: {ground.support}</p>
        </div>
      ))}

      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {brief.valueRequested !== null ? (
          <span className="text-[var(--color-ink-secondary)]">
            value requested{' '}
            <span className="tabular font-medium text-[var(--color-ink)]">
              {moneyExact(brief.valueRequested)}
            </span>
          </span>
        ) : null}
      </div>

      {brief.penaltyRequest ? (
        <p className="text-[var(--color-warning)]">{brief.penaltyRequest}</p>
      ) : null}

      {brief.gaps.length > 0 ? (
        <div>
          <p className="font-medium text-[var(--color-ink)]">Before the hearing</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[var(--color-ink-secondary)]">
            {brief.gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The notice of protest itself, on Form 50-132.
 *
 * The brief above is the argument; this is the filing. 41.44 wants a written
 * notice identifying the owner, the property and what is being protested,
 * delivered before the deadline this panel is counting down — and a firm that
 * drafted the argument and never sent the form has spent the window on prose.
 *
 * Only two things are asked for here. Everything else the form wants is
 * already on the record, and the two that are not have defaults the ARB
 * applies to a blank box, so leaving them alone is a real answer rather than a
 * missing one. The value is the exception worth offering: absent an override
 * the form asks for what the drafted brief asks for, or failing that the
 * schedule value of the return this notice answered.
 */
function ProtestForm({ notice }: { notice: AssessmentNotice }) {
  const [value, setValue] = useState('');
  const [appearance, setAppearance] = useState('');

  const query = new URLSearchParams();
  const claimed = amount(value);
  if (claimed !== null) query.set('value', String(claimed));
  if (appearance) query.set('appearance', appearance);
  const suffix = query.toString() ? `?${query.toString()}` : '';

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] p-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--color-ink)]">
          Notice of protest — Form 50-132
        </span>
      </div>
      <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        The value ground, ticked, with the account and the owner off the record and the signature
        line left empty. Deliver it by {day(notice.protest.deadline)} — the brief argues the
        protest, this is the protest.
      </p>
      <div className="flex flex-wrap items-end gap-2.5">
        <Field
          label="Ask the board for"
          help="Section 4's opinion of value, which the form marks optional. Left blank it takes the value the drafted brief asks for, and failing that the schedule value of the return this notice answered — both numbers the firm has already stood behind."
        >
          <TextInput
            inputMode="decimal"
            className="w-32"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="from the brief"
          />
        </Field>
        <Field
          label="Appear"
          help="How the hearing will be attended. The three that are not in person commit to delivering a written affidavit with the evidence before the hearing begins, which is work on a date the board sets. Left unanswered the form says nothing and the choice stays open."
        >
          <Select value={appearance} onChange={(event) => setAppearance(event.target.value)}>
            <option value="">Unanswered</option>
            <option value="in-person">In person</option>
            <option value="telephone">By telephone, with an affidavit</option>
            <option value="videoconference">By videoconference, with an affidavit</option>
            <option value="affidavit">On affidavit alone</option>
          </Select>
        </Field>
      </div>
      <DownloadButton href={`/api/notices/${notice.id}/protest${suffix}`} busyLabel="Filling…">
        Form 50-132
      </DownloadButton>
    </div>
  );
}

function Values({ notice }: { notice: AssessmentNotice }) {
  const figures = [
    { label: 'appraised', value: notice.appraisedValue },
    { label: 'assessed', value: notice.assessedValue },
    { label: `prior year`, value: notice.priorYearValue },
  ].filter((figure) => figure.value !== null);
  if (figures.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {figures.map((figure) => (
        <span key={figure.label} className="text-[var(--color-ink-secondary)]">
          {figure.label}{' '}
          <span className="tabular font-medium text-[var(--color-ink)]">
            {moneyExact(figure.value)}
          </span>
        </span>
      ))}
    </div>
  );
}

function Check({ check }: { check: NoticeCheck }) {
  return (
    <li className="flex gap-2 text-xs leading-relaxed">
      <Badge tone={CHECK_TONE[check.severity]}>{check.severity}</Badge>
      <span
        className={
          check.severity === 'note'
            ? 'text-[var(--color-ink-secondary)]'
            : 'text-[var(--color-ink)]'
        }
      >
        {check.message}
      </span>
    </li>
  );
}

/**
 * Closing a notice out: we protested it, or it was never ours.
 *
 * Kept apart the way a denied extension is kept apart from a voided one. "We
 * protested this value" and "this notice was recorded against the wrong site"
 * are different facts, and only the first one is worth anything at a hearing.
 */
function Close({ notice, engagementId }: { notice: AssessmentNotice; engagementId: string }) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<'protested' | 'void' | null>(null);
  const [filedOn, setFiledOn] = useState(() => today());
  const [note, setNote] = useState('');

  const save = useMutation({
    mutationFn: (chosen: 'protested' | 'void') =>
      api.updateNotice(notice.id, {
        outcome: chosen,
        // Voiding is our own act on our own record, so it carries no date the
        // district would recognise — the reason is the whole of it.
        protestFiledOn: chosen === 'void' ? null : filedOn,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      setOutcome(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['engagement-notices', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season', engagementId] });
    },
  });

  if (outcome === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {/* The forward action gets button affordance; "Recorded in error"
            stays a quiet text control on purpose — it is corrective, not a
            step anyone should be invited toward. */}
        <Button size="sm" onClick={() => setOutcome('protested')}>
          We protested this
        </Button>
        <button
          type="button"
          onClick={() => setOutcome('void')}
          className="cursor-pointer text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-critical)]"
        >
          Recorded in error
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2.5">
      <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {outcome === 'void'
          ? 'Voiding keeps the row and marks it as never having happened. Use it where the notice was recorded against the wrong site or the wrong year — not where the district was simply wrong about the value, which is what a protest is for.'
          : '41.44 makes the filing date the condition of being entitled to a hearing at all, so this is the date the notice of protest went in — not the day of the hearing.'}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {outcome === 'protested' ? (
          <Field label="Protest filed">
            <TextInput
              type="date"
              value={filedOn}
              onChange={(event) => setFiledOn(event.target.value)}
            />
          </Field>
        ) : null}
        <TextInput
          className="min-w-52 flex-1"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            outcome === 'void'
              ? 'Why — e.g. recorded against the wrong site'
              : 'What was protested, and on what grounds'
          }
        />
        <Button
          variant={outcome === 'void' ? 'secondary' : 'primary'}
          disabled={save.isPending || (outcome === 'void' && note.trim().length === 0)}
          onClick={() => save.mutate(outcome)}
        >
          {save.isPending ? 'Saving…' : outcome === 'void' ? 'Void it' : 'Record the protest'}
        </Button>
        <Button variant="ghost" onClick={() => setOutcome(null)}>
          Never mind
        </Button>
      </div>
      {save.error ? (
        <p className="text-xs leading-relaxed text-[var(--color-critical)]">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      ) : null}
    </div>
  );
}

const STAGE_LABEL: Record<ResolutionStage, string> = {
  informal: 'settled informally',
  arb: 'ARB order',
  withdrawn: 'withdrawn',
  dismissed: 'dismissed',
};

/**
 * How the protest ended.
 *
 * The row the season is actually measured by. Everything above it is the
 * district's proposal and the fact that somebody argued with it; this is the
 * number the client is billed against and the number next year opens from.
 *
 * The header repeats the notice's own shape one line down: what happened on the
 * left, and on the right the only date still running. Most endings have none —
 * an informal settlement is final under 1.111(e) and a withdrawal determined
 * nothing — so that slot is usually empty, which is itself the answer.
 */
function Resolved({
  resolution,
  engagementId,
}: {
  resolution: ProtestResolution;
  engagementId: string;
}) {
  const { standing } = resolution;
  const moved = standing.reduction;
  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs">
        <Badge tone={moved !== null && moved > 0 ? 'good' : 'neutral'}>
          {STAGE_LABEL[resolution.stage]}
        </Badge>
        <span className="font-medium">{dayShort(resolution.resolvedOn)}</span>
        {resolution.orderReference ? (
          <span className="text-[var(--color-ink-secondary)]">
            order {resolution.orderReference}
          </span>
        ) : null}
        {moved !== null && moved !== 0 ? (
          <span
            className={
              moved > 0
                ? 'tabular font-medium text-[var(--color-good)]'
                : 'tabular font-medium text-[var(--color-critical)]'
            }
          >
            {moved > 0 ? 'value down ' : 'value up '}
            {moneyExact(Math.abs(moved))}
          </span>
        ) : null}
        {/* The clock, in the slot the notice above keeps its clock in: whatever
            is left to do sits on the right, and an ending with nothing left to
            do shows nothing there. */}
        {standing.appealDeadline ? (
          <span
            className={
              standing.appealOpen
                ? 'tabular ml-auto font-medium text-[var(--color-warning)]'
                : 'tabular ml-auto text-[var(--color-ink-muted)] line-through'
            }
          >
            appeal by {dayShort(standing.appealDeadline)}
          </span>
        ) : null}
      </div>

      <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {standing.standing}
      </p>

      {resolution.checks.length > 0 ? (
        <ul className="space-y-1.5">
          {resolution.checks.map((check) => (
            <Check key={check.key} check={check} />
          ))}
        </ul>
      ) : null}

      {resolution.note ? (
        <p className="text-xs text-[var(--color-ink-muted)]">{resolution.note}</p>
      ) : null}

      <VoidResolution resolution={resolution} engagementId={engagementId} />
    </div>
  );
}

/** Taking back a resolution recorded in error. A correction is a new one instead. */
function VoidResolution({
  resolution,
  engagementId,
}: {
  resolution: ProtestResolution;
  engagementId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const save = useMutation({
    mutationFn: () => api.voidResolution(resolution.id, { reason: reason.trim() }),
    onSuccess: () => {
      setOpen(false);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['engagement-notices', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season', engagementId] });
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-critical)]"
      >
        Recorded in error
      </button>
    );
  }

  return (
    <div className="space-y-2 border-t border-[var(--color-hairline)] pt-2">
      <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        Voiding leaves the notice showing a protest with no ending on it, which is the true state
        while this gets recorded again. To correct the figures instead, record the ending afresh —
        that supersedes this row and keeps whatever the client was already told.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <TextInput
          className="min-w-52 flex-1"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why — e.g. recorded against the wrong notice"
        />
        <Button
          variant="secondary"
          disabled={save.isPending || reason.trim().length === 0}
          onClick={() => save.mutate()}
        >
          {save.isPending ? 'Saving…' : 'Void it'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Never mind
        </Button>
      </div>
      {save.error ? (
        <p className="text-xs leading-relaxed text-[var(--color-critical)]">
          {save.error instanceof Error ? save.error.message : String(save.error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Writing down how it ended.
 *
 * The stage is the first field and it changes the rest of the form, because
 * the four endings are genuinely different facts rather than four words for the
 * same one. A withdrawal determines nothing, so it has no value to type; an ARB
 * order determines a value and starts sixty days, so it wants the order number
 * a petition would be filed against.
 */
function Resolve({ notice, engagementId }: { notice: AssessmentNotice; engagementId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<ResolutionStage>('informal');
  const [resolvedOn, setResolvedOn] = useState(() => today());
  const [finalValue, setFinalValue] = useState('');
  const [orderReference, setOrderReference] = useState('');
  const [penaltyOutcome, setPenaltyOutcome] = useState<PenaltyOutcome | ''>('');
  const [note, setNote] = useState('');

  const determines = stage === 'informal' || stage === 'arb';

  const send = useMutation({
    mutationFn: () =>
      api.recordResolution(notice.id, {
        stage,
        resolvedOn,
        // Never sent for an ending that determined nothing, whatever is left in
        // the box from a stage the user changed their mind about.
        finalValue: determines ? amount(finalValue) : null,
        penaltyOutcome: penaltyOutcome || null,
        orderReference: stage === 'arb' ? orderReference.trim() || null : null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      setOpen(false);
      setFinalValue('');
      setOrderReference('');
      setPenaltyOutcome('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['engagement-notices', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season', engagementId] });
    },
  });

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Record how it ended
      </Button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <Field
          label="How it ended"
          help="An informal agreement with the chief appraiser is final under 1.111(e) — no hearing and nothing to appeal. A written ARB order under 41.47 starts sixty days to district court or to 41A arbitration. A withdrawal or a dismissal determines nothing and leaves the noticed value standing."
        >
          <Select
            value={stage}
            onChange={(event) => setStage(event.target.value as ResolutionStage)}
          >
            <option value="informal">Settled with the chief appraiser</option>
            <option value="arb">Determined by written ARB order</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="dismissed">Dismissed by the board</option>
          </Select>
        </Field>
        <Field
          label="Date"
          help="The day it ended: the date on the agreement, the order, the withdrawal or the dismissal — not the day of the hearing."
        >
          <TextInput
            type="date"
            value={resolvedOn}
            onChange={(event) => setResolvedOn(event.target.value)}
          />
        </Field>
        {determines ? (
          <Field
            label="Value it came to"
            help={
              notice.appraisedValue === null
                ? 'No appraised value is recorded on the notice, so the reduction cannot be measured until one is.'
                : `The notice appraised this at ${moneyExact(notice.appraisedValue)}. The difference is what gets reported.`
            }
          >
            <TextInput
              inputMode="decimal"
              className="w-32"
              value={finalValue}
              onChange={(event) => setFinalValue(event.target.value)}
              placeholder="0"
            />
          </Field>
        ) : null}
        {stage === 'arb' ? (
          <Field
            label="Order number"
            help="41.47 requires the board to determine the protest by written order. That order is what a 42.21 petition or a 41A arbitration request is filed against."
          >
            <TextInput
              className="w-44"
              value={orderReference}
              onChange={(event) => setOrderReference(event.target.value)}
              placeholder="ARB-2027-0000"
            />
          </Field>
        ) : null}
      </div>

      {/* Only where the notice said a penalty was applied. Asking about one
          nobody imposed invites an answer that contradicts the notice. */}
      {notice.renditionPenaltyApplied ? (
        <Field
          label="The rendition penalty"
          help="22.28 charges 10% of the taxes on the property, so it follows any reduction down proportionally and survives it. Getting rid of it takes a separate 22.30 waiver, and 22.30(b) gave thirty days from the notice to ask."
        >
          <Select
            value={penaltyOutcome}
            onChange={(event) => setPenaltyOutcome(event.target.value as PenaltyOutcome | '')}
          >
            <option value="">Not stated</option>
            <option value="waived">Waived</option>
            <option value="upheld">Upheld</option>
          </Select>
        </Field>
      ) : null}

      <TextArea
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What was agreed, and on what grounds"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={send.isPending || (determines && amount(finalValue) === null)}
          onClick={() => send.mutate()}
        >
          {send.isPending ? 'Saving…' : 'Record it'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Never mind
        </Button>
      </div>
      {send.error ? (
        <p className="text-xs leading-relaxed text-[var(--color-critical)]">
          {send.error instanceof Error ? send.error.message : String(send.error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Typing in what arrived.
 *
 * Only the date on the notice is required, and that is the point rather than a
 * convenience: the date is what starts every clock here, and a notice recorded
 * on the day it lands with nothing else on it is worth more than a complete one
 * recorded after the window shut. The figures can be filled in later by
 * recording a corrected notice.
 */
function RecordForm({
  engagementId,
  locationId,
  taxYear,
}: {
  engagementId: string;
  locationId: string;
  taxYear: number;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [noticedOn, setNoticedOn] = useState(() => today());
  const [deliveredOn, setDeliveredOn] = useState('');
  const [printedDeadline, setPrintedDeadline] = useState('');
  const [appraised, setAppraised] = useState('');
  const [assessed, setAssessed] = useState('');
  const [priorYear, setPriorYear] = useState('');
  const [penalty, setPenalty] = useState(false);
  const [districtName, setDistrictName] = useState('');
  const [note, setNote] = useState('');

  const send = useMutation({
    mutationFn: () =>
      api.recordNotice(engagementId, {
        locationId,
        noticedOn,
        deliveredOn: deliveredOn || null,
        printedDeadline: printedDeadline || null,
        districtName: districtName.trim() || null,
        appraisedValue: amount(appraised),
        assessedValue: amount(assessed),
        priorYearValue: amount(priorYear),
        // Sent as false rather than null once the form has been opened: "the
        // notice does not say a penalty was applied" is a real answer, and it
        // is the one that lets the checks below say the return was accepted.
        renditionPenaltyApplied: penalty,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      setOpen(false);
      // Every field, not just the note. The form stays mounted behind the
      // panel, so anything left in it is what the *next* notice gets filled
      // with — and the next notice here is by definition a corrected one for
      // the same site, where inheriting the superseded figures produces a
      // record that looks typed off the envelope and is not.
      setNoticedOn(today());
      setDeliveredOn('');
      setPrintedDeadline('');
      setAppraised('');
      setAssessed('');
      setPriorYear('');
      setPenalty(false);
      setDistrictName('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['engagement-notices', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season', engagementId] });
    },
  });

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Record a notice
      </Button>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <Field
          label="Notice date"
          help={`The date printed on it. Under 1.07 delivery is presumed on the day it went in the mail, so this is normally the day the ${taxYear} protest window opened.`}
        >
          <TextInput
            type="date"
            value={noticedOn}
            onChange={(event) => setNoticedOn(event.target.value)}
          />
        </Field>
        <Field
          label="Arrived"
          help="Only where it is known and differs from the notice date. 41.44 counts thirty days from delivery, and a notice that took a week to arrive is a week of window nobody should give away."
        >
          <TextInput
            type="date"
            value={deliveredOn}
            onChange={(event) => setDeliveredOn(event.target.value)}
          />
        </Field>
        <Field
          label="Deadline printed"
          help="Whatever protest date the notice itself prints. Where it disagrees with 41.44 — commonly a flat May 15 on a notice mailed in late April — the disagreement is worth catching, and it cannot be if only our answer is stored."
        >
          <TextInput
            type="date"
            value={printedDeadline}
            onChange={(event) => setPrintedDeadline(event.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-end gap-2.5">
        <Field label="Appraised value">
          <TextInput
            inputMode="decimal"
            className="w-32"
            value={appraised}
            onChange={(event) => setAppraised(event.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="Assessed value">
          <TextInput
            inputMode="decimal"
            className="w-32"
            value={assessed}
            onChange={(event) => setAssessed(event.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="Prior year">
          <TextInput
            inputMode="decimal"
            className="w-32"
            value={priorYear}
            onChange={(event) => setPriorYear(event.target.value)}
            placeholder="0"
          />
        </Field>
        <Field label="District as named">
          <TextInput
            className="w-56"
            value={districtName}
            onChange={(event) => setDistrictName(event.target.value)}
            placeholder="Harris Central Appraisal District"
          />
        </Field>
      </div>

      <label className="flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        <input
          type="checkbox"
          checked={penalty}
          onChange={(event) => setPenalty(event.target.checked)}
          className="mt-0.5 cursor-pointer"
        />
        <span>
          The notice says a rendition penalty was applied. Ticking this starts a second and shorter
          clock — 22.30(b) gives thirty days from this notice to ask for the 10% to be waived, with
          no May 15 under it — and checks the claim against the postmark on our own filing record.
        </span>
      </label>

      <TextArea
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="Anything else the notice says"
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={send.isPending} onClick={() => send.mutate()}>
          {send.isPending ? 'Saving…' : 'Record it'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Never mind
        </Button>
      </div>
      {send.error ? (
        <p className="text-xs leading-relaxed text-[var(--color-critical)]">
          {send.error instanceof Error ? send.error.message : String(send.error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A typed figure, or null.
 *
 * Null rather than zero for anything unparseable, because a notice that prints
 * no assessed value and one that assesses at nothing are different facts — and
 * only the second is worth comparing against a schedule.
 */
function amount(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
