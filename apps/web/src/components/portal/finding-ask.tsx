'use client';

import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import type { AskRecord, SavingsFinding } from '@tangible/types';
import { api } from '@/lib/api';
import { day } from '@/lib/format';
import { usePortal } from '@/components/portal/portal-context';
import { ReadOnlyNote } from '@/components/portal/read-only';
import { useAskInvalidation, usePortalAsks } from '@/components/portal/use-portal-asks';
import { Button, TextArea } from '@/components/ui/controls';
import { Callout } from '@/components/ui/primitives';

/**
 * The one question a screening finding turns on, put to the person who knows.
 *
 * A screening finding is not a saving and never prints as one — it is a fact
 * about the business that the register cannot hold. The engine writes the
 * question in the client's own vocabulary (`finding.question`); this is where
 * it gets asked and answered.
 *
 * The answer lands in the same asks ledger the mapping uses, so it shows up on
 * the Questions page and on the firm's side of the file without a second
 * source of truth. What it deliberately does not do is reprice the finding:
 * every one of these needs its own pricing rule — a share for freeport, a
 * landlord's account for leasehold, a per-group decision for duplicates — and
 * a number that moved the moment a sentence was typed would be a guess wearing
 * a report's clothes.
 */
/**
 * Narrowed to the four fields it reads rather than taking a whole finding: the
 * row-level page assembles its header from `FindingRowPage`, which carries the
 * same four and is not a `SavingsFinding`. Widening the prop would have meant
 * reconstructing a finding around them just to satisfy a type.
 */
type Askable = Pick<SavingsFinding, 'key' | 'title' | 'summary' | 'question' | 'assumption'>;

export function FindingAsk({ finding }: { finding: Askable }) {
  const { engagementId, canAct } = usePortal();
  const { asks } = usePortalAsks(engagementId);
  const invalidate = useAskInvalidation();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState('');

  // The row is found by what it is about, not by its wording — the engine can
  // reword the question between reports and the answer has to survive that.
  const ask = asks.find((row) => row.subject === finding.key) ?? null;

  const raise = useMutation({
    mutationFn: () => create(engagementId!, finding),
    onSuccess: (created) => {
      setOpen(true);
      invalidate(created);
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      // Creating here too, rather than trusting the row the button minted: if
      // that call failed the person still has an answer typed, and losing it to
      // a missing row would be the worst possible moment to ask them again.
      const row = ask ?? (await create(engagementId!, finding));
      return api.updateAsk(row.id, { status: 'answered', answer: answer.trim() });
    },
    onSuccess: (saved) => invalidate(saved),
  });

  if (finding.question === null || engagementId === null) return null;

  if (ask?.status === 'answered') {
    return (
      <Callout tone="good" icon={CheckCircle2} title="You have answered this">
        <p className="text-[var(--color-ink)]">{ask.answer}</p>
        <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
          {ask.answeredAt ? `Answered ${day(ask.answeredAt.slice(0, 10))}. ` : ''}
          Your team works this into the return by hand — the report moves only once it does.
        </p>
      </Callout>
    );
  }

  /**
   * A viewer still reads the question. It is the most load-bearing sentence on
   * the finding — it is what stands between a screening line and a number — and
   * a reader who cannot answer it is exactly the person who forwards it to
   * somebody who can.
   */
  if (!canAct) {
    return (
      <Callout tone="warning" icon={MessageCircleQuestion} title="What we need from you">
        <p className="text-[var(--color-ink)]">{finding.question}</p>
        <div className="mt-3">
          <ReadOnlyNote what="Answering" />
        </div>
      </Callout>
    );
  }

  return (
    <Callout tone="warning" icon={MessageCircleQuestion} title="What we need from you">
      <p className="text-[var(--color-ink)]">{finding.question}</p>
      {open || ask ? (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <TextArea
              rows={2}
              value={answer}
              placeholder="Your answer…"
              onChange={(event) => setAnswer(event.target.value)}
              className="min-w-[16rem] flex-1"
            />
            <Button
              variant="primary"
              disabled={answer.trim().length === 0 || send.isPending}
              onClick={() => send.mutate()}
            >
              {send.isPending ? 'Sending…' : 'Send answer'}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
            A sentence is plenty. If it needs a document, say so and we will ask for that instead.
          </p>
        </>
      ) : (
        <div className="mt-3">
          <Button
            size="sm"
            variant="subtle"
            disabled={raise.isPending}
            onClick={() => raise.mutate()}
          >
            {raise.isPending ? 'Opening…' : 'Answer this'}
          </Button>
        </div>
      )}
      {raise.error || send.error ? (
        <p className="mt-2 text-xs text-[var(--color-critical)]">
          {errorText(send.error ?? raise.error)}
        </p>
      ) : null}
    </Callout>
  );
}

function create(engagementId: string, finding: Askable): Promise<AskRecord> {
  return api.createFindingAsk(engagementId, {
    findingKey: finding.key,
    question: finding.question!,
    // The ledger's "why" is the firm's own note on what settles the question,
    // which is exactly what `assumption` already says for a screening finding.
    why: finding.assumption ?? finding.summary,
  });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not save that.';
}

/** Whether this finding's question has been put to the client and answered. */
export function askStateFor(
  asks: AskRecord[],
  finding: SavingsFinding,
): 'answered' | 'asked' | null {
  const ask = asks.find((row) => row.subject === finding.key);
  if (!ask) return null;
  return ask.status === 'answered' ? 'answered' : 'asked';
}
