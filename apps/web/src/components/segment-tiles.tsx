'use client';

import { Info } from 'lucide-react';
import Link from 'next/link';
import type { MarketOverview, SegmentDefinition, SegmentKey } from '@tangible/types';
import { count, money, percent } from '@/lib/format';

const TIER_LABELS: Record<SegmentDefinition['tier'], string> = {
  market: 'Market',
  exposure: 'Penalty exposure',
  target: 'Addressable targets',
  signal: 'Signals',
};

const TIER_ORDER: SegmentDefinition['tier'][] = ['market', 'exposure', 'target', 'signal'];

/**
 * The segment vocabulary as stat tiles. Every tile carries its caveat, because a
 * number from this dataset is only as good as the qualification attached to it —
 * a "frozen value" count means something quite different from a non-filer count.
 */
export function SegmentTiles({
  overview,
  segments,
  scopeQuery,
}: {
  overview: MarketOverview;
  segments: SegmentDefinition[];
  scopeQuery: string;
}) {
  const metrics = new Map(overview.segments.map((s) => [s.segment as SegmentKey, s]));

  return (
    <div className="space-y-6">
      {TIER_ORDER.map((tier) => {
        const inTier = segments.filter((s) => s.tier === tier);
        if (inTier.length === 0) return null;

        return (
          <section key={tier}>
            <h2 className="mb-2.5 text-[11px] font-semibold tracking-wider text-[var(--color-ink-muted)] uppercase">
              {TIER_LABELS[tier]}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {inTier.map((definition) => {
                const metric = metrics.get(definition.key);
                if (!metric) return null;

                return (
                  <Link
                    key={definition.key}
                    href={`/accounts?${scopeQuery}&segments=${definition.key}`}
                    className="card group flex flex-col p-4 transition-colors hover:border-[color-mix(in_oklab,var(--color-series-1)_45%,transparent)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium">{definition.label}</h3>
                      {definition.caveat ? (
                        <span
                          title={definition.caveat}
                          className="mt-0.5 shrink-0 text-[var(--color-ink-muted)]"
                        >
                          <Info size={13} strokeWidth={2} />
                          <span className="sr-only">{definition.caveat}</span>
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-2 text-3xl font-semibold tracking-tight">
                      {count(metric.accountCount)}
                    </p>

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-[var(--color-ink-secondary)]">Penalty/yr</dt>
                        <dd className="tabular font-medium">
                          {money(metric.estimatedAnnualPenalty)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[var(--color-ink-secondary)]">Value</dt>
                        <dd className="tabular font-medium">{money(metric.totalAssessedValue)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[var(--color-ink-secondary)]">Median penalty</dt>
                        <dd className="tabular font-medium">{money(metric.medianAnnualPenalty)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[var(--color-ink-secondary)]">Of taxable</dt>
                        <dd className="tabular font-medium">{percent(metric.shareOfTaxable)}</dd>
                      </div>
                    </dl>

                    <p className="mt-3 border-t border-[var(--color-hairline)] pt-2.5 text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
                      {definition.description}
                    </p>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
