'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  CorrectionMotion,
  CorrectionMotionOutcome,
  CorrectionRouteKey,
  NoticeCheck,
  OpenYear,
} from '@tangible/types';
import { api } from '@/lib/api';
import { day, moneyExact } from '@/lib/format';
import { Button, Field, Select, TextArea, TextInput } from '@/components/ui/controls';
import { Badge } from '@/components/ui/primitives';

/**
 * The motions actually brought on a year, and the way to bring another.
 *
 * The board above says what 25.25 leaves. This is the other half of it, and it
 * is not a log: a motion that was agreed to, determined, or forfeited closes
 * (c-1) for the property and year under (c-1)(3), so a year showing one open
 * route and no explanation of the missing two is a year somebody re-files on.
 * Recording the motion is what makes that bar visible at all.
 */

const CHECK_TONE = { critical: 'critical', warning: 'warning', note: 'neutral' } as const;

const ROUTE_LABEL: Record<CorrectionRouteKey, string> = {
  c: '25.25(c)',
  'c-1': '25.25(c-1)',
  d: '25.25(d)',
};

const OUTCOME_LABEL: Record<CorrectionMotionOutcome, string> = {
  agreed: 'agreed by the chief appraiser',
  determined: 'determined by the board',
  forfeited: 'forfeited under 25.26',
  withdrawn: 'withdrawn',
};

export function Motions({ year, engagementId }: { year: OpenYear; engagementId: string }) {
  const live = year.motions.filter((motion) => motion.status === 'recorded');
  return (
    <div className="space-y-2">
      {live.length > 0 ? (
        <ul className="space-y-2">
          {live.map((motion) => (
            <Filed key={motion.id} motion={motion} engagementId={engagementId} />
          ))}
        </ul>
      ) : null}
      <Bring year={year} engagementId={engagementId} />
    </div>
  );
}

/**
 * One motion on file.
 *
 * The standing sentence carries the statute and the dates; the chips above it
 * carry the two facts somebody scanning wants without reading — which route it
 * went in under, and whether anybody is still waiting on it.
 */
function Filed({ motion, engagementId }: { motion: CorrectionMotion; engagementId: string }) {
  return (
    <li className="space-y-1.5 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px]">
        <Badge tone={motion.standing.live ? 'accent' : 'neutral'}>
          {ROUTE_LABEL[motion.route]}
        </Badge>
        <span className="text-[var(--color-ink-secondary)]">
          {motion.standing.live ? 'pending' : OUTCOME_LABEL[motion.outcome as CorrectionMotionOutcome]}
        </span>
        {motion.standing.reduction !== null && motion.standing.reduction > 0 ? (
          <span className="tabular text-[var(--color-good)]">
            −{moneyExact(motion.standing.reduction)}
          </span>
        ) : null}
        {motion.standing.barsAnother ? (
          <Badge tone="warning">(c-1) spent</Badge>
        ) : null}
        <span className="ml-auto tabular text-[var(--color-ink-muted)]">
          filed {day(motion.filedOn)}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
        {motion.standing.standing}
      </p>
      {motion.groundsNote ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
          {motion.groundsNote}
        </p>
      ) : null}
      {motion.checks.length > 0 ? (
        <ul className="space-y-1">
          {motion.checks.map((check) => (
            <Check key={check.key} check={check} />
          ))}
        </ul>
      ) : null}
      <Update motion={motion} engagementId={engagementId} />
    </li>
  );
}

function Check({ check }: { check: NoticeCheck }) {
  return (
    <li className="flex gap-2 text-[11px] leading-relaxed">
      <Badge tone={CHECK_TONE[check.severity]}>{check.severity}</Badge>
      <span
        className={
          check.severity === 'note' ? 'text-[var(--color-ink-muted)]' : 'text-[var(--color-ink)]'
        }
      >
        {check.message}
      </span>
    </li>
  );
}

/**
 * Writing down a motion that has gone in.
 *
 * The route is the first field and it is offered pre-set to the cheapest one
 * still open, because that ordering is the whole advice: (c) and (c-1) cost
 * nothing and (d) carries a 10% late-correction penalty. A route that is
 * already shut is still selectable — a motion that went in late is a fact worth
 * recording, and the check on the way out says so rather than the form refusing
 * it.
 */
function Bring({ year, engagementId }: { year: OpenYear; engagementId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const first = year.outlook.routes.find((route) => route.open)?.key ?? 'c';
  const [route, setRoute] = useState<CorrectionRouteKey>(first);
  const [filedOn, setFiledOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [claimedValue, setClaimedValue] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [grounds, setGrounds] = useState('');

  const send = useMutation({
    mutationFn: () =>
      api.recordMotion(engagementId, {
        subjectTaxYear: year.taxYear,
        route,
        filedOn,
        accountId: year.accountId,
        locationId: year.locationId,
        districtName: year.districtName,
        rolledValue: year.rolledValue,
        claimedValue: amount(claimedValue),
        groundsNote: grounds.trim() || null,
        undisputedTaxPaidOn: paidOn || null,
        hearingScheduledFor: null,
        hearingNoticedOn: null,
        note: null,
      }),
    onSuccess: () => {
      setOpen(false);
      setClaimedValue('');
      setPaidOn('');
      setGrounds('');
      void queryClient.invalidateQueries({ queryKey: ['engagement-open-years', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-notices', engagementId] });
    },
  });

  if (!open) {
    return (
      <Button className="h-7 px-2.5 text-xs" onClick={() => setOpen(true)}>
        Record a 25.25 motion
      </Button>
    );
  }

  const roll = year.rolledValue;

  return (
    <div className="space-y-2.5 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <Field
          label="Route"
          help="(c) reaches five years back for property that is not there, counted twice, or not ours — and 25.25(l) says a protest never spends it. (c-1) reaches three for an error in a rendition. (d) reaches only to the delinquency date, wants the roll more than a third over, and charges a 10% late-correction penalty."
        >
          <Select
            value={route}
            onChange={(event) => setRoute(event.target.value as CorrectionRouteKey)}
          >
            {year.outlook.routes.map((one) => (
              <option key={one.key} value={one.key}>
                {one.cite}
                {one.open ? '' : ' — shut'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Filed" help="The day the motion went to the district, not the day it was drafted.">
          <TextInput
            type="date"
            value={filedOn}
            onChange={(event) => setFiledOn(event.target.value)}
          />
        </Field>
        <Field
          label="Value claimed"
          help={
            roll === null
              ? 'No value is on file for this year, so nothing can be measured against it here.'
              : `The roll says ${moneyExact(roll)}. Under (d) the claim has to come in below ${moneyExact(roll * 0.75)} for the route to be available at all; (c) and (c-1) have no threshold.`
          }
        >
          <TextInput
            inputMode="decimal"
            className="w-32"
            value={claimedValue}
            onChange={(event) => setClaimedValue(event.target.value)}
            placeholder="0"
          />
        </Field>
        <Field
          label="Undisputed taxes paid"
          help="25.26(b) makes paying the taxes on the undisputed portion before the delinquency date the condition of a final determination, and 25.26(a) says filing the motion does not move that date. Leave it empty if nobody has checked — empty reads as a question here, not as unpaid."
        >
          <TextInput
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
          />
        </Field>
      </div>

      <TextArea
        rows={2}
        value={grounds}
        onChange={(event) => setGrounds(event.target.value)}
        placeholder="What the motion says is wrong"
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
        <p className="text-[11px] leading-relaxed text-[var(--color-critical)]">
          {send.error instanceof Error ? send.error.message : String(send.error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Recording what has happened to a motion since.
 *
 * One form for the hearing date, the 25.26 payment and the ending, because on
 * this table they are one act: each writes a new row carrying the whole motion
 * and supersedes the one before. Leaving the ending unset is how a hearing date
 * gets added to a motion that is still live.
 *
 * The value box disappears for the two endings that determine nothing. A
 * forfeiture is the one worth watching: it settles no value and still spends
 * (c-1), so a number typed there would claim a result that was never reached.
 */
function Update({ motion, engagementId }: { motion: CorrectionMotion; engagementId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<CorrectionMotionOutcome | ''>('');
  const [outcomeOn, setOutcomeOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [correctedValue, setCorrectedValue] = useState('');
  const [orderReference, setOrderReference] = useState('');
  const [hearingOn, setHearingOn] = useState(motion.hearingScheduledFor ?? '');
  const [noticedOn, setNoticedOn] = useState(motion.hearingNoticedOn ?? '');
  const [paidOn, setPaidOn] = useState(motion.undisputedTaxPaidOn ?? '');

  const determines = outcome === 'agreed' || outcome === 'determined';

  const send = useMutation({
    mutationFn: () =>
      api.updateMotion(motion.id, {
        outcome: outcome || null,
        outcomeOn: outcome ? outcomeOn : null,
        correctedValue: determines ? amount(correctedValue) : null,
        orderReference: outcome === 'determined' ? orderReference.trim() || null : null,
        undisputedTaxPaidOn: paidOn || null,
        hearingScheduledFor: hearingOn || null,
        hearingNoticedOn: noticedOn || null,
        note: null,
      }),
    onSuccess: () => {
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['engagement-open-years', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-notices', engagementId] });
    },
  });

  if (!motion.standing.live) return <Void motion={motion} engagementId={engagementId} />;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="cursor-pointer text-[11px] font-medium text-[var(--color-ink-secondary)] hover:underline"
        >
          Record what has happened
        </button>
        <Void motion={motion} engagementId={engagementId} />
      </div>
    );
  }

  return (
    <div className="space-y-2.5 rounded-md border border-[var(--color-hairline)] p-3">
      <div className="flex flex-wrap items-end gap-2.5">
        <Field
          label="How it ended"
          help="An agreed correction and a board determination both close (c-1) for this year under (c-1)(3); so does a forfeiture, which determines nothing about value. A withdrawal is the one ending that is not on that list and spends nothing. Leave it blank to record only a hearing or a payment."
        >
          <Select
            value={outcome}
            onChange={(event) => setOutcome(event.target.value as CorrectionMotionOutcome | '')}
          >
            <option value="">Still pending</option>
            <option value="agreed">Agreed by the chief appraiser</option>
            <option value="determined">Determined by the board</option>
            <option value="forfeited">Forfeited under 25.26</option>
            <option value="withdrawn">Withdrawn</option>
          </Select>
        </Field>
        {outcome ? (
          <Field label="Date" help="The day it ended. 25.25(g) counts sixty days from a determination.">
            <TextInput
              type="date"
              value={outcomeOn}
              onChange={(event) => setOutcomeOn(event.target.value)}
            />
          </Field>
        ) : null}
        {determines ? (
          <Field
            label="Value it came to"
            help={
              motion.rolledValue === null
                ? 'No value was recorded on the motion, so the change cannot be measured.'
                : `The motion went in against ${moneyExact(motion.rolledValue)} on the roll.`
            }
          >
            <TextInput
              inputMode="decimal"
              className="w-32"
              value={correctedValue}
              onChange={(event) => setCorrectedValue(event.target.value)}
              placeholder="0"
            />
          </Field>
        ) : null}
        {outcome === 'determined' ? (
          <Field
            label="Order number"
            help="A 25.25(g) suit to compel the change is filed against the board's order, and the sixty days run from notice of it."
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

      <div className="flex flex-wrap items-end gap-2.5">
        <Field
          label="Hearing set for"
          help="25.25(e) entitles the filer to a hearing on request. For a motion filed September through December the board has ninety days from the request; before September the ninety days run from the day it approves the appraisal records, which is usually late July."
        >
          <TextInput
            type="date"
            value={hearingOn}
            onChange={(event) => setHearingOn(event.target.value)}
          />
        </Field>
        <Field
          label="Hearing noticed"
          help="25.25(e) requires written notice of the date, time and place not later than fifteen days before the hearing. Short notice is grounds to ask for a postponement."
        >
          <TextInput
            type="date"
            value={noticedOn}
            onChange={(event) => setNoticedOn(event.target.value)}
          />
        </Field>
        <Field
          label="Undisputed taxes paid"
          help={`25.26(b) wanted these paid by ${day(motion.standing.prepaymentDeadline)}. Without it the board can find the right to a final determination forfeited — and a forfeiture still closes (c-1).`}
        >
          <TextInput
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={send.isPending || (determines && amount(correctedValue) === null)}
          onClick={() => send.mutate()}
        >
          {send.isPending ? 'Saving…' : 'Record it'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Never mind
        </Button>
      </div>
      {send.error ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-critical)]">
          {send.error instanceof Error ? send.error.message : String(send.error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Taking back a motion recorded in error.
 *
 * Worth more here than on most tables. A motion recorded against the wrong year
 * does not just sit in a list — if it carries an ending it closes (c-1) for
 * that year, and the board above will stop offering a route the client still
 * has. Voiding is how that is given back.
 */
function Void({ motion, engagementId }: { motion: CorrectionMotion; engagementId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  const send = useMutation({
    mutationFn: () => api.voidMotion(motion.id, reason.trim()),
    onSuccess: () => {
      setOpen(false);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['engagement-open-years', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-notices', engagementId] });
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="cursor-pointer text-[11px] text-[var(--color-ink-muted)] hover:underline"
      >
        Recorded in error
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-hairline)] p-3">
      <TextArea
        rows={2}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why this motion is being taken back"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          disabled={send.isPending || reason.trim() === ''}
          onClick={() => send.mutate()}
        >
          {send.isPending ? 'Saving…' : 'Take it back'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Never mind
        </Button>
      </div>
      {send.error ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-critical)]">
          {send.error instanceof Error ? send.error.message : String(send.error)}
        </p>
      ) : null}
    </div>
  );
}

function amount(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (cleaned === '') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
