'use client';

import { HelpCircle } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
/** Space between the trigger and the panel. */
const GAP = 8;

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

  /** Which input opened it — hover and focus want different dismissal rules. */
  const openedByPointer = useRef(false);
  const showFromPointer = useCallback(() => {
    openedByPointer.current = true;
    show();
  }, [show]);
  const showFromFocus = useCallback(() => {
    openedByPointer.current = false;
    show();
  }, [show]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    // Backstop for a hover that never gets its pointerleave — the trigger
    // re-rendering out from under the cursor, or a pointer that jumps rather
    // than travels. Only for pointer-opened panels: a keyboard user who opened
    // this by tabbing should not lose it to a nudged mouse.
    // Geometry, not event.target: a move event can be reported against an
    // ancestor while the cursor is still over the trigger, and the rect is the
    // only authority on where the cursor actually is. A trigger that has since
    // unmounted has no rect, which is itself the answer.
    const onPointerMove = (event: PointerEvent) => {
      const rect = triggerRef.current?.getBoundingClientRect();
      const inside =
        rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) hide();
    };

    // The measured rect goes stale the moment anything moves, and a panel
    // floating away from its trigger is worse than no panel.
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    if (openedByPointer.current) document.addEventListener('pointermove', onPointerMove);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      document.removeEventListener('pointermove', onPointerMove);
    };
  }, [open, hide]);

  return (
    <>
      <span
        ref={triggerRef}
        className={cn('inline-flex', className)}
        onPointerEnter={showFromPointer}
        onPointerLeave={hide}
        onFocus={showFromFocus}
        onBlur={hide}
        aria-describedby={open ? id : undefined}
      >
        {children}
      </span>

      {open ? <TooltipPanel id={id} anchor={anchor} title={title} content={content} /> : null}
    </>
  );
}

/**
 * Where the panel goes, once its real height is known.
 *
 * Above the trigger by preference — that is where the eye already is — but
 * only if the whole panel fits there. A three-line definition and an eight-line
 * one need different answers, and a guess based on the trigger's position alone
 * gets the tall ones sheared off against the top of the window.
 */
function place(anchor: DOMRect, width: number, height: number) {
  const roomAbove = anchor.top - VIEWPORT_MARGIN - GAP;
  const roomBelow = window.innerHeight - anchor.bottom - VIEWPORT_MARGIN - GAP;

  // Fits above → above. Otherwise whichever side has more room, so the panel
  // is never squeezed into the smaller of two bad options.
  const above = height <= roomAbove || roomAbove >= roomBelow;
  const maxHeight = Math.max(above ? roomAbove : roomBelow, 0);
  const settled = Math.min(height, maxHeight);

  return {
    left: clamp(
      anchor.left + anchor.width / 2 - width / 2,
      VIEWPORT_MARGIN,
      window.innerWidth - width - VIEWPORT_MARGIN,
    ),
    top: clamp(
      above ? anchor.top - GAP - settled : anchor.bottom + GAP,
      VIEWPORT_MARGIN,
      window.innerHeight - settled - VIEWPORT_MARGIN,
    ),
    maxHeight,
  };
}

/** Low wins ties, so a panel taller than the viewport still starts on screen. */
function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(value, high));
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof place> | null>(null);

  // Measure, then place. useLayoutEffect runs before paint, so the unplaced
  // first render is never visible — it exists only to be measured.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const { width, height } = panel.getBoundingClientRect();
    setPosition(place(anchor, width, height));
  }, [anchor]);

  if (typeof document === 'undefined') return null;

  const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="tooltip"
      style={{
        position: 'fixed',
        width,
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        maxHeight: position?.maxHeight,
        opacity: position ? 1 : 0,
      }}
      className={cn(
        'pointer-events-none z-50 overflow-y-auto overscroll-contain rounded-lg',
        'border-hairline bg-surface border px-3 py-2',
        'text-ink-secondary text-xs leading-relaxed shadow-lg shadow-black/10',
      )}
    >
      {title ? <p className="text-ink mb-1 font-semibold">{title}</p> : null}
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
