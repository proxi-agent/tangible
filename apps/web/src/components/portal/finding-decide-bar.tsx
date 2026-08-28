'use client';

import { Check, RotateCcw, X, HelpCircle } from 'lucide-react';
import { useState } from 'react';
import type { ReviewableRow } from '@tangible/types';
import { count, money, plural } from '@/lib/format';
import { Button, TextInput } from '@/components/ui/controls';

/**
 * What happens to the rows you have ticked.
 *
 * It appears only when something is selected, and it prints what is at stake in
 * the selection before offering the three verbs — because "accept 20 rows" and
 * "accept $412,000 off your return" are the same click and only one of them is
 * a decision somebody can weigh.
 *
 * Undo is a fourth verb rather than a special case. Nothing here deletes: a
 * cleared decision is another record saying the row is open again, so the trail
 * of who said what and when survives changing your mind.
 */
export function FindingDecideBar({
  selection,
  onDecide,
  onClear,
  pending,
}: {
  selection: ReviewableRow[];
  onDecide: (status: 'accepted' | 'rejected' | 'pending-client' | null, note: string) => void;
  onClear: () => void;
  pending: boolean;
}) {
  const [note, setNote] = useState('');

  if (selection.length === 0) return null;

  const value = selection.reduce((total, { row }) => total + (row.valueRemoved ?? 0), 0);
  const tax = selection.reduce((total, { row }) => total + (row.taxAtRisk ?? 0), 0);
  const decided = selection.filter(({ decision }) => decision !== null).length;

  const act = (status: 'accepted' | 'rejected' | 'pending-client' | null) => {
    onDecide(status, note.trim());
    setNote('');
  };

  return (
    <div className="sticky bottom-0 z-10 border-t border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-5 py-3 shadow-[0_-6px_16px_-12px_rgba(0,0,0,0.35)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm font-medium">
          {count(selection.length)} {plural(selection.length, 'row')} selected
          <span className="ml-2 font-normal text-[var(--color-ink-secondary)]">
            {money(value)} off the return · {money(tax)} of tax a year
          </span>
        </p>
        {decided > 0 ? (
          <p className="text-xs text-[var(--color-ink-muted)]">
            {count(decided)} of them already {decided === 1 ? 'has' : 'have'} a decision — acting
            again records a new one over the top.
          </p>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <TextInput
            compact
            value={note}
            placeholder="Note (optional)"
            onChange={(event) => setNote(event.target.value)}
            className="w-56"
          />
          <Button variant="primary" disabled={pending} onClick={() => act('accepted')}>
            <Check size={13} className="mr-1" />
            Accept
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => act('rejected')}>
            <X size={13} className="mr-1" />
            Reject
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => act('pending-client')}>
            <HelpCircle size={13} className="mr-1" />
            Need info
          </Button>
          <Button variant="ghost" disabled={pending} onClick={() => act(null)}>
            <RotateCcw size={13} className="mr-1" />
            Undo
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onClear}>
            Deselect
          </Button>
        </div>
      </div>
    </div>
  );
}
