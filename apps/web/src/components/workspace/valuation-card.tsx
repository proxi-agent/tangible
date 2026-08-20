'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import type { EngagementValuation } from '@tangible/types';
import { CATEGORY_BY_KEY } from '@tangible/valuation';
import { api } from '@/lib/api';
import { count, money, moneyExact, percent, plural } from '@/lib/format';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
} from '@/components/ui/primitives';
import { InfoTip, Tooltip } from '@/components/ui/tooltip';

/** The placeholder machinery falls back to when the engagement carries no SIC. */
const DEFAULT_MACHINERY_LIFE = CATEGORY_BY_KEY['machinery-equipment']?.schedule as number;

/**
 * What the classifications are worth, run through the district's own arithmetic.
 *
 * This is the number the pitch is built on, so the card is built to be argued
 * with: every figure names where it came from, the published schedule is a link,
 * and anything the engine could not price is shown as a gap rather than folded
 * into a total that would look better for it.
 */
export function ValuationCard({ engagementId }: { engagementId: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['engagement-valuation', engagementId],
    queryFn: () => api.valuation(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-56 w-full" />;

  return (
    <Card>
      <CardHeader title="Schedule value" description={<ScheduleNote valuation={data} />} />
      {data.schedule === null ? (
        <EmptyState title="No published schedule for this engagement">
          {data.jurisdictionId
            ? `Nothing is loaded for ${data.jurisdictionId}. Assets stay classified and unvalued rather than being priced against another county's arithmetic.`
            : 'Set a jurisdiction on this engagement and the assets will be valued against its published schedules.'}
        </EmptyState>
      ) : (
        <>
          <Headline valuation={data} />
          <CategoryTable valuation={data} />
          <Coverage valuation={data} />
        </>
      )}
    </Card>
  );
}

function ScheduleNote({ valuation }: { valuation: EngagementValuation }) {
  if (!valuation.schedule) {
    return <>Assets priced on the appraisal district&rsquo;s own published schedules.</>;
  }
  const { schedule } = valuation;
  return (
    <>
      Original cost × index factor × percent good, on{' '}
      <a
        href={schedule.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 hover:text-[var(--color-ink)]"
      >
        {schedule.title}
        <ExternalLink size={10} strokeWidth={2} />
      </a>{' '}
      (p. {schedule.pages}).{' '}
      {/* Which machinery life applied. Texas reads it from the line of business
          rather than from the machine, so this one fact moves the machinery
          total by a third or more — it belongs beside the number, not in a
          field at the top of the page. */}
      {valuation.sic ? (
        <>
          Machinery on the {valuation.sic.machineryLife}-year life for SIC {valuation.sic.code} (
          {/* The guide prints these in caps; lowercasing matches the report. */}
          {valuation.sic.description.toLowerCase()}), not the {valuation.sic.defaultLife}-year
          default.{' '}
        </>
      ) : (
        <span className="text-[var(--color-warning)]">
          No SIC set, so machinery falls back to the {DEFAULT_MACHINERY_LIFE}-year placeholder
          rather than a published life.{' '}
        </span>
      )}
      {schedule.isFallbackYear ? (
        <span className="text-[var(--color-warning)]">
          Valued on the {schedule.taxYear} schedule — nothing is published yet for{' '}
          {valuation.taxYear}.
        </span>
      ) : null}
    </>
  );
}

function Headline({ valuation }: { valuation: EngagementValuation }) {
  const ratio = valuation.originalCost > 0 ? valuation.marketValue / valuation.originalCost : null;

  const tiles = [
    {
      label: 'Rendered cost',
      value: money(valuation.originalCost),
      help: `Original cost of the ${count(valuation.valuedCount)} assets that carry a settled classification and are not disposed or excluded.`,
    },
    {
      label: 'Schedule value',
      value: money(valuation.marketValue),
      strong: true,
      help: "What the district's own tables produce from that cost. This is the market value a rendition supports.",
    },
    {
      label: 'Of cost',
      value: percent(ratio, 0),
      help: 'Schedule value as a share of original cost — how far the register has depreciated in the district’s model.',
    },
    {
      label: 'Fully depreciated',
      value: money(valuation.flooredMarketValue),
      help: `${count(valuation.flooredCount)} ${plural(valuation.flooredCount, 'asset')} older than the schedule publishes, so they sit at the floor. If the client is still rendering these at cost, that gap is the finding.`,
    },
  ];

  return (
    <>
      {/* The explainer sits on the label rather than wrapping the tile: a
          Tooltip trigger is an inline-flex span, and as a grid item it shrinks
          to its content, leaving the cell background showing through. */}
      <div className="grid grid-cols-2 gap-px border-b border-[var(--color-hairline)] bg-[var(--color-hairline)] lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-[var(--color-surface)] px-5 py-3">
            <p className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
              {tile.label}
              <InfoTip title={tile.label} content={tile.help} size={11} />
            </p>
            <p
              className={
                tile.strong
                  ? 'tabular mt-1 text-2xl font-semibold text-[var(--color-series-1)]'
                  : 'tabular mt-1 text-xl font-semibold'
              }
            >
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      {valuation.excludedCount > 0 || valuation.disposedCount > 0 ? (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-b border-[var(--color-hairline)] bg-[var(--color-plane)] px-5 py-2.5 text-xs">
          {valuation.excludedCount > 0 ? (
            <p>
              <span className="font-medium">{count(valuation.excludedCount)}</span>{' '}
              {plural(valuation.excludedCount, 'asset')} carrying{' '}
              <span className="tabular font-medium">
                {moneyExact(valuation.excludedOriginalCost)}
              </span>{' '}
              of cost do not belong on this rendition at all.
            </p>
          ) : null}
          {valuation.disposedCount > 0 ? (
            <p>
              <span className="font-medium">{count(valuation.disposedCount)}</span> disposed{' '}
              {plural(valuation.disposedCount, 'asset')} carrying{' '}
              <span className="tabular font-medium">
                {moneyExact(valuation.disposedOriginalCost)}
              </span>{' '}
              are still on the register.
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function CategoryTable({ valuation }: { valuation: EngagementValuation }) {
  if (valuation.byCategory.length === 0) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">
            <th className="px-5 py-2 text-left font-medium">Category</th>
            <th className="px-5 py-2 text-right font-medium">Assets</th>
            <th className="px-5 py-2 text-right font-medium">Original cost</th>
            <th className="px-5 py-2 text-right font-medium">Schedule value</th>
            <th className="px-5 py-2 text-right font-medium">Of cost</th>
          </tr>
        </thead>
        <tbody>
          {valuation.byCategory.map((row) => (
            <tr key={row.categoryKey} className="border-b border-[var(--color-hairline)]">
              <td className="px-5 py-2">
                <span className="flex items-center gap-2">
                  {row.label}
                  {row.kind === 'exclusion' ? <Badge tone="warning">off rendition</Badge> : null}
                  {row.flooredCount > 0 ? (
                    <Tooltip
                      title="At the schedule floor"
                      content={`${count(row.flooredCount)} of these are older than the schedule publishes and are fully depreciated in the district's own model.`}
                    >
                      <span className="cursor-help text-[11px] text-[var(--color-ink-muted)]">
                        {count(row.flooredCount)} at floor
                      </span>
                    </Tooltip>
                  ) : null}
                </span>
              </td>
              <td className="tabular px-5 py-2 text-right">{count(row.assetCount)}</td>
              <td className="tabular px-5 py-2 text-right">{moneyExact(row.originalCost)}</td>
              <td className="tabular px-5 py-2 text-right font-medium">
                {row.kind === 'exclusion' ? '—' : moneyExact(row.marketValue)}
              </td>
              <td className="tabular px-5 py-2 text-right text-[var(--color-ink-secondary)]">
                {row.kind === 'exclusion' || row.originalCost === 0
                  ? '—'
                  : percent(row.marketValue / row.originalCost, 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What is missing, said out loud. A total that quietly omits a third of the
 * register is worse than no total, because it looks complete.
 */
function Coverage({ valuation }: { valuation: EngagementValuation }) {
  const notes: string[] = [];
  if (valuation.needsReviewCount > 0) {
    notes.push(
      `${count(valuation.needsReviewCount)} ${plural(valuation.needsReviewCount, 'asset')} still in the review queue and not priced`,
    );
  }
  if (valuation.unclassifiedCount > 0) {
    notes.push(`${count(valuation.unclassifiedCount)} not yet classified`);
  }
  if (notes.length === 0 && valuation.gaps.length === 0) return null;

  return (
    <div className="px-5 py-3 text-xs text-[var(--color-ink-secondary)]">
      {notes.length > 0 ? (
        <p>
          This total excludes {notes.join(' and ')} — a savings figure built on unreviewed guesses
          is not one worth showing a client.
        </p>
      ) : null}
      {valuation.gaps.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {valuation.gaps.map((gap) => (
            <li key={gap.reason}>
              <span className="tabular font-medium">{count(gap.count)}</span>{' '}
              {plural(gap.count, 'asset')} ({moneyExact(gap.originalCost)} of cost) could not be
              valued: {gap.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
