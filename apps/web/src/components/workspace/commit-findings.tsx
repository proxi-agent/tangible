'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookmarkCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FindingSource } from '@tangible/types';
import { api } from '@/lib/api';
import { Button, TextInput } from '@/components/ui/controls';
import { ErrorState } from '@/components/ui/primitives';

/**
 * Turning the report on screen into a record of what was said.
 *
 * Deliberately a button and not an autosave. Everything else on these pages is
 * live — the figures move the moment a classification is settled, which is what
 * you want while the work is in progress. But the day a report leaves the
 * office it stops being a working view and becomes a claim, and the claim needs
 * a date, a name and numbers that cannot quietly change afterwards.
 *
 * The label is optional and free text because the useful thing to write is
 * never a status. It is "sent to Dana before the 15 April deadline" — the
 * sentence that tells you next January why this run exists.
 */
export function CommitFindings({
  clientId,
  engagementId,
  source,
  priorDocumentId,
}: {
  clientId: string;
  engagementId: string;
  source: FindingSource;
  priorDocumentId?: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');

  const commit = useMutation({
    mutationFn: () =>
      api.commitFindings(engagementId, {
        source,
        priorDocumentId: priorDocumentId ?? null,
        label: label.trim() || null,
      }),
    onSuccess: (set) => {
      void queryClient.invalidateQueries({ queryKey: ['finding-sets', engagementId] });
      router.push(`/clients/${clientId}/engagements/${engagementId}/findings/${set.id}`);
    },
  });

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <BookmarkCheck size={14} strokeWidth={2} />
        Commit this version
      </Button>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <TextInput
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !commit.isPending) commit.mutate();
            if (e.key === 'Escape') setOpen(false);
          }}
          placeholder="What is this run? — “sent to Dana, 14 March”"
          className="h-9 w-72 text-xs"
          aria-label="A name for this committed version"
        />
        <Button variant="primary" disabled={commit.isPending} onClick={() => commit.mutate()}>
          {commit.isPending ? 'Committing…' : 'Commit'}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      <p className="max-w-md text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
        Freezes these figures as they stand and starts a decision log against them. The live report
        keeps moving; this copy does not.
      </p>
      {commit.error ? <ErrorState error={commit.error} /> : null}
    </div>
  );
}
