'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Lock, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { FilingMethod, Rendition, RenditionFiling } from '@tangible/types';
import { api } from '@/lib/api';
import { METHOD_LABEL } from '@/lib/filing-methods';
import { count, money, plural } from '@/lib/format';
import { Button, Field, Select, TextArea, TextInput } from '@/components/ui/controls';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * Recording that a return actually went out, and showing what was frozen.
 *
 * Everything else on this screen is derived from the register as it stands
 * right now, which is what a working draft should be. The moment somebody signs
 * one, that stops being enough: the register keeps moving and the form on
 * screen quietly stops matching the form that was filed. This card is where the
 * two part company — one act, one row, and from then on the filed numbers come
 * from the record rather than from the register.
 */

const METHODS: { value: FilingMethod; help: string }[] = [
  {
    value: 'certified-mail',
    help: 'The article number is the proof. Under Tax Code 1.08 a properly addressed, postmarked return is timely on the postmark date — so the receipt, not the delivery, is what settles a late-filing penalty argument.',
  },
  {
    value: 'mail',
    help: 'Timely on the postmark under 1.08, but with nothing in hand to prove the postmark. Fine for a return going out in February; thin for one going out on April 15.',
  },
  { value: 'efile', help: 'Through the district’s portal. Keep the confirmation.' },
  { value: 'email', help: 'Where the district accepts it. The sent message is the record.' },
  {
    value: 'hand-delivered',
    help: 'A date-stamped copy is the only evidence this leaves. Ask for one at the counter.',
  },
];

export function FilingRecordCard({
  engagementId,
  rendition,
  locationId,
  basis,
  filedByAgent,
  /** True when the engagement owes more than one return and none is picked. */
  unchosen,
}: {
  engagementId: string;
  rendition: Rendition;
  locationId: string | null;
  basis: Rendition['basis'];
  filedByAgent: boolean;
  unchosen: boolean;
}) {
  // An amendment is a second recording over a standing one, so the form has to
  // be reachable while a record already exists — but not by default, or the
  // ordinary case (one return, filed, done) would present a filing form nobody
  // asked for.
  const [amending, setAmending] = useState(false);
  const filings = useQuery({
    queryKey: ['engagement-filings', engagementId],
    queryFn: () => api.filings(engagementId),
  });

  if (filings.error) return <ErrorState error={filings.error} />;
  if (!filings.data) return <Skeleton className="h-40 w-full" />;

  // The filings on this screen's return. Where no site is picked and only one
  // is owed, the server resolved it — so an empty `locationId` still has an
  // answer, and it is the only site there is.
  const mine = filings.data.filter(
    (filing) => locationId === null || filing.locationId === locationId,
  );
  const standing = mine.find((filing) => filing.status === 'filed') ?? null;
  const history = mine.filter((filing) => filing !== standing);

  return (
    <Card>
      <CardHeader
        title={standing ? 'Filed' : 'Not yet filed'}
        description={
          standing
            ? 'The record below is frozen: the rendition as it stood the day it went out, not as the register reads now. Everything above this card keeps moving; this does not.'
            : 'A rendition on screen is a draft until somebody records that it went out. Recording it freezes what was on it — which is what a 22.28 penalty is measured against, and what next season compares to.'
        }
        action={standing ? <Badge tone="good">{standing.filedOn}</Badge> : null}
      />

      {standing ? (
        <Standing
          filing={standing}
          engagementId={engagementId}
          amending={amending}
          onAmend={() => setAmending((open) => !open)}
        />
      ) : null}

      {!standing || amending ? (
        <RecordForm
          engagementId={engagementId}
          rendition={rendition}
          locationId={locationId}
          basis={basis}
          filedByAgent={filedByAgent}
          unchosen={unchosen}
          superseding={amending ? standing : null}
          onRecorded={() => setAmending(false)}
        />
      ) : null}

      {history.length > 0 ? <History filings={history} /> : null}
    </Card>
  );
}

function Standing({
  filing,
  engagementId,
  amending,
  onAmend,
}: {
  filing: RenditionFiling;
  engagementId: string;
  amending: boolean;
  onAmend: () => void;
}) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [voiding, setVoiding] = useState(false);

  const undo = useMutation({
    mutationFn: () => api.voidFiling(filing.id, reason),
    onSuccess: () => {
      setVoiding(false);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['engagement-filings', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-season', engagementId] });
    },
  });

  return (
    <div className="space-y-3 px-5 py-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Fact label="Site">{filing.locationLabel}</Fact>
        <Fact label="Account">{filing.accountId ?? 'none'}</Fact>
        <Fact label="Sent">
          {METHOD_LABEL[filing.method]} · {filing.filedOn}
        </Fact>
        <Fact label="Confirmation">{filing.confirmation ?? '—'}</Fact>
        <Fact label="Historical cost filed">{money(filing.totalHistoricalCost)}</Fact>
        <Fact label="Good faith estimate">
          {filing.totalGoodFaithEstimate === null ? '—' : money(filing.totalGoodFaithEstimate)}
        </Fact>
        <Fact label="Assets on the return">
          {count(filing.assetCount)} {plural(filing.assetCount, 'asset')}
        </Fact>
        <Fact label="Signed as">{filing.filedByAgent ? 'agent' : 'the owner'}</Fact>
      </div>

      {filing.note ? (
        <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">{filing.note}</p>
      ) : null}

      <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-ink-muted)]">
        <Lock size={11} strokeWidth={2} />
        Filed on Form {filing.formRevision}, checksum {filing.formSha256.slice(0, 12)}
        {filing.recordedBy ? ` · recorded by ${filing.recordedBy}` : ''}
      </p>

      <div className="flex flex-wrap items-center gap-4">
        {/* One link, not two. The download lives on the page this opens, which
            is the only place that knows whether the pinned revision can carry
            this year — a card offering it blind offers a link that fails. */}
        <Link
          href={`/filings/${filing.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium hover:underline"
        >
          <FileText size={13} strokeWidth={2} />
          The form as filed
        </Link>
        {!voiding ? (
          <button
            type="button"
            onClick={onAmend}
            className="ml-auto cursor-pointer text-xs font-medium text-[var(--color-ink-secondary)] hover:underline"
          >
            {amending ? 'Never mind' : 'Record an amendment'}
          </button>
        ) : null}
        {!voiding ? (
          <button
            type="button"
            onClick={() => setVoiding(true)}
            className="cursor-pointer text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-critical)]"
          >
            Recorded in error?
          </button>
        ) : null}
      </div>

      {voiding ? (
        <div className="space-y-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-plane)] p-3">
          <p className="text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            Voiding keeps the row and marks it as never having happened. It does not un-supersede
            whatever this replaced — that return really was superseded at the time.
          </p>
          <TextInput
            className="w-full"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why — e.g. recorded against the wrong site"
          />
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              disabled={reason.trim().length === 0 || undo.isPending}
              onClick={() => undo.mutate()}
            >
              {undo.isPending ? 'Voiding…' : 'Void this record'}
            </Button>
            <Button onClick={() => setVoiding(false)}>Keep it</Button>
          </div>
          {undo.error ? (
            <p className="text-xs text-[var(--color-critical)]">{String(undo.error)}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RecordForm({
  engagementId,
  rendition,
  locationId,
  basis,
  filedByAgent,
  unchosen,
  /** The standing record this one would replace, where it is an amendment. */
  superseding,
  onRecorded,
}: {
  engagementId: string;
  rendition: Rendition;
  locationId: string | null;
  basis: Rendition['basis'];
  filedByAgent: boolean;
  unchosen: boolean;
  superseding: RenditionFiling | null;
  onRecorded: () => void;
}) {
  const queryClient = useQueryClient();
  const [method, setMethod] = useState<FilingMethod>('certified-mail');
  const [filedOn, setFiledOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [confirmation, setConfirmation] = useState('');
  const [note, setNote] = useState('');

  const record = useMutation({
    mutationFn: () =>
      api.recordFiling(engagementId, {
        // The server would reject a missing site anyway; the button is disabled
        // before it comes to that, so this is only ever the resolved one.
        locationId: locationId ?? '',
        basis,
        filedByAgent,
        method,
        filedOn,
        confirmation: confirmation.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      onRecorded();
      void queryClient.invalidateQueries({ queryKey: ['engagement-filings', engagementId] });
      // The engagement's board counts this return as gone out, and its deadline
      // pressure is measured against the ones that have not.
      void queryClient.invalidateQueries({ queryKey: ['engagement-season', engagementId] });
    },
  });

  const blocking = rendition.blockers.filter((blocker) => blocker.severity === 'blocking');

  if (blocking.length > 0) {
    return (
      <div className="flex items-start gap-3 px-5 py-4">
        <ShieldAlert
          size={15}
          strokeWidth={2}
          className="mt-0.5 shrink-0 text-[var(--color-critical)]"
        />
        <p className="text-sm leading-relaxed text-[var(--color-ink-secondary)]">
          {count(blocking.length)} {plural(blocking.length, 'thing')} above still{' '}
          {plural(blocking.length, 'blocks', 'block')} this return. A record saying we filed a
          document the app knows to be wrong is worse than no record — it puts the defect into the
          history as a completed filing. Clear them, then come back.
        </p>
      </div>
    );
  }

  // No site picked on a multi-site engagement. The draft above is the whole
  // register, which is not a return anybody can file — so there is nothing here
  // to record yet.
  if (unchosen || !locationId) {
    return (
      <p className="px-5 py-4 text-sm text-[var(--color-ink-secondary)]">
        Pick which site’s return went out before recording it. Each one is its own form and its own
        account.
      </p>
    );
  }

  return (
    <div
      className={
        superseding
          ? 'space-y-3 border-t border-[var(--color-hairline)] px-5 py-4'
          : 'space-y-3 px-5 py-4'
      }
    >
      {superseding ? (
        <p className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-plane)] p-3 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          This records a second return for {superseding.locationLabel}, tax year {superseding.taxYear}
          . The {superseding.filedOn} record stays on file and is marked superseded — the district
          worked from it until this one lands, and a history that pretends otherwise is no use in a
          penalty argument. The numbers below are the register as it reads now, not as it read then.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field
          label="How it went"
          help={METHODS.find((entry) => entry.value === method)?.help}
        >
          <Select value={method} onChange={(e) => setMethod(e.target.value as FilingMethod)}>
            {METHODS.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {METHOD_LABEL[entry.value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Date sent"
          help="The postmark or submission date, not the day you are typing this. Timeliness under Tax Code 1.08 is decided by the day it left, so backdating a record to match a receipt is right and guessing at one is not."
        >
          <TextInput type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
        </Field>
        <Field
          label="Confirmation"
          help="Certified article number, portal confirmation, or whatever the district handed back. Optional, and the one field that decides a penalty argument two years from now."
        >
          <TextInput
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            placeholder="7020 1290 0001 2345 6789"
          />
        </Field>
      </div>

      <Field label="Note" help="Anything about this filing a reader in two years would want.">
        <TextArea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. filed with the extension request under 22.23(b)"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" disabled={record.isPending} onClick={() => record.mutate()}>
          {record.isPending
            ? 'Recording…'
            : superseding
              ? 'Record the amendment'
              : 'Record this as filed'}
        </Button>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Freezes {money(rendition.totalHistoricalCost)} across{' '}
          {count(rendition.schedules.reduce((n, s) => n + s.lines.length, 0))} lines on{' '}
          {basis === 'cost' ? 'cost and year' : 'a good faith estimate'}.
        </p>
      </div>

      {record.error ? (
        <p className="text-xs leading-relaxed text-[var(--color-critical)]">
          {record.error instanceof Error ? record.error.message : String(record.error)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Superseded and voided rows.
 *
 * Kept on screen rather than hidden behind a toggle. An amended return is a
 * fact about the engagement, and the version it replaced is what the district
 * has been working from until the amendment lands.
 */
function History({ filings }: { filings: RenditionFiling[] }) {
  return (
    <div className="border-t border-[var(--color-hairline)]">
      <ul className="divide-y divide-[var(--color-hairline)]">
        {filings.map((filing) => (
          <li key={filing.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5 text-xs">
            <Badge tone={filing.status === 'void' ? 'critical' : 'neutral'}>{filing.status}</Badge>
            <span className="tabular">{filing.filedOn}</span>
            <span className="text-[var(--color-ink-secondary)]">
              {filing.locationLabel} · {METHOD_LABEL[filing.method]} ·{' '}
              {money(filing.totalHistoricalCost)}
            </span>
            {filing.voidReason ? (
              <span className="text-[var(--color-ink-muted)]">{filing.voidReason}</span>
            ) : null}
            <Link href={`/filings/${filing.id}`} className="ml-auto font-medium hover:underline">
              View
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
        {label}
      </p>
      <p className="tabular mt-0.5 text-sm">{children}</p>
    </div>
  );
}
