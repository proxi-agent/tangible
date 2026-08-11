'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DistributionBucket } from '@tangible/types';
import { count, money, moneyExact } from '@/lib/format';
import { AXIS, ChartFrame, GRID, Legend, MARK_SEPARATOR, TooltipCard } from './chart-parts';

const FILED = 'var(--color-series-1)';
const UNFILED = 'var(--color-series-2)';
const PENALTY = 'var(--color-series-1)';

/** Where the accounts sit relative to the exemption, and who inside each band files. */
export function ValueDistributionChart({ data }: { data: DistributionBucket[] }) {
  const rows = data.map((bucket) => ({
    ...bucket,
    filedAccountCount: Math.max(0, bucket.accountCount - bucket.unfiledAccountCount),
  }));

  return (
    <ChartFrame
      title="Accounts by assessed value"
      subtitle="The first band sits below the $125K exemption and owes nothing"
      legend={
        <Legend
          items={[
            { label: 'Filed', color: FILED },
            { label: 'Did not file', color: UNFILED },
          ]}
        />
      }
      height={260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="label"
            {...AXIS}
            axisLine={{ stroke: 'var(--color-axis)' }}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={56}
          />
          <YAxis {...AXIS} axisLine={false} width={48} tickFormatter={(v) => count(v)} />
          <Tooltip
            cursor={{ fill: 'color-mix(in oklab, var(--color-ink) 5%, transparent)' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipCard
                  title={String(label)}
                  rows={[
                    { label: 'Filed', value: count(Number(payload[0]?.value)), color: FILED },
                    { label: 'Did not file', value: count(Number(payload[1]?.value)), color: UNFILED },
                    { label: 'Assessed value', value: money(payload[0]?.payload?.totalAssessedValue) },
                    { label: 'Penalty exposure', value: money(payload[0]?.payload?.estimatedPenalty) },
                  ]}
                />
              ) : null
            }
          />
          <Bar isAnimationActive={false} dataKey="filedAccountCount" stackId="a" fill={FILED} {...MARK_SEPARATOR} />
          <Bar
            isAnimationActive={false}
            dataKey="unfiledAccountCount"
            stackId="a"
            fill={UNFILED}
            radius={[4, 4, 0, 0]}
            {...MARK_SEPARATOR}
          />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

const CLASS_LABELS: Record<string, string> = {
  commercial: 'Commercial (L1)',
  industrial: 'Industrial (L2)',
  specialInventory: 'Dealer inventory (S)',
  utility: 'Utility / pipeline (J)',
  exempt: 'Exempt (X)',
  unclassified: 'Unclassified',
};

/**
 * Penalty exposure by property class. This is the chart that says which slices
 * a rendition product can actually serve: dealers file monthly declarations and
 * utilities are valued separately, so their exposure is not addressable.
 */
export function ClassDistributionChart({ data }: { data: DistributionBucket[] }) {
  const rows = data.map((bucket) => ({
    ...bucket,
    label: CLASS_LABELS[bucket.label] ?? bucket.label,
  }));

  return (
    <ChartFrame
      title="Penalty exposure by property class"
      subtitle="Only commercial and industrial classes file renditions"
      height={260}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid {...GRID} vertical horizontal={false} />
          <XAxis type="number" {...AXIS} axisLine={false} tickFormatter={(v) => money(v)} />
          <YAxis
            type="category"
            dataKey="label"
            {...AXIS}
            axisLine={false}
            width={150}
            interval={0}
          />
          <Tooltip
            cursor={{ fill: 'color-mix(in oklab, var(--color-ink) 5%, transparent)' }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TooltipCard
                  title={String(label)}
                  rows={[
                    { label: 'Penalty exposure', value: moneyExact(Number(payload[0]?.value)) },
                    { label: 'Accounts', value: count(payload[0]?.payload?.accountCount) },
                    { label: 'Did not file', value: count(payload[0]?.payload?.unfiledAccountCount) },
                  ]}
                />
              ) : null
            }
          />
          <Bar isAnimationActive={false} dataKey="estimatedPenalty" fill={PENALTY} radius={[0, 4, 4, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
