'use client';

import { Check } from 'lucide-react';
import Link from 'next/link';
import {
  cloneElement,
  isValidElement,
  useId,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from 'react';
import { FIELD, FIELD_BASE, FIELD_SM } from '@/components/ui/field-styles';
import { cn } from '@/lib/cn';
import { InfoTip, Tooltip } from '@/components/ui/tooltip';

/* ─────────────────────────────────────────────────────────────────────────────
 * Fields
 *
 * The shared look lives in `field-styles`, because `Select` is its own module
 * and its trigger has to be indistinguishable from the input beside it.
 * ────────────────────────────────────────────────────────────────────────── */

export { Select } from '@/components/ui/select';

export function Field({
  label,
  help,
  children,
  className,
}: {
  label: string;
  /** Plain-language explanation of what this control does to the results. */
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  // The help affordance is a button, and a button nested inside a <label>
  // hijacks clicks meant for the control — so the label points at the control
  // by id instead of wrapping it.
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children;

  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-center gap-1">
        <label htmlFor={id} className="eyebrow cursor-pointer">
          {label}
        </label>
        {help ? <InfoTip title={label} content={help} size={12} /> : null}
      </div>
      {/* The control sits at the bottom of the cell. Across a row of filters the
          labels are not the same length — "City" beside "Already has a tax
          agent" — and a label that wraps to two lines would otherwise drag its
          control down half a line out of step with its neighbours. */}
      <div className="mt-auto">{control}</div>
    </div>
  );
}

export function TextInput({
  className,
  compact,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  /** Inline in a header row rather than stacked in a form. */
  compact?: boolean;
}) {
  return <input className={cn(compact ? FIELD_SM : FIELD, className)} {...props} />;
}

export function TextArea({
  className,
  rows = 3,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={rows}
      className={cn(FIELD_BASE, 'py-2 leading-relaxed', className)}
      {...props}
    />
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Buttons
 * ────────────────────────────────────────────────────────────────────────── */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
export type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'border-transparent bg-[var(--color-accent)] text-[var(--color-on-accent)] shadow-[var(--shadow-card)] ' +
    'hover:bg-[var(--color-accent-hover)]',
  secondary:
    'border-[var(--color-hairline-strong)] bg-[var(--color-surface)] text-[var(--color-ink)] ' +
    'shadow-[var(--shadow-card)] hover:bg-[var(--color-sunken)] ' +
    'hover:border-[color-mix(in_oklab,var(--color-accent)_40%,var(--color-hairline-strong))]',
  // Filled with the accent tint rather than the accent — for the affirmative
  // action on a card that already has a primary button elsewhere on screen.
  subtle:
    'border-[color-mix(in_oklab,var(--color-accent)_22%,transparent)] bg-[var(--color-accent-soft)] ' +
    'text-[var(--color-accent-ink)] hover:border-[color-mix(in_oklab,var(--color-accent)_40%,transparent)]',
  ghost:
    'border-transparent bg-transparent text-[var(--color-ink-secondary)] ' +
    'hover:bg-[var(--color-sunken)] hover:text-[var(--color-ink)]',
  // Reserved for the irreversible. Nothing that can be undone should wear it,
  // or the colour stops meaning anything by the time it matters.
  danger:
    'border-transparent bg-[var(--color-critical)] text-[var(--color-on-critical)] shadow-[var(--shadow-card)] ' +
    'hover:brightness-110',
};

/**
 * `sm` is 28px tall, which is comfortable under a mouse and two pixels short of
 * a finger: WCAG 2.5.8 wants 24px as the floor and every platform guideline
 * wants more. Rather than grow the button everywhere — a table's row actions
 * would start to shove the row around — it grows only where the pointer is
 * coarse. A desktop keeps the tight control; a phone gets 36px.
 */
const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-xs pointer-coarse:h-9 pointer-coarse:px-3',
  md: 'h-9 gap-1.5 px-3 text-sm',
};

/**
 * The button's own classes, for the cases that cannot be a `Button`.
 *
 * A download has to stay a real `<a href>` — routing it through `Link` or a
 * click handler loses the browser's own save behaviour — and both form screens
 * had therefore hand-rolled a bordered box that only approximated a button. It
 * sat a pixel off, missed the focus ring, and stopped tracking the real thing
 * the first time a variant changed. Reach for `Button` or `LinkButton` first;
 * this is for the third case.
 */
export function buttonClasses(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  className?: string,
): string {
  return cn(
    'inline-flex cursor-pointer items-center justify-center rounded-[var(--radius-control)]',
    'border font-medium whitespace-nowrap',
    'transition-[background-color,border-color,transform,box-shadow,color] duration-150 outline-none',
    'focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
    // A pressed state you can feel: the click registers visually even when
    // the result takes a round trip to arrive.
    'active:scale-[0.98]',
    'disabled:pointer-events-none disabled:opacity-45 disabled:shadow-none',
    BUTTON_SIZES[size],
    BUTTON_VARIANTS[variant],
    className,
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button className={buttonClasses(variant, size, className)} {...props} />;
}

/**
 * A destination dressed as a button.
 *
 * "Open it" and "The form as filed" are the most consequential clicks on their
 * boards, and as bare prose fragments at the far right they read as labels. An
 * action the eye cannot find is an action that does not exist. This carries a
 * real button affordance while staying a link underneath, so it can be opened
 * in a new tab like any destination.
 */
export function LinkButton({
  className,
  variant = 'secondary',
  size = 'sm',
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClasses(variant, size, className)} {...props} />;
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Selection
 * ────────────────────────────────────────────────────────────────────────── */

export interface ChipOption<T extends string> {
  value: T;
  label: string;
  /** What the filter selects, in one plain sentence. */
  description?: string;
  /** Where the number is soft, or why it can be trusted. */
  caveat?: string | null;
}

/**
 * Multi-select rendered as toggle chips — the filter set is small and visible.
 *
 * Each chip names a slice of the roll in language that means nothing without
 * context ("Chronic non-filers", "Frozen value"), so each one carries its
 * definition and its caveat on hover rather than assuming the reader arrived
 * already knowing the vocabulary.
 */
export function ChipGroup<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: ChipOption<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <Tooltip
            key={option.value}
            title={option.label}
            content={
              <>
                {option.description ? <p>{option.description}</p> : null}
                {option.caveat ? (
                  <p className="mt-1.5 border-t border-[var(--color-hairline)] pt-1.5 text-[var(--color-ink-muted)]">
                    {option.caveat}
                  </p>
                ) : null}
                <p className="eyebrow mt-1.5">
                  {active ? 'Click to remove this filter' : 'Click to add this filter'}
                </p>
              </>
            }
          >
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(option.value)}
              className={cn(
                'inline-flex h-7 cursor-pointer items-center gap-1 rounded-full border text-xs font-medium',
                // Touch bump, height only: the left/right padding below is
                // deliberately asymmetric to hold the chip's width as it toggles.
                'pointer-coarse:h-9',
                'transition-colors outline-none focus-visible:ring-[3px]',
                'focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
                // The checkmark occupies real width, so the padding compensates
                // to keep a chip from jumping sideways as it is toggled.
                active
                  ? 'border-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] bg-[var(--color-accent-soft)] pr-2.5 pl-2 text-[var(--color-accent-ink)]'
                  : 'border-[var(--color-hairline-strong)] bg-[var(--color-surface)] px-2.5 text-[var(--color-ink-secondary)] hover:border-[color-mix(in_oklab,var(--color-accent)_40%,var(--color-hairline-strong))] hover:text-[var(--color-ink)]',
              )}
            >
              {active ? <Check size={12} strokeWidth={3} /> : null}
              {option.label}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * A single-choice switch rendered as one connected control.
 *
 * Used where a set of buttons was standing in for a radio group — the year
 * picker, the theme toggle, view switches. The selected option is a raised
 * pill on a sunken track, so which one is on is legible without reading.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
  /** Divides the full width between the options — for a rail or a form row. */
  grow = false,
  className,
}: {
  options: { value: T; label: ReactNode; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: ButtonSize;
  ariaLabel: string;
  grow?: boolean;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-0.5 rounded-[var(--radius-control)]',
        'border border-[var(--color-hairline)] bg-[var(--color-sunken)] p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-[calc(var(--radius-control)-2px)]',
              'font-medium transition-colors outline-none focus-visible:ring-[3px]',
              'focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]',
              // Same touch bump as Button — see BUTTON_SIZES. The 0.5 padding on
              // the rail means the rail itself ends up 4px taller than the segment.
              size === 'sm'
                ? 'h-6 px-2 text-xs pointer-coarse:h-8 pointer-coarse:px-2.5'
                : 'h-7 px-2.5 text-xs pointer-coarse:h-9 pointer-coarse:px-3',
              grow && 'flex-1',
              active
                ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-card)]'
                : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
