'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SavingsReport } from '@tangible/types';
import { cn } from '@/lib/cn';
import { money, percent } from '@/lib/format';
import { InfoTip } from '@/components/ui/tooltip';

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
  const steps = report.findings
    .filter((finding) => finding.valueRemoved !== null && finding.valueRemoved > 0)
    .sort((a, b) => (b.valueRemoved ?? 0) - (a.valueRemoved ?? 0));

  const exemption = report.exemption.applied;
  const rate = report.blendedTaxRate;

  /**
   * Where the chart starts, and the reason this is not simply the register.
   *
   * When a district has an account on the roll, *that* is the number the client
   * is being taxed on, and it is usually well above their own books — an
   * appraiser with no rendition in hand estimates, and estimates high. Starting
   * the chart at the register would leave that gap off the page while the
   * headline saving counts it, which is the one discrepancy a controller is
   * guaranteed to find. So the roll is the top of the waterfall and the gap is
   * its first step, named for what it is.
   *
   * A roll *below* the register is the opposite situation — exposure, not
   * saving — and drawing it as a step that removes negative value would be a
   * lie told with arithmetic. There the chart starts at the register, and the
   * report's own figures say the district is under it.
   */
  const register = report.farImpliedValue + report.totalValueRemoved;
  const assessed = report.assessed?.assessedValue ?? null;
  const gap = assessed === null ? 0 : assessed - register;
  const start = gap > 0 && assessed !== null ? assessed : register;
  const end = report.proposedTaxableValue;
  if (start <= 0) return null;

  const rows: {
    key: string;
    label: string;
    amount: number;
    href: string | null;
    help?: ReactNode;
  }[] = [
    ...(gap > 0
      ? [
          {
            key: 'roll-gap',
            label: 'The district’s estimate, above what your books show',
            amount: gap,
            href: null,
            // The largest bar on most reports, and the only one with no assets
            // behind it to click into. Left unexplained it reads as a number we
            // invented; it is in fact the district's own estimate, made without
            // a list of what is actually on site.
            help: (
              <>
                <p>
                  The district has no line-by-line list of what you own on this account, so the
                  value they carry is an estimate. A rendition puts your own register in front of
                  them, valued on their published schedules.
                </p>
                <p className="mt-1.5">
                  They can still disagree with it. That is what the protest deadline after the
                  notice is for.
                </p>
              </>
            ),
          },
        ]
      : []),
    ...steps.map((finding) => ({
      key: finding.key,
      label: finding.title,
      amount: finding.valueRemoved ?? 0,
      href: `/portal/report/${encodeURIComponent(finding.key)}`,
    })),
    ...(exemption > 0
      ? [
          {
            key: 'exemption',
            label: report.exemption.label,
            amount: exemption,
            href: null,
            help: report.exemption.basis,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-2 px-5 py-4">
      <Bar
        label={
          gap > 0 ? 'What the district has you at today' : 'Your register, valued as it stands'
        }
        amount={start}
        width={1}
        tone="filed"
        note={
          gap > 0
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
