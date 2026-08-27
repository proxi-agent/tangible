'use client';

import { MessageSquarePlus, Sparkles, SquareArrowOutUpRight, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAssistantScope } from '@/hooks/use-assistant-scope';
import { Tooltip } from '@/components/ui/tooltip';
import { AssistantThread } from '@/components/assistant/assistant-thread';

/**
 * The assistant, reachable from every screen without leaving it.
 *
 * A drawer rather than a page, because the questions worth asking are asked
 * *at* something. "Why is this return blocked" is asked standing on the return;
 * sending the reader somewhere else to ask it costs them the thing they were
 * looking at, and they come back having to find their place again. The full
 * page at /assistant exists for the other case — reading back what was asked
 * last week — and the two share a thread, so a conversation started in the
 * drawer opens there and continues.
 *
 * The open thread lives here rather than in the drawer so that navigating does
 * not end it. A preparer asks about a client, walks to that client's findings
 * screen while the answer is still on the right, and asks the follow-up from
 * there — and the follow-up carries the *new* page's scope, which is exactly
 * what they meant by it.
 */
interface AssistantContextValue {
  open: boolean;
  conversationId: string | null;
  openAssistant: (conversationId?: string | null) => void;
  close: () => void;
  newThread: () => void;
  setConversationId: (id: string | null) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function useAssistant(): AssistantContextValue {
  const value = useContext(AssistantContext);
  if (!value) throw new Error('useAssistant must be used inside AssistantProvider');
  return value;
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const pathname = usePathname();

  const openAssistant = useCallback((id?: string | null) => {
    if (id !== undefined) setConversationId(id);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  const newThread = useCallback(() => setConversationId(null), []);

  // The drawer over its own full page would be the same thread twice.
  const onAssistantPage = pathname.startsWith('/assistant');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(
    () => ({ open, conversationId, openAssistant, close, newThread, setConversationId }),
    [open, conversationId, openAssistant, close, newThread],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
      {open && !onAssistantPage ? <AssistantDrawer /> : null}
    </AssistantContext.Provider>
  );
}

function AssistantDrawer() {
  const { conversationId, setConversationId, close, newThread } = useAssistant();
  const scope = useAssistantScope();

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Assistant"
    >
      {/* The scrim is only on narrow screens. On a desktop the point of the
          drawer is that the page behind it stays readable and clickable — the
          answer is about what is on it. */}
      <button
        type="button"
        aria-label="Close the assistant"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-[2px] lg:hidden"
      />
      <aside className="relative flex h-full w-full max-w-full flex-col border-l border-[var(--color-hairline)] bg-[var(--color-plane)] shadow-[var(--shadow-overlay)] sm:w-[27rem] lg:w-[30rem]">
        <header className="flex shrink-0 items-center gap-2 border-b border-[var(--color-hairline)] bg-[var(--color-surface)] px-4 py-2.5">
          <Sparkles size={15} strokeWidth={2} className="text-[var(--color-accent)]" />
          <span className="text-sm font-semibold tracking-tight">Assistant</span>
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip
              title="New thread"
              content="Start a fresh conversation. The current one is kept and can be reopened from the assistant page."
            >
              <button
                type="button"
                aria-label="New thread"
                onClick={newThread}
                className="grid size-7 cursor-pointer place-items-center rounded-[var(--radius-control)] text-[var(--color-ink-muted)] transition-colors outline-none hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
              >
                <MessageSquarePlus size={15} strokeWidth={2} />
              </button>
            </Tooltip>
            <Tooltip
              title="Open in full"
              content="The same threads with room to read them, and every earlier conversation beside them."
            >
              <Link
                href={conversationId ? `/assistant?thread=${conversationId}` : '/assistant'}
                onClick={close}
                aria-label="Open the assistant page"
                className="grid size-7 cursor-pointer place-items-center rounded-[var(--radius-control)] text-[var(--color-ink-muted)] transition-colors outline-none hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
              >
                <SquareArrowOutUpRight size={14} strokeWidth={2} />
              </Link>
            </Tooltip>
            <button
              type="button"
              aria-label="Close the assistant"
              onClick={close}
              className="grid size-7 cursor-pointer place-items-center rounded-[var(--radius-control)] text-[var(--color-ink-muted)] transition-colors outline-none hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
            >
              <X size={15} strokeWidth={2} />
            </button>
          </div>
        </header>

        <AssistantThread
          conversationId={conversationId}
          onConversation={setConversationId}
          scope={scope}
          compact
          autoFocus
        />
      </aside>
    </div>
  );
}

/** The way in, from the shell's top bar. */
export function AssistantTrigger() {
  const { openAssistant, open } = useAssistant();

  return (
    <Tooltip
      title="Assistant"
      content="Ask about a client, a county, or the Tax Code. Answers are looked up in the record before they are written, and every one of them shows what it read. ⌘K."
    >
      <button
        type="button"
        aria-label="Open the assistant"
        aria-expanded={open}
        onClick={() => openAssistant()}
        className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[var(--radius-control)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 text-sm text-[var(--color-ink-secondary)] transition-colors outline-none hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
      >
        <Sparkles size={14} strokeWidth={2} className="text-[var(--color-accent)]" />
        <span className="hidden sm:inline">Ask</span>
        <kbd className="text-2xs hidden rounded border border-[var(--color-hairline)] px-1 py-px font-sans text-[var(--color-ink-muted)] lg:inline">
          ⌘K
        </kbd>
      </button>
    </Tooltip>
  );
}
