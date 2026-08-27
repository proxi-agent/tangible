'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Sparkles, Trash2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { AssistantConversation } from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { day } from '@/lib/format';
import { useAssistantScope } from '@/hooks/use-assistant-scope';
import { AssistantThread } from '@/components/assistant/assistant-thread';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';

/**
 * The assistant with room to read it, and every earlier thread beside it.
 *
 * The drawer is for asking; this is for reading back. A thread is a record —
 * each answer frozen with the exact lookups that produced it — and the reason
 * to come here is usually to find what the record said about something three
 * weeks ago, which is a job for a list and a wide column rather than a panel.
 *
 * The open thread is in the URL, so an answer can be sent to a colleague the
 * same way any other page here can.
 */
const ASSISTANT_HELP =
  'Answers are looked up before they are written. A research pass reads the firm’s own record, the county appraisal roll, and a curated statutory corpus; a second pass writes the answer from those results and nothing else. Citations are checked against what the lookups actually returned — one that cannot be backed is dropped and counted in the limits. Client register figures are confidential under Tax Code 22.27, so a thread is stored here and goes when the client does.';

export default function AssistantPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const scope = useAssistantScope();

  const fromUrl = searchParams.get('thread');
  const [selected, setSelected] = useState<string | null>(fromUrl);
  // The URL wins on arrival — a pasted link should open the thread it names,
  // not whichever one this tab last had open.
  const conversationId = fromUrl ?? selected;

  const conversations = useQuery({
    queryKey: ['assistant-conversations'],
    queryFn: api.assistantConversations,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAssistantConversation(id),
    onSuccess: (_result, id) => {
      void queryClient.invalidateQueries({ queryKey: ['assistant-conversations'] });
      queryClient.removeQueries({ queryKey: ['assistant-conversation', id] });
      if (id === conversationId) open(null);
    },
  });

  const open = (id: string | null) => {
    setSelected(id);
    router.replace(id ? `/assistant?thread=${id}` : '/assistant', { scroll: false });
  };

  const items = conversations.data?.conversations ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assistant"
        meta={<InfoTip title="How an answer is reached" content={ASSISTANT_HELP} />}
        // Not a restatement of what to ask — the empty thread below already says
        // that, in the same words, and shipping both put the sentence on screen
        // twice. This says the thing the thread cannot: the conversations keep.
        description="Threads are kept, so a line of enquiry survives the tab being closed and can be picked up where it stopped."
      />

      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <Card className="hidden h-[calc(100vh-13rem)] flex-col overflow-hidden lg:flex">
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-hairline)] px-3 py-2.5">
            <span className="eyebrow">Threads</span>
            <button
              type="button"
              onClick={() => open(null)}
              className="ml-auto flex h-7 cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-xs text-[var(--color-ink-secondary)] transition-colors outline-none hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
            >
              <MessageSquarePlus size={13} strokeWidth={2} />
              New
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {conversations.isLoading ? (
              <div className="space-y-2 p-1">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-5/6" />
              </div>
            ) : conversations.error ? (
              <ErrorState error={conversations.error} />
            ) : items.length === 0 ? (
              <p className="p-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                Nothing asked yet. A thread is named by the question that started it.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {items.map((conversation) => (
                  <ThreadRow
                    key={conversation.id}
                    conversation={conversation}
                    active={conversation.id === conversationId}
                    onOpen={() => open(conversation.id)}
                    onDelete={() => remove.mutate(conversation.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card className="flex h-[calc(100vh-13rem)] min-h-[30rem] flex-col overflow-hidden">
          <AssistantThread
            conversationId={conversationId}
            onConversation={(id) => {
              open(id);
              void queryClient.invalidateQueries({ queryKey: ['assistant-conversations'] });
            }}
            scope={scope}
          />
        </Card>
      </div>

      {/* On a phone the list is below rather than beside, because the thread is
          what the page is for and a sidebar above it would push it off screen. */}
      <div className="lg:hidden">
        {items.length === 0 ? (
          <EmptyState title="No earlier threads">
            <span className="inline-flex items-center gap-1.5">
              <Sparkles size={13} strokeWidth={2} /> Ask something above and it is kept here.
            </span>
          </EmptyState>
        ) : (
          <Card>
            <ul className="divide-y divide-[var(--color-hairline)]">
              {items.map((conversation) => (
                <ThreadRow
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === conversationId}
                  onOpen={() => open(conversation.id)}
                  onDelete={() => remove.mutate(conversation.id)}
                />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function ThreadRow({
  conversation,
  active,
  onOpen,
  onDelete,
}: {
  conversation: AssistantConversation;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li
      className={cn(
        'group flex items-start gap-1 rounded-[var(--radius-control)] px-2 py-1.5 transition-colors',
        active ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-sunken)]',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        className="min-w-0 flex-1 cursor-pointer text-left outline-none focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
      >
        <span
          className={cn(
            'block truncate text-sm leading-snug',
            active ? 'font-medium text-[var(--color-accent-ink)]' : 'text-[var(--color-ink)]',
          )}
        >
          {conversation.title}
        </span>
        <span className="block text-xs text-[var(--color-ink-muted)]">
          {conversation.turnCount} {conversation.turnCount === 1 ? 'answer' : 'answers'} ·{' '}
          {day(conversation.updatedAt.slice(0, 10))}
        </span>
      </button>

      {/* Two clicks, because a thread holds answers that quoted a client's
          register and there is no undo behind this. */}
      <button
        type="button"
        aria-label={confirming ? 'Confirm deleting this thread' : 'Delete this thread'}
        onClick={() => (confirming ? onDelete() : setConfirming(true))}
        onBlur={() => setConfirming(false)}
        className={cn(
          'mt-0.5 grid size-6 shrink-0 cursor-pointer place-items-center rounded-[var(--radius-control)] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
          // A touch screen has no hover, so reveal-on-hover would leave this an
          // invisible 24px destructive target under a thumb. On a coarse pointer
          // it is simply always there, and big enough to aim at.
          'pointer-coarse:size-9 pointer-coarse:opacity-100',
          confirming
            ? 'bg-[var(--color-critical-soft)] text-[var(--color-critical)]'
            : 'text-[var(--color-ink-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-critical)] focus-visible:opacity-100',
        )}
      >
        <Trash2 size={12} strokeWidth={2} />
      </button>
    </li>
  );
}
