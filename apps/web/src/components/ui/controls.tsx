'use client';

import { Check } from 'lucide-react';
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { InfoTip, Tooltip } from '@/components/ui/tooltip';

const FIELD =
  'h-9 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 text-sm ' +
  'text-[var(--color-ink)] outline-none transition-colors ' +
  'focus-visible:border-[var(--color-series-1)] focus-visible:ring-2 ' +
  'focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_25%,transparent)]';

export function Field({
  label,
  help,
  children,
}: {
  label: string;
  /** Plain-language explanation of what this control does to the results. */
  help?: ReactNode;
  children: ReactNode;
}) {
  // The help affordance is a button, and a button nested inside a <label>
  // hijacks clicks meant for the control — so the label points at the control
  // by id instead of wrapping it.
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string }>, { id })
    : children;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <label
          htmlFor={id}
          className="cursor-pointer text-[11px] font-medium tracking-wide text-[var(--color-ink-secondary)] uppercase"
        >
          {label}
        </label>
        {help ? <InfoTip title={label} content={help} size={12} /> : null}
      </div>
      {control}
    </div>
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select
      className={cn(
        FIELD,
        'cursor-pointer pr-8 hover:border-[color-mix(in_oklab,var(--color-series-1)_45%,transparent)]',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        FIELD,
        'hover:border-[color-mix(in_oklab,var(--color-series-1)_45%,transparent)]',
        className,
      )}
      {...props}
    />
  );
}

export function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const variants = {
    primary:
      'bg-[var(--color-series-1)] text-white hover:brightness-110 border-transparent shadow-sm',
    secondary:
      'bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-plane)] ' +
      'hover:border-[color-mix(in_oklab,var(--color-series-1)_45%,transparent)] border-[var(--color-hairline)]',
    ghost:
      'bg-transparent text-[var(--color-ink-secondary)] hover:bg-[var(--color-plane)] ' +
      'hover:text-[var(--color-ink)] border-transparent',
  };

  return (
    <button
      className={cn(
        'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium',
        'transition-all outline-none focus-visible:ring-2',
        'focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
        // A pressed state you can feel: the click registers visually even when
        // the result takes a round trip to arrive.
        'active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100 disabled:hover:bg-[var(--color-surface)]',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

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
                <p className="mt-1.5 text-[10px] tracking-wide text-[var(--color-ink-muted)] uppercase">
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
                'inline-flex cursor-pointer items-center gap-1 rounded-full border py-1 text-xs font-medium',
                'transition-colors outline-none focus-visible:ring-2',
                'focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
                // The checkmark occupies real width, so the padding compensates
                // to keep a chip from jumping sideways as it is toggled.
                active
                  ? 'border-[var(--color-series-1)] bg-[color-mix(in_oklab,var(--color-series-1)_14%,transparent)] pr-2.5 pl-2 text-[var(--color-series-1)]'
                  : 'border-[var(--color-hairline)] bg-[var(--color-surface)] px-2.5 text-[var(--color-ink-secondary)] hover:border-[color-mix(in_oklab,var(--color-series-1)_45%,transparent)] hover:bg-[var(--color-plane)] hover:text-[var(--color-ink)]',
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
