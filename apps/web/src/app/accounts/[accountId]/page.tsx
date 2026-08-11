'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Check, Minus, X } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { SEGMENTS, type SegmentKey } from '@tangible/types';
import { AXIS, ChartFrame, GRID, TooltipCard } from '@/components/charts/chart-parts';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { useScope } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count, money, moneyExact, percent } from '@/lib/format';

export default function AccountPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <AccountDetail />
    </Suspense>
  );
}

function AccountDetail() {
  const params = useParams<{ accountId: string }>();
  const scope = useScope();
  const accountId = decodeURIComponent(params.accountId);
  const scopeQuery = `jurisdictionId=${scope.jurisdictionId}&taxYear=${scope.taxYear}`;

  const { data, isPending, error } = useQuery({
    queryKey: ['account', scope.jurisdictionId, scope.taxYear, accountId],
    queryFn: () => api.account(accountId, scope.jurisdictionId, scope.taxYear),
    enabled: Boolean(scope.jurisdictionId),
  });

  if (error) return <Card><ErrorState error={error} /></Card>;
  if (isPending || !data) return <Skeleton className="h-96 w-full" />;

  return (
    <div className="space-y-4">
      <Link
        href={`/accounts?${scopeQuery}`}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
      >
        <ArrowLeft size={15} /> Back to accounts
      </Link>

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">{data.ownerName ?? 'Unnamed owner'}</h1>
            <p className="tabular mt-1 text-sm text-[var(--color-ink-secondary)]">
              Account {data.accountId}
              {data.siteCity ? ` · ${data.siteCity}` : ''}
              {data.stateClass ? ` · class ${data.stateClass}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {data.segments.map((key) => (
              <Badge key={key} tone={key === 'core_icp' ? 'accent' : 'neutral'}>
                {SEGMENTS[key as SegmentKey]?.label ?? key}
              </Badge>
            ))}
          </div>
        </div>

        <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Figure label="Assessed value" value={moneyExact(data.latestAssessedValue)} />
          <Figure label="Estimated tax / yr" value={moneyExact(data.estimatedAnnualTax)} />
          <Figure
            label="Penalty / yr"
            value={moneyExact(data.estimatedAnnualPenalty)}
            tone={data.estimatedAnnualPenalty ? 'critical' : undefined}
          />
          <Figure label="Penalty to date" value={moneyExact(data.estimatedLifetimePenalty)} />
        </dl>

        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-[var(--color-hairline)] pt-5">
          <SmallStat label="Years on roll" value={count(data.yearsOnRoll)} />
          <SmallStat label="Years unfiled" value={count(data.yearsUnfiled)} />
          <SmallStat label="Years filed late" value={count(data.yearsFiledLate)} />
          <SmallStat
            label="Unfiled share"
            value={percent(data.yearsOnRoll ? data.yearsUnfiled / data.yearsOnRoll : null, 0)}
          />
          <SmallStat label="Tax agent" value={data.hasAgent ? 'On record' : 'None'} />
          <SmallStat label="Value pattern" value={data.isFrozen ? 'Frozen' : data.neverDeclines ? 'Never declines' : 'Moves'} />
        </dl>
      </Card>

      <ChartFrame
        title="Assessed value by year"
        subtitle="Equipment depreciates; a flat line is the signature of a value nobody has updated"
        height={220}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.history} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="taxYear" {...AXIS} axisLine={{ stroke: 'var(--color-axis)' }} />
            <YAxis {...AXIS} axisLine={false} width={56} tickFormatter={(v) => money(v)} />
            <Tooltip
              cursor={{ fill: 'color-mix(in oklab, var(--color-ink) 5%, transparent)' }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <TooltipCard
                    title={`Tax year ${label}`}
                    rows={[
                      { label: 'Assessed value', value: moneyExact(Number(payload[0]?.value)) },
                      { label: 'Estimated tax', value: moneyExact(payload[0]?.payload?.estimatedTax) },
                      { label: 'Penalty', value: moneyExact(payload[0]?.payload?.estimatedPenalty) },
                      {
                        label: 'Rendition',
                        value:
                          payload[0]?.payload?.renditionFiled === null
                            ? 'Not published'
                            : payload[0]?.payload?.renditionFiled
                              ? payload[0]?.payload?.renditionLate
                                ? 'Filed late'
                                : 'Filed'
                              : 'Not filed',
                      },
                    ]}
                  />
                ) : null
              }
            />
            <Bar isAnimationActive={false} dataKey="assessedValue" fill="var(--color-series-1)" radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <Card>
        <CardHeader
          title="Year by year"
          description="The same data as the chart, in a form you can read exactly."
        />
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--color-hairline)]">
                {['Tax year', 'Assessed value', 'Estimated tax', 'Rendition', 'Penalty'].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`px-5 py-2.5 text-[11px] font-medium tracking-wide text-[var(--color-ink-secondary)] uppercase ${i === 0 || i === 3 ? 'text-left' : 'text-right'}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.history.map((point) => (
                <tr key={point.taxYear} className="border-b border-[var(--color-hairline)] last:border-0">
                  <td className="tabular px-5 py-2.5 font-medium">{point.taxYear}</td>
                  <td className="tabular px-5 py-2.5 text-right">{moneyExact(point.assessedValue)}</td>
                  <td className="tabular px-5 py-2.5 text-right text-[var(--color-ink-secondary)]">
                    {moneyExact(point.estimatedTax)}
                  </td>
                  <td className="px-5 py-2.5">
                    <RenditionCell filed={point.renditionFiled} late={point.renditionLate} />
                  </td>
                  <td className="tabular px-5 py-2.5 text-right font-medium">
                    {moneyExact(point.estimatedPenalty)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="px-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        Figures are derived from the public appraisal roll at a{' '}
        {percent(scope.current?.blendedTaxRate, 2)} blended rate. Renditions themselves are
        confidential in Texas — nothing here reflects the contents of a filing, only whether the
        district recorded one.
      </p>
    </div>
  );
}

function RenditionCell({ filed, late }: { filed: boolean | null; late: boolean | null }) {
  if (filed === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
        <Minus size={13} /> Not published
      </span>
    );
  }
  if (!filed) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--color-critical)]">
        <X size={13} strokeWidth={2.5} /> Not filed
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs ${late ? 'text-[var(--color-serious)]' : 'text-[var(--color-good)]'}`}
    >
      <Check size={13} strokeWidth={2.5} /> {late ? 'Filed late' : 'Filed'}
    </span>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'critical' }) {
  return (
    <div>
      <dt className="text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">{label}</dt>
      <dd
        className={`tabular mt-1 text-xl font-semibold ${tone === 'critical' ? 'text-[var(--color-critical)]' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">{label}</dt>
      <dd className="tabular mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}
