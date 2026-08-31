'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CircleDollarSign, Receipt, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import type { FeeBasis, FeeQuote, FeeStatement, FeeView } from '@tangible/types';
import { api } from '@/lib/api';
import { count, day, moneyCents, moneyExact, plural } from '@/lib/format';
import { Button, Field, Segmented, TextArea, TextInput } from '@/components/ui/controls';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';

/**
 * What the season is worth to the firm, and whether it can be billed yet.
 *
 * The card is arranged as one argument: here is what was agreed, here is what
 * it would come to today, and here is what stops it. The blockers are printed
 * rather than hidden, in the same spirit as the filing gates — a statement that
 * refuses and says why is the only kind that can be trusted when it does not
 * refuse.
 *
 * The honesty that matters is on the contingency case. `EngagementResult` says
 * of its own tax figure that it is an estimate by construction, so a fee that
 * is a share of it inherits that and says so on the statement, naming the
 * blended rate it used. Where somebody has read the actual bills, they type the
 * real saving and the statement rests on that instead. What the card never does
 * is print an estimate as though someone had checked.
 */
export function FeeCard({ engagementId }: { engagementId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement-fees', engagementId],
    queryFn: () => api.fees(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-24 w-full" />;

  return (
    <>
      <TermsCard engagementId={engagementId} view={data} />
      <QuoteCard engagementId={engagementId} view={data} />
      <StatementsCard engagementId={engagementId} view={data} />
    </>
  );
}

/* ── The agreement ─────────────────────────────────────────────────────────── */

const BASIS_LABEL: Record<FeeBasis, string> = {
  fixed: 'Fixed',
  'per-return': 'Per return',
  contingency: 'Contingency',
};

/** Dollars in the box, whole cents on the wire. */
function toCents(text: string): number | null {
  const value = Number(text.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function fromCents(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2);
}

function TermsCard({ engagementId, view }: { engagementId: string; view: FeeView }) {
  const client = useQueryClient();
  const terms = view.quote.terms;

  const [basis, setBasis] = useState<FeeBasis>(terms?.basis ?? 'fixed');
  const [fixed, setFixed] = useState(fromCents(terms?.fixedCents ?? null));
  const [perReturn, setPerReturn] = useState(fromCents(terms?.perReturnCents ?? null));
  const [rate, setRate] = useState(
    terms?.contingencyRate === null || terms?.contingencyRate === undefined
      ? ''
      : String(terms.contingencyRate * 100),
  );
  const [minimum, setMinimum] = useState(fromCents(terms?.minimumCents ?? null));
  const [agreedOn, setAgreedOn] = useState(terms?.agreedOn ?? '');
  const [notes, setNotes] = useState(terms?.notes ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.saveFeeTerms(engagementId, {
        basis,
        fixedCents: basis === 'fixed' ? toCents(fixed) : null,
        perReturnCents: basis === 'per-return' ? toCents(perReturn) : null,
        contingencyRate: basis === 'contingency' && rate.trim() !== '' ? Number(rate) / 100 : null,
        minimumCents: basis === 'contingency' ? toCents(minimum) : null,
        agreedOn: agreedOn.trim() === '' ? null : agreedOn.trim(),
        notes: notes.trim() === '' ? null : notes.trim(),
      }),
    onSuccess: (next) => client.setQueryData(['engagement-fees', engagementId], next),
  });

  return (
    <Card>
      <CardHeader
        title="Fee terms"
        icon={CircleDollarSign}
        description="What the engagement letter agreed, and the date it was agreed on."
        help="The date is not decoration. Terms with no agreed date block a statement outright — a bill issued against an arrangement nobody dated is a bill the client can decline to recognise, and this is the cheapest possible place to catch it."
        action={
          terms?.agreedOn ? (
            <Badge tone="good">agreed {day(terms.agreedOn)}</Badge>
          ) : (
            <Badge tone="warning">not agreed</Badge>
          )
        }
      />
      <div className="space-y-4 px-5 py-4">
        <Field
          label="Basis"
          help="Fixed is one amount for the season. Per return multiplies by the sites that actually filed. Contingency takes a share of what the season saved."
        >
          <Segmented
            ariaLabel="Fee basis"
            value={basis}
            onChange={setBasis}
            options={[
              { value: 'fixed', label: BASIS_LABEL.fixed },
              { value: 'per-return', label: BASIS_LABEL['per-return'] },
              { value: 'contingency', label: BASIS_LABEL.contingency },
            ]}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {basis === 'fixed' ? (
            <Field
              label="Amount"
              help="Dollars. The whole season, however many returns it turns out to be."
            >
              <TextInput
                value={fixed}
                onChange={(event) => setFixed(event.target.value)}
                inputMode="decimal"
                placeholder="7500.00"
              />
            </Field>
          ) : null}

          {basis === 'per-return' ? (
            <Field
              label="Per return"
              help="Dollars per site with a filing on record. A season with nothing filed yet is a blocker rather than a $0 bill."
            >
              <TextInput
                value={perReturn}
                onChange={(event) => setPerReturn(event.target.value)}
                inputMode="decimal"
                placeholder="1200.00"
              />
            </Field>
          ) : null}

          {basis === 'contingency' ? (
            <>
              <Field
                label="Share"
                help="Per cent of the saving. 25 is a quarter of what the season took off the bill."
              >
                <TextInput
                  value={rate}
                  onChange={(event) => setRate(event.target.value)}
                  inputMode="decimal"
                  placeholder="25"
                />
              </Field>
              <Field
                label="Minimum"
                help="A floor, where the letter set one. It appears on the statement as its own line rather than as a quietly larger share, so the client can see which one applied."
              >
                <TextInput
                  value={minimum}
                  onChange={(event) => setMinimum(event.target.value)}
                  inputMode="decimal"
                  placeholder="2500.00"
                />
              </Field>
            </>
          ) : null}

          <Field
            label="Agreed on"
            help="The date on the engagement letter. Required before anything can be issued."
          >
            <TextInput
              type="date"
              value={agreedOn}
              onChange={(event) => setAgreedOn(event.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Notes"
          help="Anything the letter says that the four fields above cannot hold. Printed nowhere — this is a workpaper note, not statement copy."
        >
          <TextArea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Cap at $15,000 for the 2027 season; renegotiate if the register exceeds 10,000 lines."
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save terms'}
          </Button>
          <span className="text-xs text-[var(--color-ink-muted)]">
            Terms can be edited until a statement rests on them. A statement stores its own copy, so
            changing these never rewrites a bill that has gone out.
          </span>
        </div>

        {save.error ? (
          <Callout tone="critical">
            {save.error instanceof Error ? save.error.message : String(save.error)}
          </Callout>
        ) : null}
      </div>
    </Card>
  );
}

/* ── What it would come to ─────────────────────────────────────────────────── */

function QuoteCard({ engagementId, view }: { engagementId: string; view: FeeView }) {
  const client = useQueryClient();
  const quote = view.quote;
  const [stated, setStated] = useState('');

  const issue = useMutation({
    mutationFn: () =>
      api.issueFeeStatement(engagementId, {
        statedSavingCents: stated.trim() === '' ? null : toCents(stated),
      }),
    onSuccess: (next) => {
      client.setQueryData(['engagement-fees', engagementId], next);
      setStated('');
    },
  });

  const blocked = quote.blockers.length > 0;

  return (
    <Card>
      <CardHeader
        title="What this season bills"
        icon={Receipt}
        description="Computed on read, never stored. The statement is the stored thing, and it keeps its own copy of all of this."
        action={
          blocked ? (
            <Badge tone="warning">
              {count(quote.blockers.length)} {plural(quote.blockers.length, 'blocker')}
            </Badge>
          ) : (
            <Badge tone="good" dot>
              Ready to issue
            </Badge>
          )
        }
      />

      {quote.terms === null ? (
        <EmptyState title="No terms yet">
          Set the basis and the agreed date above, and the arithmetic appears here — including, when
          it cannot be done, the reason.
        </EmptyState>
      ) : (
        <>
          <MeasureRow quote={quote} />

          <ul className="divide-y divide-[var(--color-hairline)]">
            {quote.lines.map((line, index) => (
              <li key={`${line.label}-${index}`} className="flex items-start gap-4 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="text-sm text-[var(--color-ink)]">{line.label}</span>
                  {line.detail ? (
                    <span className="block text-xs text-[var(--color-ink-muted)]">
                      {line.detail}
                    </span>
                  ) : null}
                </span>
                <span className="tabular shrink-0 text-sm text-[var(--color-ink)]">
                  {moneyCents(line.amountCents)}
                </span>
              </li>
            ))}
            <li className="flex items-center gap-4 px-5 py-3">
              <span className="flex-1 text-sm font-medium text-[var(--color-ink)]">Total</span>
              <span className="tabular shrink-0 text-sm font-semibold text-[var(--color-ink)]">
                {moneyCents(quote.totalCents)}
              </span>
            </li>
          </ul>

          <div className="space-y-2 px-5 pb-4">
            {quote.blockers.map((blocker) => (
              <Callout key={blocker} tone="warning" icon={ShieldAlert}>
                {blocker}
              </Callout>
            ))}

            {quote.measure.excluded.map((excluded) => (
              <Callout key={excluded.label} tone="neutral" title={excluded.label}>
                {excluded.because}
              </Callout>
            ))}

            {quote.estimated && !blocked ? (
              <Callout tone="accent" title="This total rests on an estimate">
                The saving is the appraised value taken off, dollarized at each jurisdiction's
                blended rate. It is not a figure read off a tax bill. Where the bills are in hand,
                type what the client actually saved below and the statement will say so instead.
              </Callout>
            ) : null}
          </div>
        </>
      )}

      {quote.terms === null ? null : (
        <div className="flex flex-wrap items-end gap-3 border-t border-[var(--color-hairline)] px-5 py-4">
          {quote.terms.basis === 'contingency' ? (
            <Field
              label="Measured saving"
              help="Optional, and only for a contingency fee. Dollars the client actually saved, read off the tax bills. Supplying it replaces the blended-rate estimate and marks the statement as resting on a stated figure."
              className="min-w-[16rem] flex-1"
            >
              <TextInput
                value={stated}
                onChange={(event) => setStated(event.target.value)}
                inputMode="decimal"
                placeholder="leave blank to bill the estimate"
              />
            </Field>
          ) : null}
          <div className="flex items-center gap-3 pb-0.5">
            <Button
              variant="primary"
              onClick={() => issue.mutate()}
              disabled={blocked || issue.isPending}
            >
              {issue.isPending ? 'Issuing…' : 'Issue a statement'}
            </Button>
            <span className="text-xs text-[var(--color-ink-muted)]">
              {blocked
                ? 'Blocked. Clear what is listed above first.'
                : 'Freezes the terms, the lines and the measure as they stand right now.'}
            </span>
          </div>
        </div>
      )}

      {issue.error ? (
        <div className="px-5 pb-4">
          <Callout tone="critical">
            {issue.error instanceof Error ? issue.error.message : String(issue.error)}
          </Callout>
        </div>
      ) : null}
    </Card>
  );
}

/** What the fee was applied to, said in the units the basis actually uses. */
function MeasureRow({ quote }: { quote: FeeQuote }) {
  const measure = quote.measure;
  return (
    <StatGrid columns={4}>
      <StatCell>
        <Stat label="Basis" value={BASIS_LABEL[measure.basis]} note={`${measure.taxYear} season`} />
      </StatCell>
      <StatCell>
        <Stat
          label="Returns filed"
          value={count(measure.returnsFiled)}
          note={`of ${count(measure.sites.length)} ${plural(measure.sites.length, 'site')}`}
        />
      </StatCell>
      <StatCell>
        <Stat
          label="Value taken off"
          value={moneyExact(measure.reductionTotal)}
          note="noticed minus standing, appraised value"
          help="Appraised value, not tax. It is the district's own units, summed over the sites where both the noticed and the standing figure are known."
        />
      </StatCell>
      <StatCell>
        <Stat
          label="Saving billed against"
          value={measure.savingCents === null ? '—' : moneyCents(measure.savingCents)}
          tone={measure.savingSource === 'stated' ? 'good' : 'default'}
          note={
            measure.savingSource === 'stated'
              ? 'read off the tax bills'
              : measure.savingSource === 'estimated'
                ? 'estimated at the blended rate'
                : 'nothing measured yet'
          }
        />
      </StatCell>
    </StatGrid>
  );
}

/* ── What has gone out ─────────────────────────────────────────────────────── */

function StatementsCard({ engagementId, view }: { engagementId: string; view: FeeView }) {
  if (view.statements.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Statements"
        description="Every bill that has gone out on this engagement, with what it was measured against."
        help="A statement is never edited. Marking one paid or void records what happened to it; getting a number wrong means voiding it with a reason and issuing another, which is the same discipline the filing record keeps."
        action={
          view.outstandingCents > 0 ? (
            <Badge tone="warning">{moneyCents(view.outstandingCents)} outstanding</Badge>
          ) : (
            <Badge tone="good">nothing outstanding</Badge>
          )
        }
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {view.statements.map((statement) => (
          <StatementRow key={statement.id} engagementId={engagementId} statement={statement} />
        ))}
      </ul>
    </Card>
  );
}

const STATUS_TONE = { issued: 'accent', paid: 'good', void: 'neutral' } as const;

function StatementRow({
  engagementId,
  statement,
}: {
  engagementId: string;
  statement: FeeStatement;
}) {
  const client = useQueryClient();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [paidOn, setPaidOn] = useState('');

  const settle = useMutation({
    mutationFn: (input: { action: 'paid' | 'void'; paidOn?: string; reason?: string }) =>
      api.settleFeeStatement(statement.id, input),
    // The route answers with the settled statement, not the panel — so the
    // outstanding total above it has to be refetched rather than patched.
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['engagement-fees', engagementId] });
      setVoiding(false);
      setReason('');
    },
  });

  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular text-sm font-medium text-[var(--color-ink)]">
          {statement.number}
        </span>
        <Badge tone={STATUS_TONE[statement.status]}>{statement.status}</Badge>
        <Badge tone="neutral">{BASIS_LABEL[statement.basis]}</Badge>
        {statement.measure.savingSource === 'estimated' ? (
          <Badge tone="warning">billed on an estimate</Badge>
        ) : null}
        <span className="tabular ml-auto text-sm font-semibold text-[var(--color-ink)]">
          {moneyCents(statement.totalCents)}
        </span>
      </div>

      <p className="text-xs text-[var(--color-ink-muted)]">
        Issued {day(statement.issuedAt)}
        {statement.issuedBy ? ` by ${statement.issuedBy}` : ''}
        {statement.paidOn ? ` · paid ${day(statement.paidOn)}` : ''}
        {statement.voidedAt ? ` · voided ${day(statement.voidedAt)}` : ''}
      </p>

      <ul className="space-y-0.5">
        {statement.lines.map((line, index) => (
          <li
            key={`${line.label}-${index}`}
            className="flex items-baseline gap-3 text-xs text-[var(--color-ink-secondary)]"
          >
            <span className="min-w-0 flex-1 truncate">{line.label}</span>
            <span className="tabular shrink-0">{moneyCents(line.amountCents)}</span>
          </li>
        ))}
      </ul>

      {statement.voidReason ? (
        <p className="text-xs text-[var(--color-ink-muted)]">Voided: {statement.voidReason}</p>
      ) : null}

      {statement.status === 'issued' ? (
        voiding ? (
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <Field
              label="Why is it void"
              help="Required. A voided bill with no reason beside it is indistinguishable from one that was never issued."
              className="min-w-[16rem] flex-1"
            >
              <TextInput
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Superseded — the contingency was billed on the estimate before the bills arrived."
              />
            </Field>
            <div className="flex items-center gap-2 pb-0.5">
              <Button
                variant="primary"
                onClick={() => settle.mutate({ action: 'void', reason: reason.trim() })}
                disabled={reason.trim().length === 0 || settle.isPending}
              >
                {settle.isPending ? 'Voiding…' : 'Void it'}
              </Button>
              <Button onClick={() => setVoiding(false)} disabled={settle.isPending}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3 pt-1">
            <Field label="Paid on" className="w-40">
              <TextInput
                type="date"
                value={paidOn}
                onChange={(event) => setPaidOn(event.target.value)}
              />
            </Field>
            <div className="flex items-center gap-2 pb-0.5">
              <Button
                onClick={() =>
                  settle.mutate({
                    action: 'paid',
                    paidOn: paidOn.trim() === '' ? undefined : paidOn.trim(),
                  })
                }
                disabled={settle.isPending}
              >
                Mark paid
              </Button>
              <Button onClick={() => setVoiding(true)} disabled={settle.isPending}>
                <Ban size={14} strokeWidth={2} />
                Void
              </Button>
            </div>
          </div>
        )
      ) : null}

      {settle.error ? (
        <Callout tone="critical">
          {settle.error instanceof Error ? settle.error.message : String(settle.error)}
        </Callout>
      ) : null}
    </li>
  );
}
