'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  FILING_METHODS,
  type ExtensionKind,
  type FilingMethod,
  type RenditionExtension,
} from '@tangible/types';
import { api } from '@/lib/api';
import { METHOD_LABEL } from '@/lib/filing-methods';
import { day, dayShort } from '@/lib/format';
import { Button, Field, Select, TextArea, TextInput } from '@/components/ui/controls';
import { Badge } from '@/components/ui/primitives';

/**
 * What was asked of the district for one return, and what came back.
 *
 * Tax Code 22.23(b) is two promises in two sentences and the difference between
 * them is the whole of this panel. A written request that arrives on or before
 * the April deadline is not a favour — the chief appraiser *shall* extend, so
 * the deadline moves the day the request goes out and the district's silence
 * afterwards means nothing. A further fifteen days is discretion, *may*, for
 * good cause shown, and moves nothing at all until somebody grants it.
 *
 * So the district's answer is recorded where it exists and never assumed. A
 * standard request sits here as "in force, unanswered" without apology; an
 * additional one sits here as "outstanding" and the board keeps working to the
 * May date until the answer arrives.
 */
export function ExtensionPanel({
  engagementId,
  locationId,
  label,
  statutoryDueOn,
  extendedDueOn,
  extensions,
}: {
  engagementId: string;
  locationId: string;
  label: string;
  statutoryDueOn: string;
  extendedDueOn: string;
  extensions: RenditionExtension[];
}) {
  const standing = extensions.some(
    (extension) => extension.kind === 'standard' && extension.inForce,
  );

  return (
    <div className="mt-2.5 space-y-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-plane)] p-3">
      {extensions.length > 0 ? (
        <ul className="space-y-2.5">
          {extensions.map((extension) => (
            <Recorded key={extension.id} extension={extension} engagementId={engagementId} />
          ))}
        </ul>
      ) : (
        <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          Nothing on file for {label}. A written request reaching the chief appraiser on or before{' '}
          {day(statutoryDueOn)} moves this one return to {day(extendedDueOn)} — he has no discretion
          to refuse it, which makes our copy of the request the whole of the evidence.
        </p>
      )}
      <RequestForm
        engagementId={engagementId}
        locationId={locationId}
        extendedDueOn={extendedDueOn}
        hasStandard={standing}
      />
    </div>
  );
}

const STATUS_TONE = {
  requested: 'accent',
  granted: 'good',
  denied: 'critical',
  superseded: 'neutral',
  void: 'neutral',
} as const;

/**
 * One request on file.
 *
 * The status badge is what the district said; the sentence under it is what
 * that is worth, which are not the same thing twice. "Requested" against a
 * timely standard request means the deadline has already moved; "requested"
 * against an additional one means nothing has.
 */
function Recorded({
  extension,
  engagementId,
}: {
  extension: RenditionExtension;
  engagementId: string;
}) {
  return (
    <li className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs">
        <Badge tone={STATUS_TONE[extension.status]}>{extension.status}</Badge>
        <span className="font-medium">
          {extension.kind === 'standard' ? 'To May 15' : 'A further 15 days'}
        </span>
        <span className="tabular text-[var(--color-ink-secondary)]">
          sent {dayShort(extension.requestedOn)} · {METHOD_LABEL[extension.method]}
          {extension.confirmation ? ` · ${extension.confirmation}` : ''}
        </span>
        <span
          className={
            extension.inForce
              ? 'tabular ml-auto font-medium text-[var(--color-good)]'
              : 'tabular ml-auto text-[var(--color-ink-muted)] line-through'
          }
        >
          {dayShort(extension.extendedTo)}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
        {extension.standing}
        {extension.reason ? ` Cause given: ${extension.reason}` : ''}
        {extension.answerNote ? ` The district said: ${extension.answerNote}` : ''}
      </p>
      {extension.status === 'requested' ? (
        <Answer extension={extension} engagementId={engagementId} />
      ) : null}
    </li>
  );
}

const OUTCOMES = [
  { value: 'granted', label: 'The district granted it' },
  { value: 'denied', label: 'The district refused it' },
  { value: 'void', label: 'Recorded in error' },
] as const;

type Outcome = (typeof OUTCOMES)[number]['value'];

/**
 * Writing down the answer.
 *
 * Refusal and error are kept apart deliberately, the way a void filing is kept
 * apart from a superseded one: "the chief appraiser refused this" and "we never
 * sent it" are different facts, and only the first is an argument for anything
 * later.
 */
function Answer({
  extension,
  engagementId,
}: {
  extension: RenditionExtension;
  engagementId: string;
}) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [answeredOn, setAnsweredOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  const answer = useMutation({
    mutationFn: (chosen: Outcome) =>
      api.answerExtension(extension.id, {
        outcome: chosen,
        // Voiding is our own act on our own record, so it carries no date the
        // district would recognise — the reason is the whole of it.
        answeredOn: chosen === 'void' ? null : answeredOn,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      setOutcome(null);
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['engagement-extensions', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season', engagementId] });
    },
  });

  if (outcome === null) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {OUTCOMES.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => setOutcome(entry.value)}
            className={
              entry.value === 'void'
                ? 'cursor-pointer text-[11px] text-[var(--color-ink-muted)] hover:text-[var(--color-critical)]'
                : 'cursor-pointer text-[11px] font-medium text-[var(--color-ink-secondary)] hover:underline'
            }
          >
            {entry.label}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2.5">
      {outcome === 'void' ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
          Voiding keeps the row and marks it as never having happened. Use it where the request went
          out against the wrong site or was never sent at all — not where the district said no.
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        {outcome !== 'void' ? (
          // Labelled, because a bare date box beside "The district granted it"
          // reads as the date it was granted *to* — and that date was fixed
          // when the request went out. This one is only when the answer came.
          <Field
            label="Answered"
            help="The day the district told us, not the day it takes effect. An additional extension runs to the date asked for; this is the date somebody at the district said yes."
          >
            <TextInput
              type="date"
              value={answeredOn}
              onChange={(event) => setAnsweredOn(event.target.value)}
            />
          </Field>
        ) : null}
        <TextInput
          className="min-w-52 flex-1"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={
            outcome === 'void'
              ? 'Why — e.g. sent against the wrong account'
              : 'What they said, and who said it'
          }
        />
        <Button
          variant={outcome === 'void' ? 'secondary' : 'primary'}
          disabled={answer.isPending || (outcome === 'void' && note.trim().length === 0)}
          onClick={() => answer.mutate(outcome)}
        >
          {answer.isPending ? 'Saving…' : OUTCOMES.find((e) => e.value === outcome)!.label}
        </Button>
        <Button variant="ghost" onClick={() => setOutcome(null)}>
          Never mind
        </Button>
      </div>
      {answer.error ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-critical)]">
          {answer.error instanceof Error ? answer.error.message : String(answer.error)}
        </p>
      ) : null}
    </div>
  );
}

/** Recording a request that went out. */
function RequestForm({
  engagementId,
  locationId,
  extendedDueOn,
  /** Whether a standard extension already stands for this site and year. */
  hasStandard,
}: {
  engagementId: string;
  locationId: string;
  extendedDueOn: string;
  hasStandard: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ExtensionKind>('standard');
  const [requestedOn, setRequestedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<FilingMethod>('certified-mail');
  const [confirmation, setConfirmation] = useState('');
  // The cap, not a guess: 22.23(b) allows fifteen further days and no more, so
  // the field opens on the most a district could have granted and is edited
  // down to whatever it actually did.
  const [extendedTo, setExtendedTo] = useState(() => addDays(extendedDueOn, 15));
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');

  const send = useMutation({
    mutationFn: () =>
      api.requestExtension(engagementId, {
        locationId,
        kind,
        method,
        requestedOn,
        // A standard request's date is May 15 observed and the server reads it
        // off its own calendar. Posting one from here would be this screen
        // deciding a date the statute already decided.
        extendedTo: kind === 'additional' ? extendedTo : null,
        confirmation: confirmation.trim() || null,
        reason: reason.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      setOpen(false);
      setConfirmation('');
      setReason('');
      setNote('');
      void queryClient.invalidateQueries({ queryKey: ['engagement-extensions', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season', engagementId] });
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-xs font-medium hover:underline"
      >
        Record a request
      </button>
    );
  }

  return (
    <div className="space-y-3 border-t border-[var(--color-hairline)] pt-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field
          label="What was asked"
          help={
            kind === 'standard'
              ? 'The extension of right under the first sentence of 22.23(b). Sent on or before the April deadline it needs no answer — the chief appraiser shall grant it, and this return moves to May 15 observed.'
              : 'The further fifteen days under the second sentence. Discretionary, granted only for good cause shown in writing, and worth nothing until the district says yes.'
          }
        >
          <Select value={kind} onChange={(event) => setKind(event.target.value as ExtensionKind)}>
            <option value="standard">To May 15</option>
            <option value="additional">A further 15 days</option>
          </Select>
        </Field>
        <Field
          label="Date sent"
          help="The postmark, not the day you are typing this. Under Tax Code 1.08 a properly addressed request is made on the day it left, and one day either side of the April deadline is the difference between an extension the district owes you and one it may simply refuse."
        >
          <TextInput
            type="date"
            value={requestedOn}
            onChange={(event) => setRequestedOn(event.target.value)}
          />
        </Field>
        <Field label="How it went" help="The same proof a return needs, for the same reason.">
          <Select
            value={method}
            onChange={(event) => setMethod(event.target.value as FilingMethod)}
          >
            {FILING_METHODS.map((value) => (
              <option key={value} value={value}>
                {METHOD_LABEL[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Confirmation"
          help="Certified article number or portal receipt. Optional, and the thing that settles the argument if the district later says it never arrived."
        >
          <TextInput
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            placeholder="7020 1290 0001 2345 6789"
          />
        </Field>
      </div>

      {kind === 'additional' ? (
        <div className="space-y-3">
          {!hasStandard ? (
            <p className="rounded-md border border-[var(--color-warning)] bg-[var(--color-surface)] p-2.5 text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
              No standard extension stands for this site. The further fifteen days run from May 15,
              so a record of them alone claims a date nothing supports — record the request that
              bought May 15 first, unless this really is what happened.
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              label="Granted to"
              help={`The day the district named, up to ${day(addDays(extendedDueOn, 15))} — fifteen days past the May date and the most 22.23(b) allows.`}
            >
              <TextInput
                type="date"
                value={extendedTo}
                onChange={(event) => setExtendedTo(event.target.value)}
              />
            </Field>
            <Field
              label="Good cause shown"
              help="What the written request actually said. The statute conditions the further days on cause shown in writing, so a record without it is a record of something that could not have been granted."
            >
              <TextInput
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. the fixed asset register is with the auditors until May 20"
              />
            </Field>
          </div>
        </div>
      ) : null}

      <Field label="Note" help="Anything about this request a reader in two years would want.">
        <TextArea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. sent with the request for the neighbouring account on one letter"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={send.isPending} onClick={() => send.mutate()}>
          {send.isPending ? 'Recording…' : 'Record the request'}
        </Button>
        <Button onClick={() => setOpen(false)}>Never mind</Button>
        <p className="text-[11px] text-[var(--color-ink-muted)]">
          {kind === 'standard'
            ? `Moves this return to ${day(extendedDueOn)} if it went out in time.`
            : 'Moves nothing until the district grants it.'}
        </p>
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
 * ISO date arithmetic in UTC.
 *
 * A local copy rather than the one in `@tangible/filing`: that package pulls in
 * a PDF writer, and importing it here to save six lines would ship it to the
 * browser.
 */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
