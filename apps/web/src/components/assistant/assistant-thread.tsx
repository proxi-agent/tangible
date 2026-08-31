'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Book, Briefcase, CornerDownLeft, Table2, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type {
  AssistantCitation,
  AssistantConversationDetail,
  AssistantScope,
  AssistantTurn,
} from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { day } from '@/lib/format';
import { suggestionsFor } from '@/lib/assistant/suggestions';
import { Button, TextArea } from '@/components/ui/controls';
import { ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * One thread, wherever it is being read.
 *
 * The drawer and the full page render the same component because they are the
 * same conversation — a question asked from the drawer over the findings screen
 * and then reopened on `/assistant` has to look like one exchange, not two
 * views of a row. Only the chrome around it differs.
 *
 * Every turn shows its work. The answer is on top because that is what was
 * asked for, but the lookups that produced it are one disclosure away and they
 * name themselves: which tool, what it was asked, what came back, how long it
 * took, and whether it failed. That is not debugging output left in by
 * accident. An answer whose lookups cannot be seen is a claim a preparer has to
 * take on faith, and this practice does not take numbers on faith.
 */

const SOURCE_ICON = {
  workspace: Briefcase,
  market: Table2,
  knowledge: Book,
} as const;

export function AssistantThread({
  conversationId,
  onConversation,
  scope,
  compact = false,
  autoFocus = false,
}: {
  conversationId: string | null;
  onConversation: (id: string) => void;
  scope: AssistantScope | null;
  /** Drawer width. Tightens the type scale and drops the outer card. */
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const conversation = useQuery({
    queryKey: ['assistant-conversation', conversationId],
    queryFn: () => api.assistantConversation(conversationId!),
    enabled: Boolean(conversationId),
  });

  const ask = useMutation({
    mutationFn: (text: string) => api.assistantAsk({ conversationId, question: text, scope }),
    onSuccess: (result) => {
      // Write the turn straight into the thread rather than refetching it. The
      // answer is already in hand and a refetch here would show the reader a
      // spinner over content they can see.
      queryClient.setQueryData(
        ['assistant-conversation', result.conversationId],
        (previous: AssistantConversationDetail | undefined) =>
          previous ? { ...previous, turns: [...previous.turns, result.turn] } : undefined,
      );
      void queryClient.invalidateQueries({ queryKey: ['assistant-conversations'] });
      if (result.conversationId !== conversationId) onConversation(result.conversationId);
      setPending(null);
    },
    onError: () => setPending(null),
  });

  const turns = conversation.data?.turns ?? [];

  // Follow the conversation down as it grows, including while an answer is
  // still being written — the pending question is the thing to keep in view.
  // Both dependencies are triggers rather than values the body reads.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [turns.length, pending]);

  const submit = () => {
    const text = question.trim();
    if (text.length < 3 || ask.isPending) return;
    setPending(text);
    setQuestion('');
    ask.mutate(text);
  };

  const suggestions = suggestionsFor(scope);
  const empty = !conversationId || (turns.length === 0 && !conversation.isLoading);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 lg:px-5">
        {conversation.error ? <ErrorState error={conversation.error} /> : null}

        {conversationId && conversation.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-5/6" />
          </div>
        ) : null}

        {empty && !pending ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-[var(--color-ink-secondary)]">
              Ask about a client&rsquo;s register, a return that will not go out, what a
              county&rsquo;s roll shows, or what the Tax Code requires. Every answer is looked up
              before it is written, and it says so when the record does not hold the answer.
            </p>
            <div className="space-y-1.5">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.question}
                  type="button"
                  onClick={() => {
                    setPending(suggestion.question);
                    ask.mutate(suggestion.question);
                  }}
                  className="block w-full cursor-pointer rounded-[var(--radius-control)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 text-left transition-colors outline-none hover:bg-[var(--color-plane)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
                >
                  <span className="eyebrow block">{suggestion.label}</span>
                  <span className="mt-0.5 block text-sm leading-snug text-[var(--color-ink-secondary)]">
                    {suggestion.question}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((turn) => (
          <Turn
            key={turn.id}
            turn={turn}
            onAsk={(text) => {
              setPending(text);
              ask.mutate(text);
            }}
          />
        ))}

        {pending ? (
          <div className="space-y-2">
            <h3 className="text-sm leading-snug font-semibold tracking-[-0.011em]">{pending}</h3>
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--color-ink-muted)]">
                Reading the record — this can take a minute on a question that spans a season.
              </p>
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-11/12" />
              <Skeleton className="h-3.5 w-4/6" />
            </div>
          </div>
        ) : null}

        {ask.error ? (
          <p className="text-xs leading-relaxed text-[var(--color-critical)]">
            {ask.error instanceof Error ? ask.error.message : String(ask.error)}
          </p>
        ) : null}

        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 py-3 lg:px-5">
        <TextArea
          rows={compact ? 2 : 3}
          className="w-full"
          value={question}
          autoFocus={autoFocus}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends. A question is one or two sentences and reaching for
            // a button after every one of them is the wrong shape for a thing
            // you are meant to ask five times in a row.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ask about this client, this county, or what the Tax Code requires…"
          maxLength={1_000}
        />
        <div className="mt-2 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={question.trim().length < 3 || ask.isPending}
            onClick={submit}
          >
            {ask.isPending ? 'Looking…' : 'Ask'}
          </Button>
          <span className="flex items-center gap-1 text-xs text-[var(--color-ink-muted)]">
            <CornerDownLeft size={11} strokeWidth={2} /> to send, shift to break the line
          </span>
        </div>
      </div>
    </div>
  );
}

function Turn({ turn, onAsk }: { turn: AssistantTurn; onAsk: (question: string) => void }) {
  const { answer } = turn;
  const failed = turn.toolCalls.filter((call) => !call.ok).length;

  return (
    <article className="space-y-2.5 border-t border-[var(--color-hairline)] pt-4 first:border-0 first:pt-0">
      <h3 className="text-sm leading-snug font-semibold tracking-[-0.011em]">{turn.question}</h3>

      {turn.source === 'fallback' ? (
        // Never presented as the same thing as an answer. This one was
        // assembled by code from the corpus because no model was reachable.
        <p className="flex items-start gap-1.5 text-xs leading-relaxed text-[var(--color-warning)]">
          <TriangleAlert size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
          Assembled from the knowledge corpus alone — nothing in the client record or the county
          data was read for this one.
        </p>
      ) : null}

      <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-ink-secondary)]">
        {answer.answer}
      </p>

      {answer.citations.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {answer.citations.map((citation) => (
            <CitationChip key={`${citation.kind}|${citation.ref}`} citation={citation} />
          ))}
        </div>
      ) : null}

      {answer.limits.length > 0 ? (
        <div className="text-xs leading-relaxed">
          <p className="font-medium text-[var(--color-warning)]">What this answer could not do</p>
          <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[var(--color-ink-muted)]">
            {answer.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {answer.followUps.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {answer.followUps.map((followUp) => (
            <button
              key={followUp}
              type="button"
              onClick={() => onAsk(followUp)}
              className="cursor-pointer rounded-full border border-dashed border-[var(--color-hairline)] px-2.5 py-1 text-left text-xs text-[var(--color-ink-secondary)] transition-colors outline-none hover:border-solid hover:bg-[var(--color-plane)] hover:text-[var(--color-ink)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
            >
              {followUp}
            </button>
          ))}
        </div>
      ) : null}

      {turn.toolCalls.length > 0 ? (
        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]">
            <span className="transition-transform group-open:rotate-90">›</span>
            {turn.toolCalls.length} lookup{turn.toolCalls.length === 1 ? '' : 's'}
            {failed > 0 ? (
              <span className="text-[var(--color-warning)]">· {failed} failed</span>
            ) : null}
          </summary>
          <ul className="mt-1.5 space-y-1 border-l border-[var(--color-hairline)] pl-3">
            {turn.toolCalls.map((call) => (
              <li key={call.id} className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
                <code className="text-[var(--color-ink-secondary)]">{call.tool}</code> —{' '}
                {call.ok ? (
                  call.summary
                ) : (
                  <span className="text-[var(--color-critical)]">{call.error ?? call.summary}</span>
                )}{' '}
                <span className="tabular-nums opacity-70">{Math.round(call.ms)}ms</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <p className="text-xs text-[var(--color-ink-muted)]">
        Answered {day(turn.createdAt.slice(0, 10))}
        {turn.model ? <> by {turn.model}</> : null}
        {turn.scope?.label ? <> from {turn.scope.label}</> : null}.
      </p>
    </article>
  );
}

/**
 * A citation, checked before it got here.
 *
 * Workspace and market citations are routes, so they are links. A knowledge
 * article has no screen of its own and its `href` is null — it renders as a
 * plain chip rather than a link that goes nowhere, and its badge says the claim
 * rests on the corpus rather than on the record.
 */
function CitationChip({ citation }: { citation: AssistantCitation }) {
  const Icon = SOURCE_ICON[citation.kind];
  const body = (
    <>
      <Icon size={11} strokeWidth={2} className="shrink-0" />
      <span className="truncate">{citation.label}</span>
    </>
  );
  const className =
    'inline-flex h-6 max-w-64 items-center gap-1.5 rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-ink-secondary)]';

  if (!citation.href) {
    return <span className={className}>{body}</span>;
  }
  return (
    <Link
      href={citation.href}
      className={cn(
        className,
        'transition-colors hover:bg-[var(--color-plane)] hover:text-[var(--color-ink)]',
      )}
    >
      {body}
    </Link>
  );
}
