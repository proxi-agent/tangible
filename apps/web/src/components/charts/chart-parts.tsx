'use client';

import type { ReactNode } from 'react';

/** Recharts styling constants, kept in one place so every chart reads alike. */
export const AXIS = {
  stroke: 'var(--color-axis)',
  tick: { fill: 'var(--color-ink-muted)', fontSize: 11 },
  tickLine: false as const,
};

export const GRID = {
  stroke: 'var(--color-grid)',
  strokeDasharray: '0',
  vertical: false as const,
};

/** 2px surface ring, the spacer that keeps adjacent fills from touching. */
export const MARK_SEPARATOR = {
  stroke: 'var(--color-surface)',
  strokeWidth: 2,
};

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
}

export function TooltipCard({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="pointer-events-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-xs font-semibold">{title}</p>
      <dl className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-3 text-xs">
            {row.color ? (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: row.color }}
                aria-hidden="true"
              />
            ) : null}
            <dt className="text-[var(--color-ink-secondary)]">{row.label}</dt>
            <dd className="tabular ml-auto font-medium">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Legend for two or more series. Identity is carried by a marker *and* a text
 * label, so it never depends on color alone.
 */
export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-xs text-[var(--color-ink-secondary)]">
          <span
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ backgroundColor: item.color }}
            aria-hidden="true"
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function ChartFrame({
  title,
  subtitle,
  legend,
  children,
  height = 240,
}: {
  title: string;
  subtitle?: string;
  legend?: ReactNode;
  children: ReactNode;
  height?: number;
}) {
  return (
    <section className="card flex flex-col p-5">
      <header className="mb-1">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {subtitle ? (
          <p className="mt-0.5 text-xs text-[var(--color-ink-secondary)]">{subtitle}</p>
        ) : null}
      </header>
      {legend ? <div className="mb-3">{legend}</div> : <div className="mb-3" />}
      <div style={{ height }}>{children}</div>
    </section>
  );
}
