'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SavingsReport } from '@tangible/types';
import { cn } from '@/lib/cn';
import { money, percent } from '@/lib/format';
import { InfoTip } from '@/components/ui/tooltip';
import { usePortal } from '@/components/portal/portal-context';
import { waterfallShape } from '@/lib/waterfall';

/**
 * Reported value on the left, corrected value on the right, and every finding
 * that moves one to the other in between.
 *
 * A waterfall rather than a list because the question a controller actually
 * has is "why is your number smaller than the district's", and the answer is
 * additive: these five things, this much each. Each step is a link into the
 * category that produced it — the report's rule is that every number is
 * clickable down to the rows behind it, and this is the first click.
 *
 * Screening findings are absent on purpose. They have no dollar amount until
 * somebody answers a question, and drawing them at some nominal width would
 * put a number on the page that the engine refused to invent.
 */
export function Waterfall({ report }: { report: SavingsReport }) {
  const { href } = usePortal();
  const shape = waterfallShape(report);
  if (!shape) return null;
  const { start, fromRoll, end } = shape;
  const rate = report.blendedTaxRate;

  /**
   * The two steps with no assets behind them, and so no click to explain them.
   * A tooltip is the only way either can say what it is — the roll gap in
   * particular is the largest bar on most reports and reads as a number we
   * invented until it says whose estimate it is.
   */
  const help: Record<string, ReactNode> = {
    'roll-gap': (
      <>
        <p>
          The district has no line-by-line list of what you own on this account, so the value they
          carry is an estimate. A rendition puts your own register in front of them, valued on
          their published schedules.
        </p>
        <p className="mt-1.5">
          They can still disagree with it. That is what the protest deadline after the notice is
          for.
        </p>
      </>
    ),
    exemption: report.exemption.basis,
  };

  const rows = shape.steps.map((step) => ({
    ...step,
    href: step.findingKey ? href(`/portal/report/${encodeURIComponent(step.findingKey)}`) : null,
    help: help[step.key],
  }));

  return (
    <div className="space-y-2 px-5 py-4">
      <Bar
        label={fromRoll ? 'What the district has you at today' : 'Your register, valued as it stands'}
        amount={start}
        width={1}
        tone="filed"
        note={
          fromRoll
            ? `${money(start * rate)} a year · account ${report.assessed?.accountId ?? ''}`
            : `${money(start * rate)} a year · every asset still on your books, on the district’s schedules`
        }
      />
      {rows.map((row) => {
        const bar = (
          <Bar
            label={row.label}
            amount={-row.amount}
            width={row.amount / start}
            tone="removed"
            note={`${money(row.amount * rate)} a year · ${percent(row.amount / start, 1)} of the value`}
            interactive={row.href !== null}
            help={row.help}
          />
        );
        return row.href ? (
          <Link
            key={row.key}
            href={row.href}
            className="block rounded-[var(--radius-control)] outline-none focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
          >
            {bar}
          </Link>
        ) : (
          <div key={row.key}>{bar}</div>
        );
      })}
      <Bar
        label="What a corrected return supports"
        amount={end}
        width={end / start}
        tone="corrected"
        note={`${money(report.proposedTax)} a year at ${percent(rate, 2)}`}
      />
    </div>
  );
}

function Bar({
  label,
  amount,
  width,
  tone,
  note,
  interactive = false,
  help,
}: {
  label: string;
  amount: number;
  width: number;
  tone: 'filed' | 'removed' | 'corrected';
  note: string;
  interactive?: boolean;
  /** For a bar with no assets to click into — the only way it can explain itself. */
  help?: ReactNode;
}) {
  const fill = {
    filed: 'bg-[var(--color-ink-muted)]',
    removed: 'bg-[var(--color-good)]',
    corrected: 'bg-[var(--color-accent)]',
  }[tone];

  return (
    <div
      className={cn(
        'rounded-[var(--radius-control)] px-2 py-1.5 transition-colors',
        interactive && 'hover:bg-[var(--color-sunken)]',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <span className="text-sm font-medium">
          {label}
          {help ? <InfoTip title={label} content={help} className="ml-1" /> : null}
          {interactive ? (
            <span className="ml-1.5 text-xs font-normal text-[var(--color-accent)]">
              see the assets →
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            'tabular text-sm font-semibold',
            tone === 'removed' && 'text-[var(--color-good)]',
          )}
        >
          {amount < 0 ? `− ${money(-amount)}` : money(amount)}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-[var(--color-sunken)]">
        {/* Widths are shares of the starting value, so the eye can compare a
          finding against the whole rather than against its neighbours. */}
        <div
          className={cn('h-full rounded-full', fill)}
          style={{ width: `${Math.max(0.5, Math.min(100, width * 100))}%` }}
        />
      </div>
      <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{note}</p>
    </div>
  );
}
