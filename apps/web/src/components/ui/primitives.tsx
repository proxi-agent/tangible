import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('card', className)}>{children}</section>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-[var(--color-hairline)] px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'warning' | 'critical' | 'good';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-[var(--color-plane)] text-[var(--color-ink-secondary)] border-[var(--color-hairline)]',
    accent: 'bg-[color-mix(in_oklab,var(--color-series-1)_12%,transparent)] text-[var(--color-series-1)] border-[color-mix(in_oklab,var(--color-series-1)_30%,transparent)]',
    warning: 'bg-[color-mix(in_oklab,var(--color-warning)_16%,transparent)] text-[var(--color-ink)] border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)]',
    critical: 'bg-[color-mix(in_oklab,var(--color-critical)_12%,transparent)] text-[var(--color-critical)] border-[color-mix(in_oklab,var(--color-critical)_35%,transparent)]',
    good: 'bg-[color-mix(in_oklab,var(--color-good)_12%,transparent)] text-[var(--color-good)] border-[color-mix(in_oklab,var(--color-good)_35%,transparent)]',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('animate-pulse rounded bg-[var(--color-grid)]', className)}
      aria-hidden="true"
    />
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? (
        <div className="max-w-md text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="px-5 py-10 text-center">
      <p className="text-sm font-medium text-[var(--color-critical)]">Could not load this view</p>
      <p className="mx-auto mt-2 max-w-lg text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {message}
      </p>
      <p className="mt-3 text-xs text-[var(--color-ink-muted)]">
        Is the API running? <code className="tabular">pnpm dev</code> starts both apps.
      </p>
    </div>
  );
}
