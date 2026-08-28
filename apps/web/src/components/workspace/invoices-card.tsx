'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Receipt, UploadCloud } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { InvoiceList } from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, money, moneyExact, percent, plural } from '@/lib/format';
import { InvoiceStatusBadge } from '@/components/workspace/badges';
import { Button } from '@/components/ui/controls';
import {
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
 * The invoices behind the capitalized amounts.
 *
 * This is the one category of leakage a fixed asset register cannot see at any
 * level of care. A row reading `PACKAGING LINE — $340,000` is what the
 * accounting entry was; Texas assesses the machine, and the freight, the
 * millwright labour, the concrete pad, the PLC programming and the sales tax
 * are all inside that number without being tangible personal property at that
 * address on January 1. Nothing recovers them except the document.
 *
 * So the card is built around coverage rather than around documents. How much
 * of the register has an invoice against it is the number that says whether
 * this line of work has been done, and the register lines with no invoice —
 * biggest first — are the whole of what to do next.
 */

const INVOICE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'];

export function InvoicesCard({
  clientId,
  engagementId,
}: {
  clientId: string;
  engagementId: string;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const { data, error, isLoading } = useQuery({
    queryKey: ['invoices', engagementId],
    queryFn: () => api.invoices(engagementId),
  });

  const upload = useMutation({
    mutationFn: (file: File) => api.uploadInvoice(engagementId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invoices', engagementId] });
    },
  });

  return (
    <Card>
      <CardHeader
        icon={Receipt}
        title="Invoices behind the register"
        description="Upload the vendor invoice or PO behind a capitalized line and the non-assessable cost inside it comes out."
        help="Reading is one step and ruling is another: the model transcribes the lines as the vendor printed them, and a jurisdiction rule decides what each line is for tax. Only lines a person has linked to a register row reach the report, because a misattributed invoice produces a finding that looks exactly like a correct one."
      />

      {data ? <Coverage list={data} /> : null}

      <div className="px-5 pt-4">
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
            'focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
            dragging
              ? 'border-[var(--color-accent)] bg-[color-mix(in_oklab,var(--color-accent)_8%,transparent)]'
              : 'border-[var(--color-hairline)] hover:border-[color-mix(in_oklab,var(--color-accent)_45%,transparent)] hover:bg-[var(--color-plane)]',
          )}
        >
          <UploadCloud size={20} strokeWidth={1.8} className="text-[var(--color-ink-muted)]" />
          {upload.isPending ? (
            <span>Reading the invoice — a multi-page scan takes a moment…</span>
          ) : (
            <>
              <span className="font-medium">Drop an invoice here, or click to choose</span>
              <span className="text-xs text-[var(--color-ink-muted)]">
                {INVOICE_EXTENSIONS.join(' · ')} — scans are fine, stored privately
              </span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={INVOICE_EXTENSIONS.join(',')}
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
      ) : (data?.documents.length ?? 0) === 0 ? (
        <EmptyState title="No invoices read yet" icon={Receipt}>
          Without one, a $340,000 packaging line is assessed at $340,000 — the report can say the
          class life is wrong, but not that a fifth of the number was never taxable in the first
          place.
        </EmptyState>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--color-hairline)]">
          {data!.documents.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              clientId={clientId}
              engagementId={engagementId}
            />
          ))}
        </ul>
      )}

      {data && data.uncovered.length > 0 ? (
        <Uncovered list={data} clientId={clientId} engagementId={engagementId} />
      ) : null}
    </Card>
  );
}

/**
 * Coverage, in cost rather than in documents.
 *
 * Twelve invoices against a $40M register is not twelve twelfths of anything.
 * The share of *cost* that has a document behind it is what says how far this
 * has been taken, and it is the number that decides whether the next hour is
 * better spent here or somewhere else.
 */
function Coverage({ list }: { list: InvoiceList }) {
  const share = list.registerCost > 0 ? list.coveredCost / list.registerCost : 0;
  const recovered = list.documents.reduce((sum, d) => sum + d.nonAssessableCost, 0);
  const unclear = list.documents.reduce((sum, d) => sum + d.unclearCost, 0);
  const unclearLines = list.documents.reduce((sum, d) => sum + d.unclearLines, 0);

  return (
    <StatGrid columns={4} className="mt-4">
      <StatCell>
        <Stat
          label="Register with an invoice"
          value={percent(share, 0)}
          note={`${money(list.coveredCost)} of ${money(list.registerCost)}`}
        />
      </StatCell>
      <StatCell>
        <Stat label="Invoices read" value={count(list.documents.length)} />
      </StatCell>
      <StatCell>
        <Stat
          label="Cost that is not assessable"
          value={money(recovered)}
          tone={recovered > 0 ? 'good' : 'default'}
          note="freight, labour, tax, service — inside capitalized amounts"
        />
      </StatCell>
      <StatCell>
        <Stat
          label="Still unclear"
          value={money(unclear)}
          tone={unclear > 0 ? 'warning' : 'default'}
          note={
            unclearLines > 0
              ? `${count(unclearLines)} ${plural(unclearLines, 'line')} the rules did not recognize`
              : 'every line has a treatment'
          }
        />
      </StatCell>
    </StatGrid>
  );
}

function DocumentRow({
  document,
  clientId,
  engagementId,
}: {
  document: InvoiceList['documents'][number];
  clientId: string;
  engagementId: string;
}) {
  const meta = [
    document.vendorName,
    document.invoiceNumber ? `#${document.invoiceNumber}` : null,
    document.invoiceDate,
    document.purchaseOrder ? `PO ${document.purchaseOrder}` : null,
    document.lineCount > 0
      ? `${count(document.lineCount)} ${plural(document.lineCount, 'line')}`
      : null,
    document.linkCount > 0
      ? `${count(document.linkCount)} linked`
      : document.status === 'failed'
        ? null
        : 'not linked to the register',
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <FileText size={16} strokeWidth={1.8} className="shrink-0 text-[var(--color-ink-muted)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {document.vendorName ?? document.originalFilename}
        </p>
        <p className="text-xs text-[var(--color-ink-muted)]">{meta.join(' · ')}</p>
        {/*
          The two totals sit beside each other for the same reason they do on a
          rendition: the stated one is what the page prints, the derived one is
          what we read, and only their agreement says the reading held.
        */}
        {document.statedTotal !== null ? (
          <p className="mt-0.5 text-xs text-[var(--color-ink-secondary)]">
            <span className="tabular">{moneyExact(document.derivedTotal ?? 0)}</span> read against{' '}
            <span className="tabular">{moneyExact(document.statedTotal)}</span> printed
            {document.derivedTotal !== null &&
            Math.abs(document.derivedTotal - document.statedTotal) > 1 ? (
              <span className="text-[var(--color-warning)]">
                {' '}
                — off by {moneyExact(Math.abs(document.derivedTotal - document.statedTotal))}
              </span>
            ) : null}
          </p>
        ) : null}
        {document.nonAssessableCost > 0 ? (
          <p className="mt-0.5 text-xs text-[var(--color-good)]">
            {moneyExact(document.nonAssessableCost)} of this invoice is not assessable
            {document.unclearCost > 0
              ? `, ${moneyExact(document.unclearCost)} still unclear`
              : null}
          </p>
        ) : null}
        {document.error ? (
          <p className="mt-0.5 text-xs text-[var(--color-critical)]">{document.error}</p>
        ) : null}
      </div>
      <InvoiceStatusBadge status={document.status} />
      <Link href={`/clients/${clientId}/engagements/${engagementId}/invoices/${document.id}`}>
        <Button>{document.status === 'accepted' ? 'Open' : 'Review'}</Button>
      </Link>
    </li>
  );
}

/**
 * Where to look next, in the only order that pays.
 *
 * Chasing an invoice costs somebody an email and a wait, so it is worth doing
 * on a $340,000 line and not on a $2,000 one. The list is capped server-side
 * and sorted by booked cost; it is a work list, not a register dump.
 */
function Uncovered({
  list,
  clientId,
  engagementId,
}: {
  list: InvoiceList;
  clientId: string;
  engagementId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? list.uncovered : list.uncovered.slice(0, 5);

  return (
    <div className="mt-5 border-t border-[var(--color-hairline)] px-5 py-4">
      <p className="eyebrow">Biggest lines with no invoice</p>
      <ul className="mt-2 divide-y divide-[var(--color-hairline)]">
        {shown.map((row) => (
          <li key={row.assetId} className="flex items-baseline gap-3 py-1.5 text-sm">
            <Link
              href={`/clients/${clientId}/engagements/${engagementId}/assets/${row.assetId}`}
              className="min-w-0 flex-1 truncate hover:underline"
            >
              {row.description ?? 'Untitled line'}
            </Link>
            <span className="shrink-0 text-xs text-[var(--color-ink-muted)]">
              {[row.vendor, row.acquisitionYear].filter(Boolean).join(' · ')}
            </span>
            <span className="tabular shrink-0 text-sm">{moneyExact(row.originalCost ?? 0)}</span>
          </li>
        ))}
      </ul>
      {list.uncovered.length > 5 ? (
        <button
          type="button"
          onClick={() => setExpanded((was) => !was)}
          className="mt-2 text-xs font-medium text-[var(--color-accent-ink)] hover:underline"
        >
          {expanded ? 'Show fewer' : `Show all ${count(list.uncovered.length)}`}
        </button>
      ) : null}
    </div>
  );
}
