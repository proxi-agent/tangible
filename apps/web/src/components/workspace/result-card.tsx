'use client';

import { useQuery } from '@tanstack/react-query';
import type { EngagementResult, OutcomePhase, SiteOutcome } from '@tangible/types';
import { api } from '@/lib/api';
import { dayShort, moneyExact, plural } from '@/lib/format';
import { Tooltip } from '@/components/ui/tooltip';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * The engagement's scoreboard: what went out, what came back, where it ended.
 *
 * Everything on this card is derived from records other cards wrote — the
 * filing, the notice, the resolution, the motion — which is the point. The
 * question "what did the year come to" was, until now, answered by scrolling
 * the page and doing arithmetic in one's head, and the arithmetic has a trap
 * in it: rendered cost and appraised value are different quantities, and the
 * only defensible difference is noticed against standing. This card computes
 * exactly that one and refuses the other.
 *
 * Absent before anything has gone out. A scoreboard for a game that has not
 * started is a to-do list wearing the wrong clothes, and the season board
 * above is already the to-do list.
 */
export function ResultCard({ engagementId }: { engagementId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement-result', engagementId],
    queryFn: () => api.engagementResult(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-24 w-full" />;
  if (data.sites.every((site) => site.phase === 'unfiled')) return null;

  return (
    <Card>
      <CardHeader title={`What ${data.taxYear} came to`} description={data.standing} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-xs">
          <thead>
            <tr className="border-b border-[var(--color-hairline)] text-left text-[10px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
              <th className="px-5 py-2">Site</th>
              <th className="px-3 py-2 text-right">
                <Tooltip content="Historical cost on the return that went out — the client's own figure, in the client's own units.">
                  <span>Rendered cost</span>
                </Tooltip>
              </th>
              <th className="px-3 py-2 text-right">
                <Tooltip content="The district's appraised value off the notice. A different quantity from the cost beside it, and the two are never subtracted.">
                  <span>Noticed</span>
                </Tooltip>
              </th>
              <th className="px-3 py-2 text-right">
                <Tooltip content="The appraised value on the roll today, once nothing can move it — or nothing, while the year is still being argued.">
                  <span>Standing</span>
                </Tooltip>
              </th>
              <th className="px-3 py-2 text-right">
                <Tooltip content="Noticed minus standing: appraised value the season took off, in the district's own units. Assessed value, never tax dollars.">
                  <span>Taken off</span>
                </Tooltip>
              </th>
              <th className="px-5 py-2 text-right">Where it stands</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-hairline)]">
            {data.sites.map((site) => (
              <Row key={site.locationId} site={site} />
            ))}
          </tbody>
          {data.sites.length > 1 ? <Totals data={data} /> : null}
        </table>
      </div>
    </Card>
  );
}

const PHASE: Record<OutcomePhase, { label: string; tone: 'neutral' | 'accent' | 'warning' | 'good' }> = {
  unfiled: { label: 'not started', tone: 'neutral' },
  'awaiting-notice': { label: 'awaiting notice', tone: 'neutral' },
  'protest-window': { label: 'window open', tone: 'warning' },
  'protest-live': { label: 'protested', tone: 'accent' },
  'appeal-window': { label: '42.21 running', tone: 'warning' },
  settled: { label: 'settled', tone: 'good' },
};

function Row({ site }: { site: SiteOutcome }) {
  const phase = PHASE[site.phase];
  return (
    <tr>
      <td className="px-5 py-2">
        <div className="font-medium">{site.label}</div>
        {site.accountId ? (
          <div className="tabular text-[10px] text-[var(--color-ink-muted)]">
            Account {site.accountId}
          </div>
        ) : null}
      </td>
      <Figure value={site.renderedCost} />
      <Figure value={site.noticedValue} />
      {/* "moving" only for a year that is actually in motion — an unfiled
          site has not started, and the two must not read alike. */}
      <Figure
        value={site.standingValue}
        pending={
          site.phase === 'awaiting-notice' ||
          site.phase === 'protest-window' ||
          site.phase === 'protest-live'
        }
      />
      <Reduction site={site} />
      <td className="px-5 py-2 text-right">
        <Tooltip content={site.standing}>
          <span className="inline-flex items-center gap-1.5">
            <Badge tone={phase.tone}>{phase.label}</Badge>
            {site.nextDeadline ? (
              <span className="tabular text-[10px] whitespace-nowrap text-[var(--color-ink-muted)]">
                to {dayShort(site.nextDeadline)}
              </span>
            ) : null}
          </span>
        </Tooltip>
      </td>
    </tr>
  );
}

function Figure({ value, pending = false }: { value: number | null; pending?: boolean }) {
  return (
    <td className="tabular px-3 py-2 text-right whitespace-nowrap">
      {value === null ? (
        <span className="text-[var(--color-ink-muted)]">{pending ? '— moving' : '—'}</span>
      ) : (
        moneyExact(value)
      )}
    </td>
  );
}

/**
 * The one difference this screen computes.
 *
 * Green only when positive and real. A zero is printed as a dash rather than
 * $0, because "the season took nothing off here" and "the season is not done
 * here" must not read alike — the dash beside a settled badge is the first,
 * the dash beside a moving one is the second, and the badge disambiguates.
 */
function Reduction({ site }: { site: SiteOutcome }) {
  if (site.reduction === null || site.reduction === 0) {
    return (
      <td className="tabular px-3 py-2 text-right text-[var(--color-ink-muted)]">—</td>
    );
  }
  const up = site.reduction > 0;
  return (
    <td
      className={`tabular px-3 py-2 text-right whitespace-nowrap ${
        up ? 'text-[var(--color-good)]' : 'text-[var(--color-critical)]'
      }`}
    >
      {up ? '−' : '+'}
      {moneyExact(Math.abs(site.reduction))}
    </td>
  );
}

/**
 * Summed only over rows where the figure exists, and the footnote says how
 * many that was. A total over three of five sites offered as the engagement's
 * number is a figure that gets repeated to a client and then corrected.
 */
function Totals({ data }: { data: EngagementResult }) {
  const partial =
    data.renderedCount < data.siteCount ||
    data.noticedCount < data.siteCount ||
    data.standingCount < data.siteCount;
  return (
    <tfoot>
      <tr className="border-t border-[var(--color-hairline)] font-medium">
        <td className="px-5 py-2 text-[var(--color-ink-secondary)]">
          {data.settledCount} of {data.siteCount} {plural(data.siteCount, 'site')} settled
        </td>
        <Figure value={data.renderedTotal} />
        <Figure value={data.noticedTotal} />
        <Figure value={data.standingTotal} />
        <td
          className={`tabular px-3 py-2 text-right whitespace-nowrap ${
            (data.reductionTotal ?? 0) > 0
              ? 'text-[var(--color-good)]'
              : 'text-[var(--color-ink-muted)]'
          }`}
        >
          {data.reductionTotal === null || data.reductionTotal === 0
            ? '—'
            : `−${moneyExact(data.reductionTotal)}`}
        </td>
        <td className="px-5 py-2 text-right text-[10px] font-normal text-[var(--color-ink-muted)]">
          {partial ? 'sums cover only the rows with a figure' : null}
        </td>
      </tr>
    </tfoot>
  );
}
