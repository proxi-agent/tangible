'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { DeletionCounts, DeletionReceipt } from '@tangible/types';
import { api } from '@/lib/api';
import { Button, TextInput } from '@/components/ui/controls';
import { Card, CardHeader, Skeleton } from '@/components/ui/primitives';

/**
 * Deleting a client, from the operator's side.
 *
 * The pitch that gets a register in the door promises deletion on request, so
 * this is the screen that keeps the promise. Three things it deliberately does:
 * it counts before it asks, because "delete this client" means nothing until
 * you know it means eleven filings and a protest still running; it takes the
 * client's typed name rather than a checkbox, which is the one confirmation
 * that cannot be clicked through by muscle memory; and it hands back a receipt,
 * because the client who asked to be deleted is owed something to file.
 *
 * It is folded shut by default. Nothing on a client page should put an
 * irreversible control one stray click from the row above it.
 */
export function DeleteClientCard({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [receipt, setReceipt] = useState<DeletionReceipt | null>(null);

  const preview = useQuery({
    queryKey: ['client-deletion', clientId],
    queryFn: () => api.deletionPreview(clientId),
    enabled: open && receipt === null,
  });

  const remove = useMutation({
    mutationFn: () => api.deleteClient(clientId, typed),
    onSuccess: ({ receipt: written }) => {
      setReceipt(written);
      // The list this client is about to be missing from. The client's own
      // detail query is left alone on purpose — refetching a deleted row would
      // replace the receipt with a 404 the moment the tab regains focus.
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      void queryClient.invalidateQueries({ queryKey: ['practice-season'] });
      void queryClient.invalidateQueries({ queryKey: ['practice-result'] });
    },
  });

  if (receipt) return <ReceiptCard receipt={receipt} />;

  const confirmed = typed.trim() === clientName.trim();

  return (
    <Card>
      <CardHeader
        title="Delete this client"
        description="Removes the client and everything of theirs — rows, uploads, and the classifications learned from their register."
        help="A client who asks to be deleted is not asking to be archived. This is not reversible and there is no undo; what survives is a receipt with counts, a name and a date, and no client data."
        action={
          <Button variant="ghost" className="h-8 text-xs" onClick={() => setOpen(!open)}>
            {open ? 'Cancel' : 'Delete client…'}
          </Button>
        }
      />

      {open ? (
        <div className="space-y-4 px-5 pb-5">
          {preview.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : preview.error ? (
            <p className="text-xs text-[var(--color-critical)]">
              {preview.error instanceof Error ? preview.error.message : String(preview.error)}
            </p>
          ) : preview.data ? (
            <>
              <CountGrid counts={preview.data.preview.counts} />

              {preview.data.preview.warnings.length > 0 ? (
                <ul className="space-y-2 rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/5 p-3">
                  {preview.data.preview.warnings.map((warning) => (
                    <li key={warning} className="flex gap-2 text-xs leading-relaxed">
                      <AlertTriangle
                        size={13}
                        strokeWidth={2}
                        className="mt-0.5 shrink-0 text-[var(--color-warning)]"
                      />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (confirmed) remove.mutate();
                }}
              >
                <label className="flex flex-col gap-1">
                  {/*
                   * The name is not uppercased with the rest of the label, and
                   * is not offered as a placeholder either. The match is exact,
                   * so a label that restyles the name is a label that lies about
                   * what to type — and a placeholder holding the answer turns a
                   * confirmation into a transcription.
                   */}
                  <span className="text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">
                    Type the client’s name to confirm:{' '}
                    <span className="font-medium text-[var(--color-ink-secondary)] normal-case">
                      {clientName}
                    </span>
                  </span>
                  <TextInput
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    className="w-72"
                  />
                </label>
                <Button variant="danger" type="submit" disabled={!confirmed || remove.isPending}>
                  <Trash2 size={15} strokeWidth={2} />
                  {remove.isPending ? 'Deleting…' : 'Delete permanently'}
                </Button>
                {remove.error ? (
                  <span className="text-xs text-[var(--color-critical)]">
                    {remove.error instanceof Error ? remove.error.message : String(remove.error)}
                  </span>
                ) : null}
              </form>
            </>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}

const COUNT_LABELS: Array<[keyof DeletionCounts, string]> = [
  ['engagements', 'Engagements'],
  ['locations', 'Sites'],
  ['assets', 'Assets'],
  ['documents', 'Documents'],
  ['storageObjects', 'Stored files'],
  ['findings', 'Findings'],
  ['filedRenditions', 'Filed renditions'],
  ['notices', 'Notices'],
  ['protests', 'Protests'],
  ['correctionMotions', '25.25 motions'],
  ['appointments', 'Appointments'],
  ['memoryRows', 'Learned classifications'],
];

/** Everything that goes, counted. Zeroes stay on screen — an absence is a fact too. */
function CountGrid({ counts }: { counts: DeletionCounts }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
      {COUNT_LABELS.map(([key, label]) => (
        <div key={key} className="flex items-baseline justify-between gap-2">
          <dt className="text-xs text-[var(--color-ink-secondary)]">{label}</dt>
          <dd
            className={`tabular text-sm ${
              counts[key] === 0 ? 'text-[var(--color-ink-muted)]' : 'font-medium'
            }`}
          >
            {counts[key]}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * What the client gets told, and what the firm keeps.
 *
 * The receipt is the whole point of doing this properly: a client who asks to
 * be deleted has no way to verify it themselves, so the answer is a dated
 * record of exactly what went. Files the bucket would not give up are named
 * rather than assumed gone — the one number here that can be wrong is the one
 * we refuse to round.
 */
function ReceiptCard({ receipt }: { receipt: DeletionReceipt }) {
  return (
    <Card>
      <CardHeader
        title={`${receipt.clientName} is deleted`}
        description={`Deleted ${new Date(receipt.deletedAt).toLocaleString()}. This receipt is the record — it holds counts, a name and a date, and no client data.`}
        action={
          <Link
            href="/clients"
            className="text-xs text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
          >
            Back to clients
          </Link>
        }
      />
      <div className="space-y-4 px-5 pb-5">
        <CountGrid counts={receipt.counts} />
        {receipt.storageFailed.length > 0 ? (
          <div className="rounded-md border border-[var(--color-critical)]/40 bg-[var(--color-critical)]/5 p-3 text-xs leading-relaxed">
            <p className="font-medium text-[var(--color-critical)]">
              {receipt.storageRemoved} files removed from the bucket; {receipt.storageFailed.length}{' '}
              would not go.
            </p>
            <p className="mt-1 text-[var(--color-ink-secondary)]">
              The rows are gone either way. These objects need removing by hand before the deletion
              is complete:
            </p>
            <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-[var(--color-ink-secondary)]">
              {receipt.storageFailed.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-ink-secondary)]">
            {receipt.storageRemoved} uploaded {receipt.storageRemoved === 1 ? 'file' : 'files'}{' '}
            removed from the private bucket.
          </p>
        )}
      </div>
    </Card>
  );
}
