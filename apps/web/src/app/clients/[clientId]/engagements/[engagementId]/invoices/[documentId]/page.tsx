'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Link2, RefreshCw, Search } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type {
  AssessabilityTreatment,
  InvoiceAssetLink,
  InvoiceDetail,
  InvoiceLineRecord,
} from '@tangible/types';
import { api } from '@/lib/api';
import { count, moneyExact, percent, plural } from '@/lib/format';
import { InvoiceStatusBadge } from '@/components/workspace/badges';
import { Button, Segmented, TextInput } from '@/components/ui/controls';
import {
  BackLink,
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
  type BadgeTone,
} from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';

/**
 * One invoice, read and ruled on.
 *
 * The page is ordered by what has to be true before the next thing matters.
 * First, did we read the document — the stated total against the lines we
 * summed, which is the only internal check an invoice has, because vendors lay
 * them out however they like and the same $12,400 can be a line, a subtotal or
 * a page header. Then, what each line is for tax, which is a separate decision
 * made by a rule a person can read and overrule. Then, last, which register
 * lines this invoice paid for — the gate everything downstream depends on,
 * because a misattributed invoice moves money from one asset to another and
 * produces a finding that looks exactly like a correct one.
 *
 * Nothing on this page computes a saving. The split is the input; the finding
 * is built from it by the engine, once a person has linked the document to a
 * register row and said they read it.
 */

const TREATMENTS: { value: AssessabilityTreatment; label: string; title: string }[] = [
  {
    value: 'assessable',
    label: 'Assessable',
    title: 'Tangible personal property at this address on January 1.',
  },
  {
    value: 'non-assessable',
    label: 'Not assessable',
    title: 'Freight, labour, tax, service, software — inside the capitalized amount, not taxable.',
  },
  {
    value: 'unclear',
    label: 'Unclear',
    title: 'A question for the controller. Stays in the invoice and out of the split.',
  },
];

const TREATMENT_TONES: Record<AssessabilityTreatment, BadgeTone> = {
  assessable: 'neutral',
  'non-assessable': 'good',
  unclear: 'warning',
};

export default function InvoicePage() {
  const { clientId, engagementId, documentId } = useParams<{
    clientId: string;
    engagementId: string;
    documentId: string;
  }>();
  const queryClient = useQueryClient();

  const { data, error, isLoading } = useQuery({
    queryKey: ['invoice', engagementId, documentId],
    queryFn: () => api.invoice(engagementId, documentId),
  });

  /**
   * Every write on this page answers with the whole document, and every one of
   * them lands here. One line's treatment changes the split, the document's own
   * confidence and whether it is still trusted — a screen that redrew only the
   * row it edited would print a total that no longer follows from the lines
   * above it.
   */
  const settle = (detail: InvoiceDetail) => {
    queryClient.setQueryData(['invoice', engagementId, documentId], detail);
    void queryClient.invalidateQueries({ queryKey: ['invoices', engagementId] });
  };

  const act = useMutation({
    mutationFn: (action: 'accept' | 'reread') =>
      api.invoiceAction(engagementId, documentId, action),
    onSuccess: settle,
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-5">
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-96 max-w-full" />
          <Skeleton className="h-3.5 w-56" />
        </div>
        {[0, 1].map((card) => (
          <Card key={card}>
            <div className="space-y-2 p-5">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-3.5 w-full max-w-lg" />
            </div>
            <div className="px-5 pb-5">
              <Skeleton className="h-16 w-full" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  const { document } = data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={
          <BackLink href={`/clients/${clientId}/engagements/${engagementId}?tab=invoices`}>
            Invoices
          </BackLink>
        }
        title={
          <span className="block truncate">{document.vendorName ?? document.originalFilename}</span>
        }
        meta={<InvoiceStatusBadge status={document.status} />}
        description={[
          document.invoiceNumber ? `Invoice ${document.invoiceNumber}` : document.originalFilename,
          document.invoiceDate,
          document.purchaseOrder ? `PO ${document.purchaseOrder}` : null,
          document.extractionModel ? `read by ${document.extractionModel}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => act.mutate('reread')} disabled={act.isPending}>
              <RefreshCw size={14} strokeWidth={1.9} />
              {act.isPending ? 'Working…' : 'Read it again'}
            </Button>
            {document.status === 'accepted' ? null : (
              <Button
                variant="primary"
                onClick={() => act.mutate('accept')}
                disabled={act.isPending}
              >
                <Check size={14} strokeWidth={2.2} />I have read this invoice
              </Button>
            )}
          </div>
        }
      />

      {act.error ? (
        <Callout tone="critical" title="That did not go through">
          {(act.error as Error).message}
        </Callout>
      ) : null}

      <Reading detail={data} />
      <Lines detail={data} engagementId={engagementId} documentId={documentId} onSettled={settle} />
      <Links
        detail={data}
        clientId={clientId}
        engagementId={engagementId}
        documentId={documentId}
        onSettled={settle}
      />
    </div>
  );
}

/**
 * Did we read it.
 *
 * The stated total is what the page prints; the derived total is the lines we
 * read, added up. They are kept apart on purpose — summing the lines and
 * calling that the total makes the document foot by construction and proves
 * nothing. Here that discipline is doing more work than it does on a
 * rendition, because an invoice has no other internal check at all.
 */
function Reading({ detail }: { detail: InvoiceDetail }) {
  const { document } = detail;
  const gap =
    document.statedTotal !== null && document.derivedTotal !== null
      ? document.derivedTotal - document.statedTotal
      : null;
  const reviewed = document.status === 'accepted';

  return (
    <Card>
      <CardHeader
        title="What the document says"
        description="The lines we read, checked against the total the vendor printed."
        help="Confidence here is about the reading, not about the tax treatment — whether the description and the amount on each row are what the page says. It is the only handle on quality an invoice offers, and it is what routes a document to review rather than into a client's number."
      />
      <StatGrid columns={4} className="mt-4">
        <StatCell>
          <Stat
            label="Printed on the invoice"
            value={document.statedTotal === null ? '—' : moneyExact(document.statedTotal)}
            note={document.statedTotal === null ? 'no total was printed, or none was read' : null}
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Lines we read"
            value={document.derivedTotal === null ? '—' : moneyExact(document.derivedTotal)}
            note={
              gap === null
                ? `${count(detail.lines.length)} ${plural(detail.lines.length, 'line')}`
                : Math.abs(gap) <= 1
                  ? 'agrees with the printed total'
                  : `off by ${moneyExact(Math.abs(gap))}`
            }
            tone={gap !== null && Math.abs(gap) > 1 ? 'warning' : 'default'}
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Not assessable"
            value={moneyExact(detail.nonAssessableCost)}
            tone={detail.nonAssessableCost > 0 ? 'good' : 'default'}
            note="comes out of the capitalized amount"
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Weakest field"
            value={
              document.extractionConfidence === null
                ? '—'
                : percent(document.extractionConfidence, 0)
            }
            tone={
              document.extractionConfidence !== null && document.extractionConfidence < 0.7
                ? 'warning'
                : 'default'
            }
            note={reviewed ? 'reviewed by a person' : 'nobody has said they read this yet'}
          />
        </StatCell>
      </StatGrid>

      {/*
        Named gaps are cheap and filled ones are not. What the model could not
        read is printed rather than quietly dropped, because it is the list of
        things somebody should look at the page for.
      */}
      {document.unreadable.length > 0 ? (
        <div className="px-5 pt-4">
          <Callout tone="warning" title="What could not be read">
            <ul className="mt-1 space-y-0.5">
              {document.unreadable.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}

      {document.error ? (
        <div className="px-5 pt-4">
          <Callout tone="critical" title="This document could not be read">
            {document.error}
          </Callout>
        </div>
      ) : null}

      {detail.unclearCost > 0 ? (
        <div className="px-5 py-4">
          <Callout tone="warning" title={`${moneyExact(detail.unclearCost)} is still unclear`}>
            Unclear cost stays on the assessable side of the split. Not because it is assessable,
            but because the alternative is claiming a saving for a line nobody has read. Ruling
            those lines below is what moves the number.
          </Callout>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * What each line is, for tax.
 *
 * Transcription and treatment are two different claims, and they are shown as
 * two different columns for that reason. The vendor's wording is verbatim and
 * never normalized; the treatment beside it comes from a jurisdiction rule with
 * a reason and, where there is one, the authority it rests on. A preparer who
 * disagrees overrules the rule, and the row says so from then on — a human
 * treatment is never quietly overwritten by a re-read.
 */
function Lines({
  detail,
  engagementId,
  documentId,
  onSettled,
}: {
  detail: InvoiceDetail;
  engagementId: string;
  documentId: string;
  onSettled: (detail: InvoiceDetail) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  // Unclear first, then the biggest. Both are the same instruction: this is the
  // order in which reading one more line changes the answer.
  const ordered = [...detail.lines].sort((a, b) => {
    const rank = (line: InvoiceLineRecord) => (line.treatment === 'unclear' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return (b.amount ?? 0) - (a.amount ?? 0);
  });

  if (detail.lines.length === 0) {
    return (
      <Card>
        <CardHeader title="Lines" description="What the vendor billed, line by line." />
        <EmptyState title="No lines were read from this document">
          Read it again once a model key is configured, or upload a clearer scan — a page we cannot
          read is worth nothing to the split.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Lines"
        description="The vendor's own wording, and what the rules make of it."
        help="Treatment is decided by jurisdiction rules, not by the model that read the page. A line the rules do not recognize is left unclear rather than guessed — a $46,000 line reading “PROJECT SERVICES” may be entirely labour or entirely machine, and defaulting it either way is a guess with money on it."
      />
      <ul className="mt-2 divide-y divide-[var(--color-hairline)]">
        {ordered.map((line) => (
          <LineRow
            key={line.id}
            line={line}
            engagementId={engagementId}
            documentId={documentId}
            open={editing === line.id}
            onToggle={() => setEditing((was) => (was === line.id ? null : line.id))}
            onSettled={onSettled}
          />
        ))}
      </ul>
    </Card>
  );
}

function LineRow({
  line,
  engagementId,
  documentId,
  open,
  onToggle,
  onSettled,
}: {
  line: InvoiceLineRecord;
  engagementId: string;
  documentId: string;
  open: boolean;
  onToggle: () => void;
  onSettled: (detail: InvoiceDetail) => void;
}) {
  const [treatment, setTreatment] = useState<AssessabilityTreatment>(line.treatment);
  const [reason, setReason] = useState('');

  const correct = useMutation({
    mutationFn: () =>
      api.correctInvoiceLine(engagementId, documentId, {
        lineId: line.id,
        treatment,
        reason: reason.trim() === '' ? null : reason.trim(),
      }),
    onSuccess: (detail) => {
      onSettled(detail);
      setReason('');
      onToggle();
    },
  });

  return (
    <li className="px-5 py-3">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="tabular w-6 shrink-0 text-xs text-[var(--color-ink-muted)]">
          {line.lineNumber}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm">{line.description}</p>
          <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
            {[
              line.partNumber ? `part ${line.partNumber}` : null,
              line.quantity !== null ? `qty ${line.quantity}` : null,
              line.unitPrice !== null ? `at ${moneyExact(line.unitPrice)}` : null,
              line.sourcePage !== null ? `page ${line.sourcePage}` : null,
              `read ${percent(line.readConfidence, 0)}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {line.treatmentReason ? (
            <p className="mt-1 text-xs text-[var(--color-ink-secondary)]">
              {line.treatmentReason}
              {line.treatmentAuthority ? (
                <span className="text-[var(--color-ink-muted)]"> — {line.treatmentAuthority}</span>
              ) : null}
            </p>
          ) : null}
        </div>
        <span className="tabular shrink-0 text-sm font-medium">
          {line.amount === null ? '—' : moneyExact(line.amount)}
        </span>
        <Badge tone={TREATMENT_TONES[line.treatment]}>
          {TREATMENTS.find((t) => t.value === line.treatment)?.label ?? line.treatment}
        </Badge>
        {/*
          Who decided, not how sure they were. A rule's confidence is worth
          printing; a person's is not a number, and saying "you" is the whole
          of what a later reader needs to know about that row.
        */}
        <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
          {line.isCorrected || line.treatmentSource === 'human'
            ? 'set by hand'
            : `rule · ${percent(line.treatmentConfidence, 0)}`}
        </span>
        <Button size="sm" variant="ghost" onClick={onToggle}>
          {open ? 'Cancel' : 'Change'}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-plane)] p-3">
          <Segmented
            ariaLabel="Treatment for this line"
            size="sm"
            value={treatment}
            onChange={setTreatment}
            options={TREATMENTS.map(({ value, label, title }) => ({ value, label, title }))}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TextInput
              compact
              className="min-w-64 flex-1"
              placeholder="Why — in a sentence you would repeat to the district"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <Button
              variant="primary"
              size="sm"
              disabled={correct.isPending}
              onClick={() => correct.mutate()}
            >
              {correct.isPending ? 'Saving…' : 'Set treatment'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            Your reason replaces the rule's, and this line stops being re-decided when the document
            is read again.
          </p>
          {correct.error ? (
            <p className="mt-1 text-xs text-[var(--color-critical)]">
              {(correct.error as Error).message}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Which register lines this invoice paid for.
 *
 * The gate. A suggestion is the matcher's opinion — vendor name, amount, a part
 * number that appears in a description — and it reaches nothing until somebody
 * agrees with it. That is what lets the matcher be generous: the cost of a
 * wrong suggestion is one click, and the cost of a wrong confirmation is a
 * finding that cannot be told from a real one.
 */
function Links({
  detail,
  clientId,
  engagementId,
  documentId,
  onSettled,
}: {
  detail: InvoiceDetail;
  clientId: string;
  engagementId: string;
  documentId: string;
  onSettled: (detail: InvoiceDetail) => void;
}) {
  const [search, setSearch] = useState('');

  const found = useQuery({
    queryKey: ['invoice-link-search', engagementId, search],
    queryFn: () => api.engagementAssets(engagementId, { search, limit: 8 }),
    enabled: search.trim().length >= 2,
  });

  const link = useMutation({
    mutationFn: (input: { assetId: string; status?: 'suggested' | 'confirmed' }) =>
      api.linkInvoice(engagementId, documentId, {
        assetId: input.assetId,
        status: input.status ?? 'confirmed',
      }),
    onSuccess: (next) => {
      onSettled(next);
      setSearch('');
    },
  });

  const unlink = useMutation({
    mutationFn: (assetId: string) => api.unlinkInvoice(engagementId, documentId, assetId),
    onSuccess: onSettled,
  });

  const confirmed = detail.links.filter((l) => l.status === 'confirmed');
  const apportioned = confirmed.length > 1;

  return (
    <Card>
      <CardHeader
        icon={Link2}
        title="What this invoice paid for"
        description="Only a confirmed link reaches the report."
        help="Where one invoice covers one capitalized line, the split is a measurement. Where it covers several, the non-assessable content is apportioned by share rather than traced — the document does not say which of three machines the concrete pad was for — and every finding built on it says so."
      />

      {detail.links.length === 0 ? (
        <EmptyState title="Not linked to the register yet" icon={Link2}>
          Until this invoice is against a register line, nothing in it can be taken off a value.
        </EmptyState>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--color-hairline)]">
          {detail.links.map((row) => (
            <LinkRow
              key={row.assetId}
              row={row}
              clientId={clientId}
              engagementId={engagementId}
              onConfirm={() => link.mutate({ assetId: row.assetId, status: 'confirmed' })}
              onRemove={() => unlink.mutate(row.assetId)}
              busy={link.isPending || unlink.isPending}
            />
          ))}
        </ul>
      )}

      {apportioned ? (
        <div className="px-5 pt-4">
          <Callout tone="neutral" title="This invoice is spread across several lines">
            {count(confirmed.length)} register lines share it, so what comes off each one is an
            allocation rather than something the document shows. The report says so wherever this
            invoice is cited.
          </Callout>
        </div>
      ) : null}

      <div className="px-5 py-4">
        <div className="flex items-center gap-2">
          <Search size={14} strokeWidth={1.9} className="text-[var(--color-ink-muted)]" />
          <TextInput
            compact
            className="max-w-md flex-1"
            placeholder="Find the register line this invoice paid for"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {found.data && search.trim().length >= 2 ? (
          <ul className="mt-2 divide-y divide-[var(--color-hairline)]">
            {found.data.items.length === 0 ? (
              <li className="py-2 text-xs text-[var(--color-ink-muted)]">
                Nothing on the register matches that.
              </li>
            ) : (
              found.data.items.map((asset) => (
                <li key={asset.id} className="flex items-baseline gap-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate">{asset.description}</span>
                  <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
                    {[asset.assetTag, asset.acquisitionYear].filter(Boolean).join(' · ')}
                  </span>
                  <span className="tabular shrink-0 text-sm">
                    {moneyExact(asset.originalCost ?? 0)}
                  </span>
                  <Button
                    size="sm"
                    disabled={link.isPending || detail.links.some((l) => l.assetId === asset.id)}
                    onClick={() => link.mutate({ assetId: asset.id })}
                  >
                    {detail.links.some((l) => l.assetId === asset.id) ? 'Linked' : 'Link'}
                  </Button>
                </li>
              ))
            )}
          </ul>
        ) : null}
        {link.error ? (
          <p className="mt-2 text-xs text-[var(--color-critical)]">
            {(link.error as Error).message}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function LinkRow({
  row,
  clientId,
  engagementId,
  onConfirm,
  onRemove,
  busy,
}: {
  row: InvoiceAssetLink;
  clientId: string;
  engagementId: string;
  onConfirm: () => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const suggested = row.status !== 'confirmed';
  return (
    <li className="flex flex-wrap items-baseline gap-3 px-5 py-2.5">
      <a
        href={`/clients/${clientId}/engagements/${engagementId}/assets/${row.assetId}`}
        className="min-w-0 flex-1 truncate text-sm hover:underline"
      >
        {row.assetDescription ?? 'Untitled line'}
      </a>
      <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
        {[row.assetTag, row.bookedCost === null ? null : moneyExact(row.bookedCost)]
          .filter(Boolean)
          .join(' · ')}
      </span>
      {row.share < 1 ? (
        <span className="shrink-0 text-xs text-[var(--color-ink-secondary)]">
          {percent(row.share, 0)} of the invoice
        </span>
      ) : null}
      <Badge tone={suggested ? 'warning' : 'good'}>{suggested ? 'suggested' : 'confirmed'}</Badge>
      {suggested && row.reason ? (
        <InfoTip title="Why this was suggested" content={row.reason} />
      ) : null}
      {suggested ? (
        <Button size="sm" variant="primary" disabled={busy} onClick={onConfirm}>
          Confirm
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
        Unlink
      </Button>
    </li>
  );
}
