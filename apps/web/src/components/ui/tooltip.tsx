'use client';

import { HelpCircle } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';

/**
 * A hover/focus explainer.
 *
 * Everything in this product is a term of art — "rendition", "frozen value",
 * "blended rate" — and the person looking at the screen has no reason to know
 * any of it. So the vocabulary carries its own definition wherever it appears.
 *
 * The panel renders in a portal at fixed coordinates rather than absolutely
 * inside the trigger, because most of these triggers live in table headers and
 * filter rows that scroll horizontally: an absolutely positioned panel would be
 * clipped by the very container it needs to escape.
 */

const PANEL_WIDTH = 264;
const VIEWPORT_MARGIN = 8;
/** Below this much room overhead, the panel flips under the trigger. */
const FLIP_THRESHOLD = 150;

export function Tooltip({
  title,
  children,
  content,
  className,
}: {
  /** Optional bolded first line — usually the term being defined. */
  title?: string;
  children: ReactNode;
  content: ReactNode;
  className?: string;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const id = useId();
  const open = anchor !== null;

  const show = useCallback(() => {
    const element = triggerRef.current;
    if (element) setAnchor(element.getBoundingClientRect());
  }, []);
  const hide = useCallback(() => setAnchor(null), []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    // The measured rect goes stale the moment anything moves, and a panel
    // floating away from its trigger is worse than no panel.
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [open, hide]);

  return (
    <>
      <span
        ref={triggerRef}
        className={cn('inline-flex', className)}
        onPointerEnter={show}
        onPointerLeave={hide}
        onFocus={show}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>

      {open ? <TooltipPanel id={id} anchor={anchor} title={title} content={content} /> : null}
    </>
  );
}

function TooltipPanel({
  id,
  anchor,
  title,
  content,
}: {
  id: string;
  anchor: DOMRect;
  title?: string;
  content: ReactNode;
}) {
  if (typeof document === 'undefined') return null;

  const below = anchor.top < FLIP_THRESHOLD;
  const centered = anchor.left + anchor.width / 2;
  const half = PANEL_WIDTH / 2;
  const left = Math.min(
    Math.max(centered, half + VIEWPORT_MARGIN),
    window.innerWidth - half - VIEWPORT_MARGIN,
  );

  return createPortal(
    <div
      id={id}
      role="tooltip"
      style={{
        position: 'fixed',
        left,
        top: below ? anchor.bottom + 8 : anchor.top - 8,
        width: PANEL_WIDTH,
        transform: `translate(-50%, ${below ? '0' : '-100%'})`,
      }}
      className={cn(
        'pointer-events-none z-50 rounded-lg border border-[var(--color-hairline)]',
        'bg-[var(--color-surface)] px-3 py-2 shadow-lg shadow-black/10',
        'text-xs leading-relaxed text-[var(--color-ink-secondary)]',
      )}
    >
      {title ? <p className="mb-1 font-semibold text-[var(--color-ink)]">{title}</p> : null}
      {content}
    </div>,
    document.body,
  );
}

/**
 * The standalone form: a question mark you can hover or tab to. Used next to a
 * label that has no room to explain itself.
 */
export function InfoTip({
  title,
  content,
  size = 13,
  className,
}: {
  title?: string;
  content: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <Tooltip title={title} content={content}>
      <button
        type="button"
        // Purely explanatory: clicking does nothing, so it should not steal a
        // form submit or announce itself as an action.
        onClick={(event) => event.preventDefault()}
        aria-label={title ? `What is ${title}?` : 'More information'}
        className={cn(
          'cursor-help rounded-full text-[var(--color-ink-muted)] transition-colors',
          'hover:text-[var(--color-series-1)] focus-visible:text-[var(--color-series-1)]',
          'outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
          className,
        )}
      >
        <HelpCircle size={size} strokeWidth={2} />
      </button>
    </Tooltip>
  );
}
