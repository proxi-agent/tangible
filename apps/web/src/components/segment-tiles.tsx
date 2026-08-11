'use client';

import { ArrowRight, Info } from 'lucide-react';
import Link from 'next/link';
import type { MarketOverview, SegmentDefinition, SegmentKey } from '@tangible/types';
import { cn } from '@/lib/cn';
import { count, money, percent } from '@/lib/format';
import { Tooltip } from '@/components/ui/tooltip';

const TIER_LABELS: Record<SegmentDefinition['tier'], string> = {
  market: 'Market',
  exposure: 'Penalty exposure',
  target: 'Addressable targets',
  signal: 'Signals',
};

/** Each tier answers a different question; saying which one keeps the grid readable. */
const TIER_BLURBS: Record<SegmentDefinition['tier'], string> = {
  market: 'Everything on the county’s books big enough to be taxed.',
  exposure: 'Businesses already paying a penalty for a missed filing.',
  target: 'The subset actually worth contacting.',
  signal: 'Patterns worth ranking on — suggestive, not proof.',
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
            <h2 className="text-[11px] font-semibold tracking-wider text-[var(--color-ink-muted)] uppercase">
              {TIER_LABELS[tier]}
            </h2>
            <p className="mb-2.5 text-xs text-[var(--color-ink-secondary)]">{TIER_BLURBS[tier]}</p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {inTier.map((definition) => {
                const metric = metrics.get(definition.key);
                if (!metric) return null;

                return (
                  <Link
                    key={definition.key}
                    href={`/accounts?${scopeQuery}&segments=${definition.key}`}
                    className={cn(
                      'card group flex cursor-pointer flex-col p-4 outline-none transition-all',
                      'hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--color-series-1)_45%,transparent)] hover:shadow-md hover:shadow-black/5',
                      'focus-visible:border-[var(--color-series-1)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_30%,transparent)]',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium">{definition.label}</h3>
                      {definition.caveat ? (
                        <Tooltip
                          title={definition.label}
                          content={definition.caveat}
                          className="mt-0.5 shrink-0"
                        >
                          <span className="cursor-help text-[var(--color-ink-muted)] transition-colors group-hover:text-[var(--color-series-1)]">
                            <Info size={13} strokeWidth={2} />
                            <span className="sr-only">{definition.caveat}</span>
                          </span>
                        </Tooltip>
                      ) : null}
                    </div>

                    <p className="mt-2 text-3xl font-semibold tracking-tight">
                      {count(metric.accountCount)}
                      <span className="ml-1.5 text-xs font-normal text-[var(--color-ink-muted)]">
                        businesses
                      </span>
                    </p>

                    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                      <div className="flex justify-between gap-2">
                        <dt className="text-[var(--color-ink-secondary)]">Penalties/yr</dt>
                        <dd className="tabular font-medium">
                          {money(metric.estimatedAnnualPenalty)}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[var(--color-ink-secondary)]">Equipment value</dt>
                        <dd className="tabular font-medium">{money(metric.totalAssessedValue)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[var(--color-ink-secondary)]">Typical penalty</dt>
                        <dd className="tabular font-medium">{money(metric.medianAnnualPenalty)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-[var(--color-ink-secondary)]">Of the market</dt>
                        <dd className="tabular font-medium">{percent(metric.shareOfTaxable)}</dd>
                      </div>
                    </dl>

                    <p className="mt-3 border-t border-[var(--color-hairline)] pt-2.5 text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
                      {definition.description}
                    </p>

                    {/* The whole tile is a link; this is the part that says so. */}
                    <p className="mt-2.5 inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-ink-muted)] transition-colors group-hover:text-[var(--color-series-1)]">
                      See these businesses
                      <ArrowRight
                        size={12}
                        strokeWidth={2.5}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
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
