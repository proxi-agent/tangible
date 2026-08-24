'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText, ScrollText, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { NoticeRecordProposal, PriorDocument, PriorDocumentKind } from '@tangible/types';
import { PRIOR_UPLOAD_EXTENSIONS } from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, dayShort, moneyExact, plural } from '@/lib/format';
import { PriorDocumentStatusBadge } from '@/components/workspace/badges';
import { Button } from '@/components/ui/controls';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * Last year's filing, brought into the engagement.
 *
 * This card is where the product stops guessing at a baseline. Everything else
 * on the page reasons from the register — what the client owns and what it
 * ought to be worth. Only this says what the client actually told the district,
 * which is the other half of every claim the savings report makes.
 */

const KINDS: { value: PriorDocumentKind; label: string; hint: string }[] = [
  { value: 'rendition', label: 'Rendition', hint: 'Form 50-144 as filed — the schedules and what was reported on them.' },
  { value: 'notice', label: 'Notice', hint: 'The district’s notice of appraised value, with the protest deadline it prints.' },
];

export function PriorsCard({
  clientId,
  engagementId,
}: {
  clientId: string;
  engagementId: string;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PriorDocumentKind>('rendition');
  const [dragging, setDragging] = useState(false);

  const { data, error, isLoading } = useQuery({
    queryKey: ['priors', engagementId],
    queryFn: () => api.priors(engagementId),
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadPrior(engagementId, file, kind),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['priors', engagementId] });
    },
  });

  const documents = data?.items ?? [];

  return (
    <Card>
      <CardHeader
        title="Prior filings"
        description="Upload the rendition the client filed last year and the notice the district sent back."
        help="Extraction reads the schedules, checks that they add up to the totals printed on the form, and reads the filer’s own wording into our categories — nothing is trusted as a baseline until it does."
      />

      <div className="px-5 pt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-ink-muted)]">This document is a</span>
          <div className="inline-flex rounded-md border border-[var(--color-hairline)] p-0.5">
            {KINDS.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.hint}
                aria-pressed={kind === option.value}
                onClick={() => setKind(option.value)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  kind === option.value
                    ? 'bg-[color-mix(in_oklab,var(--color-series-1)_14%,transparent)] text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files[0];
            if (file) upload.mutate(file);
          }}
          className={cn(
            'flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-8 text-sm transition-colors outline-none',
            'focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
            dragging
              ? 'border-[var(--color-series-1)] bg-[color-mix(in_oklab,var(--color-series-1)_8%,transparent)]'
              : 'border-[var(--color-hairline)] hover:border-[color-mix(in_oklab,var(--color-series-1)_45%,transparent)] hover:bg-[var(--color-plane)]',
          )}
        >
          <UploadCloud size={20} strokeWidth={1.8} className="text-[var(--color-ink-muted)]" />
          {upload.isPending ? (
            <span>Reading the {kind === 'notice' ? 'notice' : 'return'} — this takes a moment on a scan…</span>
          ) : (
            <>
              <span className="font-medium">
                Drop {kind === 'notice' ? 'a notice' : 'a rendition'} here, or click to choose
              </span>
              <span className="text-xs text-[var(--color-ink-muted)]">
                {PRIOR_UPLOAD_EXTENSIONS.join(' · ')} — scans are fine, stored privately
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={PRIOR_UPLOAD_EXTENSIONS.join(',')}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate(file);
            e.target.value = '';
          }}
        />
        {upload.error ? (
          <p className="mt-2 text-xs text-[var(--color-critical)]">
            {upload.error instanceof Error ? upload.error.message : String(upload.error)}
          </p>
        ) : null}
      </div>

      {error ? (
        <div className="px-5 py-4">
          <ErrorState error={error} />
        </div>
      ) : isLoading ? (
        <div className="px-5 py-4">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : documents.length === 0 ? (
        <EmptyState title="Nothing filed on record yet">
          Without last year’s return the audit can say an asset is on the wrong schedule, but not
          that the client actually put it there.
        </EmptyState>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-hairline)]">
          {documents.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              clientId={clientId}
              engagementId={engagementId}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

function DocumentRow({
  document,
  clientId,
  engagementId,
}: {
  document: PriorDocument;
  clientId: string;
  engagementId: string;
}) {
  const Icon = document.kind === 'notice' ? ScrollText : FileText;
  const meta = [
    document.kind === 'notice' ? 'Notice' : 'Rendition',
    document.documentTaxYear ? `tax year ${document.documentTaxYear}` : null,
    document.documentAccountId ? `account ${document.documentAccountId}` : null,
    document.lineCount > 0 ? `${count(document.lineCount)} ${plural(document.lineCount, 'line')}` : null,
    `${(document.byteSize / 1024).toFixed(0)} KB`,
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <Icon size={16} strokeWidth={1.8} className="shrink-0 text-[var(--color-ink-muted)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{document.originalFilename}</p>
        <p className="text-xs text-[var(--color-ink-muted)]">{meta.join(' · ')}</p>
        {/* The one number that decides whether any of this can be leaned on. */}
        {document.footing && document.footing.statedTotal !== null ? (
          <p className="mt-0.5 text-xs text-[var(--color-ink-secondary)]">
            <span className="tabular">{moneyExact(document.footing.derivedTotal)}</span> read against{' '}
            <span className="tabular">{moneyExact(document.footing.statedTotal)}</span> printed
            {document.footing.derivedTotal !== document.footing.statedTotal ? (
              <span className="text-[var(--color-warning)]">
                {' '}
                — off by {moneyExact(Math.abs(document.footing.derivedTotal - document.footing.statedTotal))}
              </span>
            ) : null}
          </p>
        ) : null}
        {document.error ? (
          <p className="mt-0.5 text-xs text-[var(--color-critical)]">{document.error}</p>
        ) : null}
      </div>
      <PriorDocumentStatusBadge status={document.status} />
      {document.status === 'failed' ? null : (
        <Link href={`/clients/${clientId}/engagements/${engagementId}/priors/${document.id}`}>
          <Button>Review</Button>
        </Link>
      )}
      {document.kind === 'notice' && document.extracted ? (
        <NoticeProposal document={document} engagementId={engagementId} />
      ) : null}
    </li>
  );
}

/**
 * The intake's offer to record this notice.
 *
 * The extraction read the scan; the matcher put it on a site by the account
 * number the district printed. This is the confirm gate: everything shown here
 * is advice until the button is pressed, and the button goes through the same
 * recordNotice path a notice typed from the envelope takes — same validation,
 * same one-active-row rule, same clocks. Where the match or the date is
 * missing, the checks say what is missing and the button never appears; the
 * site's own notice panel remains the way to record it by hand.
 */
function NoticeProposal({
  document,
  engagementId,
}: {
  document: PriorDocument;
  engagementId: string;
}) {
  const queryClient = useQueryClient();
  const { data: proposal, error } = useQuery({
    queryKey: ['notice-proposal', document.id],
    queryFn: () => api.noticeProposal(document.id),
  });

  const record = useMutation({
    mutationFn: (p: NoticeRecordProposal) =>
      api.recordNotice(engagementId, {
        locationId: p.match!.locationId,
        noticedOn: p.draft.noticedOn!,
        deliveredOn: null,
        printedDeadline: p.draft.printedDeadline,
        districtName: p.draft.districtName,
        appraisedValue: p.draft.appraisedValue,
        assessedValue: p.draft.assessedValue,
        priorYearValue: p.draft.priorYearValue,
        renditionPenaltyApplied: p.draft.renditionPenaltyApplied,
        note: `Recorded from ${document.originalFilename}.`,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement-notices', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['notice-proposal', document.id] });
    },
  });

  if (error || !proposal) return null;

  const failed = proposal.checks.filter((c) => !c.ok);
  const yearOk = proposal.checks.every((c) => c.check !== 'tax-year' || c.ok);
  const recordable =
    proposal.match !== null && proposal.draft.noticedOn !== null && yearOk && !proposal.alreadyRecorded;

  return (
    <div className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-plane)] px-3 py-2.5">
      {proposal.match ? (
        <p className="text-xs">
          <span className="font-medium">{proposal.match.label}</span>
          <span className="text-[var(--color-ink-secondary)]">
            {proposal.match.basis === 'account'
              ? ` — matched on account ${proposal.match.accountId}`
              : ' — the only site owing a return'}
            {proposal.draft.noticedOn ? `, noticed ${dayShort(proposal.draft.noticedOn)}` : ''}
            {proposal.draft.appraisedValue !== null
              ? `, appraised at ${moneyExact(proposal.draft.appraisedValue)}`
              : ''}
          </span>
        </p>
      ) : (
        <p className="text-xs text-[var(--color-ink-secondary)]">
          No site matched — record it from the site's own panel below.
        </p>
      )}
      {failed.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {failed.map((check) => (
            <li key={check.check} className="text-xs text-[var(--color-warning)]">
              {check.detail}
            </li>
          ))}
        </ul>
      ) : null}
      {record.error ? (
        <p className="mt-1 text-xs text-[var(--color-critical)]">{(record.error as Error).message}</p>
      ) : null}
      <div className="mt-1.5 flex items-center gap-2">
        {record.isSuccess || proposal.alreadyRecorded ? (
          <p className="flex items-center gap-1 text-xs text-[var(--color-good)]">
            <Check size={13} strokeWidth={2.2} />
            {record.isSuccess
              ? 'Recorded — the clocks are running on the sites board.'
              : 'A notice is already on record for this site and year.'}
          </p>
        ) : recordable ? (
          <Button onClick={() => record.mutate(proposal)} disabled={record.isPending}>
            {record.isPending ? 'Recording…' : `Record against ${proposal.match!.label}`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
