'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  ClassDistributionChart,
  ValueDistributionChart,
} from '@/components/charts/distribution-charts';
import { TrendCharts } from '@/components/charts/trend-charts';
import { OpportunityPanel } from '@/components/opportunity-panel';
import { SegmentTiles } from '@/components/segment-tiles';
import { Card, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';
import { useScope } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count, money, moneyExact, percent } from '@/lib/format';

/**
 * The rule this page is measuring, in the words of the state it applies to.
 *
 * The statute differs enough that one sentence cannot cover both: Texas charges
 * 10% for failing to render, Florida 25% for failing to file a return, and
 * Florida's is inferred from a penalty rate rather than read off a filing flag.
 * Saying "Texas" over a Palm Beach roll is the kind of copy that quietly
 * destroys trust in every number under it.
 */
const RULE_BY_STATE: Readonly<Record<string, string>> = {
  TX: 'Texas businesses must file a list of the equipment they own with their county every year. Skip it and the county adds 10% to the bill — automatically, and again every year it stays unfiled. This is the public record of who is paying that.',
  FL: 'Florida businesses must file a tangible personal property return with the county by 1 April. Failing to file carries a 25% penalty on the tax due under s.193.072, and filing late costs 5% a month. The county does not publish who filed, so these counts are inferred from the penalty the appraiser applied.',
  default:
    'Businesses must report the equipment they own to the county each year, and the county penalises those who do not. This is the public record of who is paying that.',
};

export default function OverviewPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Overview />
    </Suspense>
  );
}

function Overview() {
  const scope = useScope();
  const { jurisdictionId, taxYear } = scope;
  const enabled = Boolean(jurisdictionId) && Number.isInteger(taxYear);
  const scopeQuery = scope.linkQuery;

  const overview = useQuery({
    queryKey: ['overview', jurisdictionId, taxYear],
    queryFn: () => api.overview(jurisdictionId, taxYear),
    enabled,
  });

  const segments = useQuery({ queryKey: ['segments'], queryFn: api.segments });
  const trend = useQuery({
    queryKey: ['trend', jurisdictionId],
    queryFn: () => api.trend(jurisdictionId),
    enabled,
  });
  const valueDist = useQuery({
    queryKey: ['value-distribution', jurisdictionId, taxYear],
    queryFn: () => api.valueDistribution(jurisdictionId, taxYear),
    enabled,
  });
  const classDist = useQuery({
    queryKey: ['class-distribution', jurisdictionId, taxYear],
    queryFn: () => api.stateClassDistribution(jurisdictionId, taxYear),
    enabled,
  });

  if (scope.error)
    return (
      <Card>
        <ErrorState error={scope.error} />
      </Card>
    );
  if (scope.isLoading) return <PageSkeleton />;

  if (!jurisdictionId || (scope.current && scope.current.accountCount === 0)) {
    return (
      <Card>
        <EmptyState title="No data loaded yet">
          Nothing has been ingested for this jurisdiction. Head to{' '}
          <Link href="/data" className="underline">
            Data sources
          </Link>{' '}
          to pull a county roll, or seed the synthetic demo county to see how the analysis works.
        </EmptyState>
      </Card>
    );
  }

  if (overview.error)
    return (
      <Card>
        <ErrorState error={overview.error} />
      </Card>
    );

  return (
    <div className="space-y-6">
      {overview.data ? (
        <Headline
          totalAccounts={overview.data.totalAccounts}
          taxableAccounts={overview.data.taxableAccounts}
          filingRate={overview.data.filingRate}
          exemption={overview.data.exemptionThreshold}
          taxRate={overview.data.blendedTaxRate}
          totalPenalty={
            overview.data.segments.find((s) => s.segment === 'unfiled')?.estimatedAnnualPenalty ?? 0
          }
          taxableValue={
            overview.data.segments.find((s) => s.segment === 'taxable')?.totalAssessedValue ?? 0
          }
          taxYear={taxYear}
          jurisdictionName={scope.current?.name ?? jurisdictionId}
          stateCode={scope.current?.state ?? ''}
        />
      ) : (
        <Skeleton className="h-28 w-full" />
      )}

      {trend.data && trend.data.length > 1 ? (
        // Both of these charts are about filing behavior. A county that does not
        // publish it gets an explanation instead of two empty axes.
        overview.data?.filingRate === null ? (
          <Card className="p-5">
            <h3 className="text-sm font-semibold tracking-tight">Filing trend unavailable</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[var(--color-ink-secondary)]">
              This district does not publish whether a rendition was filed, so there is nothing to
              chart here. Value and segment analysis below is unaffected.
            </p>
          </Card>
        ) : (
          <TrendCharts data={trend.data} />
        )
      ) : null}

      {overview.data && segments.data ? (
        <SegmentTiles overview={overview.data} segments={segments.data} scopeQuery={scopeQuery} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-44 w-full" />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {valueDist.data ? (
          <ValueDistributionChart data={valueDist.data} />
        ) : (
          <Skeleton className="h-80" />
        )}
        {classDist.data ? (
          <ClassDistributionChart data={classDist.data} />
        ) : (
          <Skeleton className="h-80" />
        )}
      </div>

      <OpportunityPanel jurisdictionId={jurisdictionId} taxYear={taxYear} />
    </div>
  );
}

function Headline({
  jurisdictionName,
  stateCode,
  taxYear,
  totalAccounts,
  taxableAccounts,
  filingRate,
  exemption,
  taxRate,
  totalPenalty,
  taxableValue,
}: {
  jurisdictionName: string;
  stateCode: string;
  taxYear: number;
  totalAccounts: number;
  taxableAccounts: number;
  filingRate: number | null;
  exemption: number;
  taxRate: number;
  totalPenalty: number;
  taxableValue: number;
}) {
  // Without filing status there is no penalty to state, and leading with "$0"
  // would read as "none owed" rather than "not published". Lead with the
  // market size instead — the one thing this data can actually support.
  const filingKnown = filingRate !== null;

  return (
    <Card className="p-6">
      <p className="text-xs font-medium tracking-wide text-[var(--color-ink-secondary)] uppercase">
        {jurisdictionName} · tax year {taxYear}
      </p>

      {filingKnown ? (
        <>
          <p className="mt-3 max-w-3xl text-2xl leading-snug font-semibold tracking-tight sm:text-3xl">
            <span className="text-[var(--color-series-2)]">{money(totalPenalty)}</span> a year in
            avoidable penalties, across {count(taxableAccounts)} business locations that owe tax on
            their equipment.
          </p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {RULE_BY_STATE[stateCode] ?? RULE_BY_STATE.default}
          </p>
        </>
      ) : (
        <>
          <p className="mt-3 max-w-3xl text-2xl leading-snug font-semibold tracking-tight sm:text-3xl">
            <span className="text-[var(--color-series-1)]">{money(taxableValue)}</span> of taxable
            business personal property across {count(taxableAccounts)} accounts.
          </p>
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            Penalty exposure cannot be measured here — this district does not publish whether a
            rendition was filed.
          </p>
        </>
      )}

      <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
        <Stat
          label="Businesses on file"
          value={count(totalAccounts)}
          help="Every business location the county has recorded equipment for this year, including the small ones that owe nothing."
        />
        <Stat
          label="Big enough to tax"
          value={`${count(taxableAccounts)} (${percent(totalAccounts ? taxableAccounts / totalAccounts : null, 0)})`}
          help="Locations whose equipment is worth more than the exemption, so they actually owe tax — and can therefore owe a penalty."
        />
        <Stat
          label="Filed on time"
          value={filingKnown ? percent(filingRate) : 'Not published'}
          help="The share that sent the county their annual equipment declaration. Some counties do not release this field at all."
        />
        <Stat
          label="Exemption"
          value={moneyExact(exemption)}
          help={
            stateCode === 'FL'
              ? 'Own less equipment than this and you owe nothing. Florida has held the tangible personal property exemption at $25,000 since 2008, and most accounts on the roll fall under it.'
              : stateCode === 'TX'
                ? 'Own less equipment than this and you owe nothing. Texas raised it from $2,500 to $125,000 in 2026, which removes most of the roll from the tax base.'
                : 'Own less equipment than this and you owe nothing. The threshold is set by state statute and changes when the legislature changes it.'
          }
        />
        <Stat
          label="Tax rate"
          value={percent(taxRate, 2)}
          help="A blended rate across the taxing units in this county — city, county, school district and so on. Every dollar figure on this page is an estimate built on it."
        />
      </dl>
    </Card>
  );
}

function Stat({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">
        {label}
        <InfoTip title={label} content={help} size={11} />
      </dt>
      <dd className="tabular mt-0.5 text-sm font-semibold">{value}</dd>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </div>
  );
}
