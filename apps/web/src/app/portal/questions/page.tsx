'use client';

import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, MessageCircleQuestion } from 'lucide-react';
import { useState } from 'react';
import type { AskRecord } from '@tangible/types';
import { api } from '@/lib/api';
import { day } from '@/lib/format';
import { usePortal } from '@/components/portal/portal-context';
import { PortalHeader } from '@/components/portal/portal-header';
import { ReadOnlyNote } from '@/components/portal/read-only';
import { useAskInvalidation, usePortalAsks } from '@/components/portal/use-portal-asks';
import { Button, TextArea } from '@/components/ui/controls';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * The asks ledger, pointed at the person who can actually answer.
 *
 * These questions were raised because the register did not settle something a
 * return has to state — which column is cost, whether a line is a leased
 * asset, whether something was still on site on January 1. Every one of them
 * is a question about the client's own business, and until now the only way to
 * ask it was an email that lands outside the record. Answered here, the answer
 * is the same row the next mapping proposal reads as fact.
 */
export default function PortalQuestionsPage() {
  const { engagementId, canAct } = usePortal();

  const { asks, isLoading, error } = usePortalAsks(engagementId);

  const open = asks.filter((ask) => ask.status === 'open');
  const answered = asks.filter((ask) => ask.status === 'answered');

  return (
    <>
      <PortalHeader
        title="Questions for you"
        description="Things your register could not tell us, and only you can. Each answer goes straight onto the record we file from."
      />

      {error ? <ErrorState error={error} /> : null}

      <Card>
        <CardHeader
          title="Waiting on you"
          description="Answer in your own words — a sentence is plenty."
          icon={MessageCircleQuestion}
        />
        {isLoading ? (
          <div className="px-5 py-5">
            <Skeleton className="h-24 w-full" />
          </div>
        ) : open.length === 0 ? (
          <EmptyState title="Nothing to answer right now" icon={CheckCircle2}>
            When we hit something in your numbers that we cannot settle ourselves, the question will
            appear here and we will email you.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--color-hairline)]">
            {open.map((ask) => (
              <AskRow key={ask.id} ask={ask} canAct={canAct} />
            ))}
          </ul>
        )}
      </Card>

      {answered.length > 0 ? (
        <Card>
          <CardHeader
            title="Already answered"
            description="Kept so both sides can see what the filing rests on."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {answered.map((ask) => (
              <li key={ask.id} className="px-5 py-3.5">
                <p className="text-sm font-medium">{ask.question}</p>
                <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">{ask.answer}</p>
                {ask.answeredAt ? (
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    Answered {day(ask.answeredAt.slice(0, 10))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

function AskRow({ ask, canAct }: { ask: AskRecord; canAct: boolean }) {
  const invalidate = useAskInvalidation();
  const [answer, setAnswer] = useState('');

  const submit = useMutation({
    mutationFn: () => api.updateAsk(ask.id, { status: 'answered', answer: answer.trim() }),
    onSuccess: () => invalidate(ask),
  });

  return (
    <li className="px-5 py-4">
      <p className="text-sm font-medium">{ask.question}</p>
      {/* The firm's "why" is written for the firm, but it is the honest answer
        to "why are you asking me this" and reads perfectly well as one. */}
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">{ask.why}</p>
      {/* The question is worth reading either way — a viewer who cannot answer
        it can still tell the person who can that it is waiting. */}
      {!canAct ? (
        <div className="mt-3">
          <ReadOnlyNote what="Answering" />
        </div>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <TextArea
              rows={2}
              value={answer}
              placeholder="Your answer…"
              onChange={(e) => setAnswer(e.target.value)}
              className="min-w-[16rem] flex-1"
            />
            <Button
              variant="primary"
              disabled={answer.trim().length === 0 || submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? 'Sending…' : 'Send answer'}
            </Button>
          </div>
          {submit.error ? (
            <p className="mt-2 text-xs text-[var(--color-critical)]">
              {submit.error instanceof Error ? submit.error.message : 'Could not save that.'}
            </p>
          ) : null}
        </>
      )}
    </li>
  );
}
