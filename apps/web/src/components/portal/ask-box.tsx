'use client';

import { useMutation } from '@tanstack/react-query';
import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { GraphAskRecord } from '@tangible/types';
import { api } from '@/lib/api';
import { Button, TextArea } from '@/components/ui/controls';
import { Card, CardHeader } from '@/components/ui/primitives';
import { usePortal } from '@/components/portal/portal-context';

/**
 * A question box over the client's own record.
 *
 * The same ask-the-graph endpoint the firm uses, pointed at the same frozen
 * digest — so the client cannot be told something the record does not support,
 * and both sides of the engagement get the same answer to the same question.
 *
 * The `limits` the model returns are shown. They were written to face the firm
 * ("the record cannot settle this without the lease"), and a client reading
 * them learns exactly what would move their number, which is the most useful
 * thing on this card.
 */
export function AskBox() {
  const { engagementId } = usePortal();
  const [question, setQuestion] = useState('');
  const [answered, setAnswered] = useState<GraphAskRecord | null>(null);

  const ask = useMutation({
    mutationFn: (text: string) => api.askGraph(engagementId!, text),
    onSuccess: (result) => {
      setAnswered(result.ask);
      setQuestion('');
    },
  });

  if (engagementId === null) return null;
  const ready = question.trim().length >= 3;

  return (
    <Card>
      <CardHeader
        title="Ask about your report"
        description="Answered from your own register and the district’s schedules — nothing else."
        help="The answer is assembled from the same record this report was built on. If your question cannot be settled from it, you will be told that rather than given a guess."
      />
      <div className="space-y-3 px-5 py-4">
        <TextArea
          rows={2}
          value={question}
          placeholder="Why is the software line coming off?"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && ready) {
              ask.mutate(question.trim());
            }
          }}
        />
        <div className="flex items-center gap-3">
          <Button
            onClick={() => ask.mutate(question.trim())}
            variant="primary"
            disabled={!ready || ask.isPending}
          >
            <Sparkles size={14} className="mr-1.5" />
            {ask.isPending ? 'Reading your record…' : 'Ask'}
          </Button>
          {ask.error ? (
            <span className="text-sm text-[var(--color-bad)]">
              That could not be answered just now. Try again in a moment.
            </span>
          ) : null}
        </div>

        {answered ? (
          <div className="rounded-[var(--radius-control)] bg-[var(--color-sunken)] px-4 py-3">
            <p className="text-sm font-medium">{answered.question}</p>
            <p className="mt-2 text-sm whitespace-pre-wrap">{answered.answer.answer}</p>
            {answered.answer.limits.length > 0 ? (
              <ul className="mt-2 space-y-1 text-xs text-[var(--color-ink-muted)]">
                {answered.answer.limits.map((limit) => (
                  <li key={limit}>· {limit}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
