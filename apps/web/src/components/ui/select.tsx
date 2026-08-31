'use client';

import { Check, ChevronDown } from 'lucide-react';
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { FIELD, FIELD_SM } from '@/components/ui/field-styles';
import { cn } from '@/lib/cn';

/**
 * A select that is ours rather than the operating system's.
 *
 * The native control could not be styled past its border: the option list is
 * drawn by the OS, so it ignored the theme, the type scale and the radius, and
 * in dark mode it opened as a slab of light-mode grey. It also had no way to
 * show which row is the current one beyond a highlight the OS chose — on a long
 * list of statutory categories, "which one is set" was a guess.
 *
 * So the list is a listbox we draw: themed, checked on the selected row, and
 * positioned against the viewport rather than trusting there is room below.
 *
 * The call sites did not change. Options still arrive as `<option>` and
 * `<optgroup>` children, `value` and `onChange` still behave as they did, and
 * `onChange` still receives a real event whose `target` is a real `<select>` —
 * the native element is still in the DOM, hidden, carrying the value and the
 * form participation. Everything a caller can observe is what it always was;
 * only the part the user looks at is different.
 */

/** Distance from the viewport edge the panel will not cross. */
const MARGIN = 8;
/** Space between the trigger and the panel. */
const GAP = 4;
/** The panel scrolls rather than growing past this, however much room there is. */
const MAX_HEIGHT = 320;
/** Long labels get room to wrap; the panel never runs the width of a monitor. */
const MAX_WIDTH = 440;
/** How long a type-ahead run stays open before the next key starts a new one. */
const TYPEAHEAD_MS = 700;

type Choice = {
  value: string;
  label: ReactNode;
  /** The label flattened to text — for type-ahead, and for a truncated trigger's tooltip. */
  text: string;
  disabled: boolean;
};

/** An `optgroup`, or the run of ungrouped options before the first one. */
type Section = { label?: string; choices: Choice[] };

type Parsed = { sections: Section[]; choices: Choice[] };

/**
 * Read `<option>` / `<optgroup>` children into a list we can render ourselves.
 *
 * `choices` is flat and is what every index in this file refers to — keyboard
 * navigation crosses group boundaries without noticing them, exactly as the
 * native control does. `sections` is the same options in their groups, which is
 * only ever used for drawing.
 */
function parse(children: ReactNode): Parsed {
  const sections: Section[] = [];
  const choices: Choice[] = [];

  /** The section options land in, created on demand so an empty group draws nothing. */
  let current: Section | null = null;
  const sectionFor = (label?: string) => {
    if (!current || current.label !== label) {
      current = { label, choices: [] };
      sections.push(current);
    }
    return current;
  };

  const walk = (nodes: ReactNode, group?: string) => {
    Children.forEach(nodes, (node) => {
      if (!isValidElement(node)) return;

      if (node.type === 'optgroup') {
        const props = node.props as { label?: string; children?: ReactNode };
        walk(props.children, props.label);
        return;
      }

      if (node.type === 'option') {
        const props = node.props as {
          value?: string | number | readonly string[];
          children?: ReactNode;
          disabled?: boolean;
        };
        const choice: Choice = {
          // Numbers reach here as numbers — a year, a row index — and the value
          // a caller holds in state may be either. Everything compares as text.
          value: String(props.value ?? ''),
          label: props.children,
          text: flatten(props.children),
          disabled: Boolean(props.disabled),
        };
        sectionFor(group).choices.push(choice);
        choices.push(choice);
        return;
      }

      // A fragment, or anything else wrapping the options. `Children.forEach`
      // flattens arrays for us but not fragments.
      walk((node.props as { children?: ReactNode }).children, group);
    });
  };

  walk(children);
  return { sections, choices };
}

/** Everything a label renders as, as one string. */
function flatten(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (isValidElement(node)) return flatten((node.props as { children?: ReactNode }).children);
  return '';
}

/**
 * Controlled only — `defaultValue` is off the props on purpose. The hidden
 * native `<select>` below always carries a `value`, so a caller passing a
 * default gets React's "controlled or uncontrolled, not both" warning at
 * runtime and a control that ignores half of what it was told. Taking the prop
 * out of the type turns that into a compile error at the call site instead.
 */
export function Select({
  className,
  children,
  compact,
  value,
  onChange,
  disabled,
  id,
  title,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'defaultValue'> & {
  children: ReactNode;
  /** Inline in a header row rather than stacked in a form. */
  compact?: boolean;
}) {
  const { sections, choices } = useMemo(() => parse(children), [children]);
  const currentValue = String(value ?? '');
  const selectedIndex = choices.findIndex((choice) => choice.value === currentValue);
  const selected = selectedIndex >= 0 ? choices[selectedIndex] : undefined;

  const [open, setOpen] = useState(false);
  /** Which row the keyboard is on. Not a selection — nothing commits until it does. */
  const [active, setActive] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const nativeRef = useRef<HTMLSelectElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-option-${index}`;

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  /**
   * Hand the choice back through the native element.
   *
   * The `<select>` below this is the one the caller's `onChange` will see, so
   * its value is set first and the event carries the element itself. A caller
   * reading `event.target.value` — which every one of them does — reads the
   * real thing rather than a shape we invented that happens to have the field.
   */
  const commit = useCallback(
    (index: number) => {
      const choice = choices[index];
      if (!choice || choice.disabled) return;
      close(true);

      const node = nativeRef.current;
      if (!node || !onChange) return;
      node.value = choice.value;
      onChange({
        target: node,
        currentTarget: node,
        type: 'change',
        bubbles: true,
        preventDefault: () => {},
        stopPropagation: () => {},
      } as unknown as ChangeEvent<HTMLSelectElement>);
    },
    [choices, close, onChange],
  );

  /** Opening lands on the current row, or the first one that can be chosen. */
  const firstEnabled = () => {
    const index = choices.findIndex((choice) => !choice.disabled);
    return index < 0 ? 0 : index;
  };
  const openAt = (index: number) => {
    setActive(index);
    setOpen(true);
  };

  /** The next selectable row in a direction, stopping at the ends as a select does. */
  const step = (from: number, delta: number) => {
    for (let index = from + delta; index >= 0 && index < choices.length; index += delta) {
      if (!choices[index]?.disabled) return index;
    }
    return from;
  };

  // Type-ahead. Keys typed in quick succession accumulate into one prefix, so
  // "har" reaches Harris rather than stopping at whatever starts with "r".
  const typed = useRef({ prefix: '', at: 0 });
  const typeahead = (key: string, from: number) => {
    const now = performance.now();
    typed.current.prefix =
      now - typed.current.at > TYPEAHEAD_MS
        ? key.toLowerCase()
        : typed.current.prefix + key.toLowerCase();
    typed.current.at = now;
    const { prefix } = typed.current;

    // Repeating one letter walks through the entries starting with it, so the
    // search begins after the current row and wraps.
    const head = prefix[0] ?? '';
    const repeating = prefix.length > 1 && prefix.split('').every((char) => char === head);
    const needle = repeating ? head : prefix;
    const offset = repeating || prefix.length === 1 ? 1 : 0;

    for (let hop = 0; hop < choices.length; hop += 1) {
      // `from` is -1 when nothing is selected yet, so the modulo is taken back
      // into range rather than trusted to land there.
      const index = (((from + offset + hop) % choices.length) + choices.length) % choices.length;
      const choice = choices[index];
      if (choice && !choice.disabled && choice.text.trim().toLowerCase().startsWith(needle)) {
        return index;
      }
    }
    return -1;
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const printable = event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;

    if (!open) {
      if (
        event.key === 'Enter' ||
        event.key === ' ' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp'
      ) {
        event.preventDefault();
        openAt(selectedIndex >= 0 ? selectedIndex : firstEnabled());
      } else if (printable) {
        const found = typeahead(event.key, selectedIndex >= 0 ? selectedIndex : -1);
        if (found >= 0) {
          event.preventDefault();
          // Closed, a letter picks outright — the native control does the same,
          // and opening a panel the user did not ask for to show one row is worse.
          commit(found);
        }
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => step(index, 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => step(index, -1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(step(-1, 1));
        return;
      case 'End':
        event.preventDefault();
        setActive(step(choices.length, -1));
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(active);
        return;
      case 'Escape':
        event.preventDefault();
        close(true);
        return;
      case 'Tab':
        // Not prevented: the panel shuts and focus carries on out of the
        // control, which is what a native select does.
        close(false);
        return;
      default:
        if (!printable) return;
        event.preventDefault();
        {
          const found = typeahead(event.key, active);
          if (found >= 0) setActive(found);
        }
    }
  };

  return (
    <>
      {/*
        The value, and whatever form the control sits in, still live on a real
        `<select>`. It is out of the tab order and out of the accessibility tree
        — the button below carries both — but it is the element the caller's
        `onChange` is handed, so `event.target` is never a fiction.
      */}
      <select
        {...rest}
        ref={nativeRef}
        value={currentValue}
        onChange={() => {}}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden
        className="sr-only"
      >
        {children}
      </select>

      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        disabled={disabled}
        title={title ?? selected?.text}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() =>
          open ? close(false) : openAt(selectedIndex >= 0 ? selectedIndex : firstEnabled())
        }
        onKeyDown={onKeyDown}
        className={cn(
          compact ? FIELD_SM : FIELD,
          'flex cursor-pointer items-center gap-2 pr-2.5 text-left',
          // The chevron turns over while the panel is open, which is the only
          // thing on screen that says the button and the panel are one control.
          open && 'border-[var(--color-accent)]',
          className,
        )}
      >
        <span
          className={cn('min-w-0 flex-1 truncate', !selected && 'text-[var(--color-ink-muted)]')}
        >
          {selected ? selected.label : ' '}
        </span>
        <ChevronDown
          size={compact ? 13 : 14}
          strokeWidth={2}
          aria-hidden
          className={cn(
            'shrink-0 text-[var(--color-ink-muted)] transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open ? (
        <Listbox
          id={listId}
          optionId={optionId}
          sections={sections}
          activeValue={choices[active]?.value}
          selectedValue={selected?.value}
          indexOf={(choice) => choices.indexOf(choice)}
          triggerRef={triggerRef}
          onHover={setActive}
          onPick={commit}
          onDismiss={() => close(false)}
        />
      ) : null}
    </>
  );
}

/** Where the panel goes, once the room around the trigger is known. */
function place(anchor: DOMRect, natural: { width: number; height: number }) {
  const roomBelow = window.innerHeight - anchor.bottom - MARGIN - GAP;
  const roomAbove = anchor.top - MARGIN - GAP;

  // Below by preference — that is where a list dropping from a control belongs
  // and where the eye goes next. It flips only when the whole panel does not
  // fit below and there is more room above, so a control near the bottom of a
  // long form opens upward instead of into a two-row sliver.
  const below = natural.height <= roomBelow || roomBelow >= roomAbove;
  const room = Math.max(below ? roomBelow : roomAbove, 0);
  const height = Math.min(natural.height, room, MAX_HEIGHT);

  return {
    left: clamp(anchor.left, MARGIN, Math.max(MARGIN, window.innerWidth - natural.width - MARGIN)),
    top: below ? anchor.bottom + GAP : anchor.top - GAP - height,
    maxHeight: Math.min(room, MAX_HEIGHT),
    below,
  };
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(value, high));
}

function Listbox({
  id,
  optionId,
  sections,
  activeValue,
  selectedValue,
  indexOf,
  triggerRef,
  onHover,
  onPick,
  onDismiss,
}: {
  id: string;
  optionId: (index: number) => string;
  sections: Section[];
  activeValue?: string;
  selectedValue?: string;
  indexOf: (choice: Choice) => number;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onHover: (index: number) => void;
  onPick: (index: number) => void;
  onDismiss: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof place> | null>(null);
  const [width, setWidth] = useState<number>();

  // Measure, then place — the same order the tooltip uses, and for the same
  // reason: where the panel goes depends on how tall it turned out to be.
  // `scrollHeight` rather than the rect, because the rect is already clipped by
  // the max height and would make a tall list look like it fits anywhere.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return;

    const natural = { width: panel.offsetWidth, height: panel.scrollHeight };
    setWidth(natural.width);

    const reposition = () => {
      const node = triggerRef.current;
      if (!node) return;
      const anchor = node.getBoundingClientRect();
      // Scrolled out of sight entirely: there is nothing to hang off any more,
      // and a panel pinned to the edge of the window has stopped meaning
      // anything. The native control closes here too.
      if (anchor.bottom < 0 || anchor.top > window.innerHeight) {
        onDismiss();
        return;
      }
      setPosition(place(anchor, natural));
    };

    reposition();
    // Capture, so it follows a trigger inside a scrolling card and not only the
    // window: a scroll in a nested container does not bubble.
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [triggerRef, onDismiss]);

  // A press anywhere else shuts it. On the trigger it does nothing here — the
  // button's own click toggles, and closing on the way down would make the
  // click reopen it.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [onDismiss, triggerRef]);

  // Keep the keyboard's row on screen. `nearest` so arrowing down a visible
  // list does not jump it around under the cursor.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || activeValue === undefined) return;
    panel.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [activeValue]);

  if (typeof document === 'undefined') return null;

  // Read during render on purpose. The layout effect below measures
  // `panel.offsetWidth` as the panel's natural width, and that measurement is
  // taken against this `minWidth` — so the trigger's width has to be known on
  // the very first pass. Moving it into state would measure a 200px-wide
  // control's panel at 160px and then pin it there.
  // oxlint-disable-next-line react/refs
  const triggerWidth = triggerRef.current?.getBoundingClientRect().width ?? 0;

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="listbox"
      style={{
        position: 'fixed',
        left: position?.left ?? 0,
        top: position?.top ?? 0,
        // Never narrower than the control it belongs to, and free to grow past
        // it: the scope bar's year select is 80px wide and its options are
        // four characters, but a classification select is 200px wide and its
        // options are sentences. Truncating those to the trigger's width would
        // hide the difference between two categories that read alike.
        minWidth: Math.max(triggerWidth, 160),
        maxWidth: Math.min(window.innerWidth - MARGIN * 2, MAX_WIDTH),
        width: width ?? 'max-content',
        maxHeight: position?.maxHeight ?? MAX_HEIGHT,
        // Placed on the first layout pass, so the unplaced render is measured
        // and never seen.
        opacity: position ? 1 : 0,
      }}
      className={cn(
        'z-50 overflow-y-auto overscroll-contain rounded-[10px] p-1',
        'border border-[var(--color-hairline)] bg-[var(--color-raised)] shadow-[var(--shadow-overlay)]',
      )}
    >
      {sections.map((section, sectionIndex) => (
        <div
          key={section.label ?? `section-${sectionIndex}`}
          role="group"
          aria-label={section.label}
        >
          {section.label ? (
            <p className="eyebrow px-2.5 pt-2 pb-1 first:pt-1">{section.label}</p>
          ) : null}
          {section.choices.map((choice) => {
            const index = indexOf(choice);
            const isSelected = choice.value === selectedValue;
            const isActive = choice.value === activeValue;
            return (
              <div
                key={`${choice.value}-${index}`}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                aria-disabled={choice.disabled || undefined}
                data-active={isActive}
                // Pointer rather than mouse, and `move` rather than `enter`, so
                // the row under a stationary cursor does not steal the
                // keyboard's highlight the moment the list scrolls beneath it.
                onPointerMove={() => !choice.disabled && onHover(index)}
                onClick={() => onPick(index)}
                className={cn(
                  'flex cursor-pointer items-start gap-2 rounded-[6px] px-2 py-1.5 text-xs leading-snug',
                  // 32px on a coarse pointer clears the WCAG floor without
                  // making a six-row list taller than a phone.
                  'pointer-coarse:min-h-8 pointer-coarse:py-2',
                  choice.disabled && 'cursor-not-allowed opacity-45',
                  isActive && !choice.disabled && 'bg-[var(--color-sunken)]',
                  isSelected
                    ? 'font-medium text-[var(--color-ink)]'
                    : 'text-[var(--color-ink-secondary)]',
                )}
              >
                {/* The tick sits in a column of its own rather than in front of
                    the label, so the labels line up whether or not one of them
                    is the current answer. */}
                <span className="flex w-3.5 shrink-0 justify-center pt-px">
                  {isSelected ? (
                    <Check size={13} strokeWidth={2.5} className="text-[var(--color-accent)]" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">{choice.label}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>,
    document.body,
  );
}
