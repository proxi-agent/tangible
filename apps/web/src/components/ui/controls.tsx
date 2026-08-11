'use client';

import type { ReactNode, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const FIELD =
  'h-9 rounded-md border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 text-sm ' +
  'text-[var(--color-ink)] outline-none transition-colors ' +
  'focus-visible:border-[var(--color-series-1)] focus-visible:ring-2 ' +
  'focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_25%,transparent)]';

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-wide text-[var(--color-ink-secondary)] uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select className={cn(FIELD, 'cursor-pointer pr-8', className)} {...props}>
      {children}
    </select>
  );
}

export function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD, className)} {...props} />;
}

export function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const variants = {
    primary:
      'bg-[var(--color-series-1)] text-white hover:opacity-90 border-transparent disabled:opacity-50',
    secondary:
      'bg-[var(--color-surface)] text-[var(--color-ink)] hover:bg-[var(--color-plane)] border-[var(--color-hairline)]',
    ghost:
      'bg-transparent text-[var(--color-ink-secondary)] hover:bg-[var(--color-plane)] border-transparent',
  };

  return (
    <button
      className={cn(
        'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium',
        'transition-colors outline-none focus-visible:ring-2',
        'focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
        'disabled:pointer-events-none disabled:opacity-50',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

/** Multi-select rendered as toggle chips — the filter set is small and visible. */
export function ChipGroup<T extends string>({
  options,
  selected,
  onToggle,
}: {
  options: { value: T; label: string; hint?: string }[];
  selected: readonly T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            title={option.hint}
            aria-pressed={active}
            onClick={() => onToggle(option.value)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
              'outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
              active
                ? 'border-[var(--color-series-1)] bg-[color-mix(in_oklab,var(--color-series-1)_14%,transparent)] text-[var(--color-series-1)]'
                : 'border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink-secondary)] hover:bg-[var(--color-plane)]',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
