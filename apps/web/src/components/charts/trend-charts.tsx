'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { YearTrendPoint } from '@tangible/types';
import { count, percent } from '@/lib/format';
import { AXIS, ChartFrame, GRID, Legend, MARK_SEPARATOR, TooltipCard } from './chart-parts';

const FILED = 'var(--color-series-1)';
const UNFILED = 'var(--color-series-2)';

/**
 * Two charts, not one with two y-axes. Account counts and a percentage are
 * different scales, and overlaying them on twin axes invents relationships that
 * are not in the data.
 */
export function TrendCharts({ data }: { data: YearTrendPoint[] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartFrame
        title="Taxable accounts by year"
        subtitle="Split by whether a rendition was recorded"
        legend={
          <Legend
            items={[
              { label: 'Filed', color: FILED },
              { label: 'Did not file', color: UNFILED },
            ]}
          />
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="taxYear" {...AXIS} axisLine={{ stroke: 'var(--color-axis)' }} />
            <YAxis {...AXIS} axisLine={false} width={48} tickFormatter={(v) => count(v)} />
            <Tooltip
              cursor={{ fill: 'color-mix(in oklab, var(--color-ink) 5%, transparent)' }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={`Tax year ${label}`}
                    rows={[
                      { label: 'Filed', value: count(Number(payload[0]?.value)), color: FILED },
                      { label: 'Did not file', value: count(Number(payload[1]?.value)), color: UNFILED },
                      { label: 'Filing rate', value: percent(payload[0]?.payload?.filingRate) },
                    ]}
                  />
                ) : null
              }
            />
            <Bar isAnimationActive={false} dataKey="filedAccounts" stackId="a" fill={FILED} {...MARK_SEPARATOR} />
            <Bar
              isAnimationActive={false}
              dataKey="unfiledAccounts"
              stackId="a"
              fill={UNFILED}
              radius={[4, 4, 0, 0]}
              {...MARK_SEPARATOR}
            />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <ChartFrame
        title="Filing rate"
        subtitle="Share of taxable accounts with a rendition on record"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="taxYear" {...AXIS} axisLine={{ stroke: 'var(--color-axis)' }} />
            <YAxis
              {...AXIS}
              axisLine={false}
              width={48}
              domain={[0, 1]}
              tickFormatter={(v) => percent(v, 0)}
            />
            <Tooltip
              cursor={{ stroke: 'var(--color-axis)', strokeWidth: 1 }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={`Tax year ${label}`}
                    rows={[
                      { label: 'Filing rate', value: percent(payload[0]?.payload?.filingRate) },
                      { label: 'Taxable', value: count(payload[0]?.payload?.taxableAccounts) },
                      { label: 'On the roll', value: count(payload[0]?.payload?.totalAccounts) },
                    ]}
                  />
                ) : null
              }
            />
            <Line
              isAnimationActive={false}
              type="monotone"
              dataKey="filingRate"
              stroke={FILED}
              strokeWidth={2}
              dot={{ r: 4, fill: FILED, stroke: 'var(--color-surface)', strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartFrame>
    </div>
  );
}
