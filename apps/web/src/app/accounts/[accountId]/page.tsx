'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
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
import { HistoryTable } from '@/components/history-table';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
// Recharts owns the name `Tooltip` in this file; ours is the explainer kind.
import { InfoTip, Tooltip as HelpTooltip } from '@/components/ui/tooltip';
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
  const scopeQuery = scope.linkQuery;

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
        className="group inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-secondary)] underline-offset-2 hover:text-[var(--color-ink)] hover:underline"
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
            {data.segments.map((key) => {
              const definition = SEGMENTS[key as SegmentKey];
              const badge = (
                <Badge key={key} tone={key === 'core_icp' ? 'accent' : 'neutral'}>
                  {definition?.label ?? key}
                </Badge>
              );
              return definition ? (
                <HelpTooltip
                  key={key}
                  title={definition.label}
                  content={
                    <>
                      <p>{definition.description}</p>
                      {definition.caveat ? (
                        <p className="mt-1.5 border-t border-[var(--color-hairline)] pt-1.5 text-[var(--color-ink-muted)]">
                          {definition.caveat}
                        </p>
                      ) : null}
                    </>
                  }
                >
                  {badge}
                </HelpTooltip>
              ) : (
                badge
              );
            })}
          </div>
        </div>

        <dl className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Figure
            label="Equipment value"
            value={moneyExact(data.latestAssessedValue)}
            help="What the county says this location’s equipment, furniture and inventory are worth this year."
          />
          <Figure
            label="Tax / yr"
            value={moneyExact(data.estimatedAnnualTax)}
            help="The value above at the county’s blended tax rate. An estimate — the exact bill depends on which taxing units cover the address."
          />
          <Figure
            label="Penalty / yr"
            value={moneyExact(data.estimatedAnnualPenalty)}
            tone={data.estimatedAnnualPenalty ? 'critical' : undefined}
            help="The extra 10% charged for not filing the annual equipment declaration. Pure waste — filing the form removes it."
          />
          <Figure
            label="Penalty to date"
            value={moneyExact(data.estimatedLifetimePenalty)}
            help="Every missed year’s penalty added up over the period covered by this data."
          />
        </dl>

        <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3 border-t border-[var(--color-hairline)] pt-5">
          <SmallStat
            label="Years on record"
            value={count(data.yearsOnRoll)}
            help="How many tax years this location appears in the county's published data."
          />
          <SmallStat
            label="Years missed"
            value={count(data.yearsUnfiled)}
            help="Years with no equipment declaration recorded — each one carrying its own 10% penalty."
          />
          <SmallStat
            label="Years filed late"
            value={count(data.yearsFiledLate)}
            help="Filed, but after the April 15 deadline. Late still carries the penalty unless the county granted an extension."
          />
          <SmallStat
            label="Miss rate"
            value={percent(data.yearsOnRoll ? data.yearsUnfiled / data.yearsOnRoll : null, 0)}
            help="Missed years as a share of years on record. A high rate is habit, not an accident."
          />
          <SmallStat
            label="Tax agent"
            value={data.hasAgent ? 'On record' : 'None'}
            help="Whether a tax firm is already registered with the county to act for this business."
          />
          <SmallStat
            label="Value pattern"
            value={data.isFrozen ? 'Frozen' : data.neverDeclines ? 'Never declines' : 'Moves'}
            help="Equipment depreciates, so a value that never moves usually means nobody has updated it — often because the business stopped reporting."
          />
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
        <HistoryTable history={data.history} />
      </Card>

      <p className="px-1 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        Figures are derived from the public appraisal roll at a{' '}
        {percent(scope.current?.blendedTaxRate, 2)} blended rate. The filings themselves are
        confidential in both states — nothing here reflects the contents of a return, only whether
        the county recorded one.
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
  help,
}: {
  label: string;
  value: string;
  tone?: 'critical';
  help: string;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">
        {label}
        <InfoTip title={label} content={help} size={11} />
      </dt>
      <dd
        className={`tabular mt-1 text-xl font-semibold ${tone === 'critical' ? 'text-[var(--color-critical)]' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function SmallStat({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">
        {label}
        <InfoTip title={label} content={help} size={11} />
      </dt>
      <dd className="tabular mt-0.5 text-sm font-medium">{value}</dd>
    </div>
  );
}
