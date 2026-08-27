'use client';

import type { ReactNode } from 'react';
import { CardHeader } from '@/components/ui/primitives';

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
        <li
          key={item.label}
          className="flex items-center gap-1.5 text-xs text-[var(--color-ink-secondary)]"
        >
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
    // A chart is a card like any other, and its title had been an `h3` two
    // steps down the scale from the `h2` on the card beside it — a hierarchy
    // that said, wrongly, that the chart was a subsection of something.
    <section className="card flex flex-col">
      <CardHeader title={title} description={subtitle} />
      <div className="flex flex-1 flex-col p-5">
        {legend ? <div className="mb-3">{legend}</div> : null}
        <div style={{ height }}>{children}</div>
      </div>
    </section>
  );
}
