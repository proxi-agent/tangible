'use client';

import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { useState } from 'react';
import { ruleFor } from '@tangible/savings';
import type { AcceptanceBoard, AcceptanceEvidenceView } from '@tangible/types';
import { api } from '@/lib/api';
import { count, percent, plural } from '@/lib/format';
import { Segmented } from '@/components/ui/controls';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * What districts actually concede, next to what the engine assumed they would.
 *
 * Every expected-recovery figure this product has ever printed was one year of
 * tax multiplied by three probabilities, and one of the three was a constant
 * somebody wrote down from experience. This screen is where that constant stops
 * being a constant — and, just as importantly, where it can be seen not to have
 * moved yet. Two columns say it: the rate the engine assumed, and the rate it
 * uses now. A firm in its first season sees those columns agree, and that is
 * the honest picture rather than a missing feature.
 *
 * The rates are pooled across the whole practice. That pooling is the asset the
 * doc is describing when it says this is the dataset no incumbent has: no one
 * client settles enough positions to learn anything, and every client after the
 * first is priced with what the ones before it found out.
 */
export function AcceptanceCard() {
  const [scope, setScope] = useState<string>('pooled');
  const board = useQuery({ queryKey: ['acceptance'], queryFn: () => api.acceptance() });

  if (board.error) return <ErrorState error={board.error} />;
  if (!board.data) return <Loading />;

  const data = board.data;
  if (data.observations === 0) return <Nothing />;

  const district = data.districts.find((row) => row.jurisdictionId === scope);
  const rows = district ? district.evidence : data.pooled;

  return (
    <Card>
      <CardHeader
        title="What districts concede"
        icon={Scale}
        description="Acceptance rates learned from positions this practice has closed, shrunk toward the rate we assumed in proportion to how few of them there are."
        help="Only positions a district answered on their own terms are counted. A settlement split across claims in proportion to what each asked for tells us nothing about any one argument, and a position withdrawn before the district ruled tells us nothing at all — both are excluded here and reported on the engagement."
        action={
          data.districts.length > 0 ? (
            <Segmented
              size="sm"
              ariaLabel="Which district"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'pooled', label: 'Everywhere' },
                ...data.districts.map((row) => ({
                  value: row.jurisdictionId ?? 'pooled',
                  label: row.label,
                })),
              ]}
            />
          ) : null
        }
      />

      <StatGrid>
        <StatCell>
          <Stat
            label="Closed positions"
            value={count(data.observations)}
            help="Claims a district answered position by position, across every client."
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Rates in use"
            value={count(data.measured)}
            help="Finding kinds where there is enough to override the assumed rate on a report."
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Districts"
            value={count(data.districts.length)}
            help="Appraisal districts with at least one closed position of their own."
          />
        </StatCell>
      </StatGrid>

      {district ? (
        <div className="border-t border-[var(--color-hairline)] px-5 py-3 text-xs text-[var(--color-ink-muted)]">
          {district.label}: {count(district.observations)}{' '}
          {plural(district.observations, 'closed position')} of its own. Every rate below still
          starts from what the other districts did and is moved by these.
        </div>
      ) : null}

      <Table rows={rows} scoped={district !== undefined} />

      {data.measured === 0 ? (
        <div className="px-5 pb-5">
          <Callout tone="neutral" title="Nothing has replaced a rate yet">
            Positions are being recorded, but no finding kind has enough closed answers to override
            the rate the engine assumes. Reports still say their acceptance rates are judgement,
            because they are.
          </Callout>
        </div>
      ) : null}
    </Card>
  );
}

function Table({ rows, scoped }: { rows: AcceptanceEvidenceView[]; scoped: boolean }) {
  if (rows.length === 0) {
    return (
      <div className="px-5 py-6 text-sm text-[var(--color-ink-muted)]">
        No closed positions in this district yet.
      </div>
    );
  }
  const sorted = [...rows].sort(
    (a, b) => Number(b.measured) - Number(a.measured) || b.observations - a.observations,
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] text-xs">
        <thead>
          <tr className="text-2xs border-y border-[var(--color-hairline)] text-left font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            <th className="px-5 py-2">Argument</th>
            <th className="px-3 py-2 text-right">Assumed</th>
            <th className="px-3 py-2 text-right">In use</th>
            <th className="px-3 py-2 text-right">
              <Tooltip content="An approximate 95% band on the rate. It is taken from the level that produced the number — a district's own outcomes where it has them — so it widens when a rate rests on very little, which is exactly when it should not be read as a point estimate.">
                <span>Band</span>
              </Tooltip>
            </th>
            <th className="px-3 py-2 text-right">
              <Tooltip content="Closed positions of this kind everywhere, and how many of them were in the district being shown. A district with none of its own still gets a rate — moved by what every other district did, which is weaker evidence and not no evidence.">
                <span>{scoped ? 'Here / all' : 'Positions'}</span>
              </Tooltip>
            </th>
            <th className="px-5 py-2">Standing</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-hairline)]">
          {sorted.map((row) => (
            <tr key={row.findingKey} className="align-top">
              <td className="px-5 py-2.5">
                <div>{ruleFor(row.findingKey)?.title ?? row.findingKey}</div>
                <div className="mt-0.5 text-[var(--color-ink-muted)]">{row.findingKey}</div>
              </td>
              <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-muted)]">
                {percent(row.prior)}
              </td>
              <td className="tabular px-3 py-2.5 text-right font-medium">{percent(row.rate)}</td>
              <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-muted)]">
                {percent(row.interval[0])}–{percent(row.interval[1])}
              </td>
              <td className="tabular px-3 py-2.5 text-right">
                {scoped
                  ? `${count(row.localObservations)} / ${count(row.observations)}`
                  : count(row.observations)}
              </td>
              <td className="px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={row.measured ? 'good' : 'neutral'}>
                    {row.measured ? 'In use' : 'Watching'}
                  </Badge>
                  <span className="text-[var(--color-ink-muted)]">{row.basis}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The first-season state, and it gets a real explanation rather than a dash.
 *
 * "No data" here does not mean something is broken or unconfigured — it means
 * the practice has not yet had a district answer a position. The card says what
 * would change it, because the thing that changes it is work someone is already
 * doing.
 */
function Nothing() {
  return (
    <Card>
      <CardHeader
        title="What districts concede"
        icon={Scale}
        description="Acceptance rates learned from positions this practice has closed."
      />
      <EmptyState title="No district has answered a position yet">
        Every acceptance rate on every report is still the built-in estimate, and each report says
        so. Recording what a district allowed — on a protest resolution or a settlement — is what
        starts replacing them. Positions split pro-rata across a lump-sum settlement never will:
        they are reportable, but they are not an answer about any one argument.
      </EmptyState>
    </Card>
  );
}

function Loading() {
  return (
    <Card>
      <CardHeader title="What districts concede" icon={Scale} />
      <div className="space-y-3 p-5">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </Card>
  );
}
