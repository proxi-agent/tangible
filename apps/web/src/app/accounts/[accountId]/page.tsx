'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { Suspense } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SEGMENTS, type SegmentKey } from '@tangible/types';
import { AXIS, ChartFrame, GRID, TooltipCard } from '@/components/charts/chart-parts';
import { HistoryTable } from '@/components/history-table';
import { stateClassWord } from '@/components/state-class';
import {
  BackLink,
  Badge,
  Card,
  CardHeader,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat,
  TextLink,
} from '@/components/ui/primitives';
// Recharts owns the name `Tooltip` in this file; ours is the explainer kind.
import { Tooltip as HelpTooltip } from '@/components/ui/tooltip';
import { useScope } from '@/hooks/use-scope';
import { api } from '@/lib/api';
import { count, money, moneyExact, percent } from '@/lib/format';

export default function AccountPage() {
  return (
    <Suspense fallback={<AccountSkeleton />}>
      <AccountDetail />
    </Suspense>
  );
}

/** The page's own shape while it loads: title, the figures, the history. */
function AccountSkeleton() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Card className="p-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((cell) => (
            <Skeleton key={cell} className="h-12 w-full" />
          ))}
        </div>
      </Card>
      <Card>
        <div className="space-y-2 p-5">
          <Skeleton className="h-5 w-48" />
        </div>
        <div className="space-y-2 px-5 pb-5">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-9 w-full" />
          ))}
        </div>
      </Card>
    </div>
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

  if (error)
    return (
      <Card>
        <ErrorState error={error} />
      </Card>
    );
  if (isPending || !data) return <AccountSkeleton />;

  const classWord = stateClassWord(data.stateClass);

  return (
    <div className="space-y-4">
      {/* The business's name is the page's name. It had been the first line
          inside the first card, under a loose back link — so the page opened on
          a card rather than on a title, and the segments it belongs to read as
          that card's actions rather than as what this account is. */}
      <PageHeader
        back={<BackLink href={`/accounts?${scopeQuery}`}>Back to accounts</BackLink>}
        title={data.ownerName ?? 'Unnamed owner'}
        description={
          <span className="tabular">
            Account {data.accountId}
            {data.siteCity ? ` · ${data.siteCity}` : ''}
            {/* The roll's own code — L1, J6 — said in the word the rest of the
                app now uses for it, with the code kept for the reader who
                thinks in the district's vocabulary. */}
            {classWord ? (
              <>
                {' · '}
                {/* The separator sits outside the tooltip: its trigger is an
                    inline-flex box, which swallows a leading space. */}
                <HelpTooltip
                  title={`${data.stateClass} · ${classWord.word}`}
                  content={classWord.meaning}
                >
                  <span>{classWord.word}</span>
                </HelpTooltip>
              </>
            ) : data.stateClass ? (
              ` · class ${data.stateClass}`
            ) : null}
            {/* An account belongs to a business, and a business usually has
                more than one of them — the whole premise of the owners page.
                Getting from an owner to their locations worked; getting back
                from a location to the rest of the owner's did not, so the one
                account a reader landed on was the end of the road. */}
            {data.ownerName ? (
              <>
                {' · '}
                <TextLink
                  href={`/accounts?${scopeQuery}&search=${encodeURIComponent(data.ownerName)}`}
                >
                  Other locations under this name
                </TextLink>
              </>
            ) : null}
          </span>
        }
        meta={data.segments.map((key) => {
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
      />

      {/* The figures themselves, unheaded: the title directly above names them,
          and a heading here would only say it twice. */}
      <Card className="p-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            size="lg"
            label="Equipment value"
            value={moneyExact(data.latestAssessedValue)}
            help="What the county says this location’s equipment, furniture and inventory are worth this year."
          />
          <Stat
            size="lg"
            label="Tax / yr"
            value={moneyExact(data.estimatedAnnualTax)}
            help="The value above at the county’s blended tax rate. An estimate — the exact bill depends on which taxing units cover the address."
          />
          <Stat
            size="lg"
            label="Penalty / yr"
            value={moneyExact(data.estimatedAnnualPenalty)}
            tone={data.estimatedAnnualPenalty ? 'critical' : undefined}
            help="The extra 10% charged for not filing the annual equipment declaration. Pure waste — filing the form removes it."
          />
          <Stat
            size="lg"
            label="Penalty to date"
            value={moneyExact(data.estimatedLifetimePenalty)}
            help="Every missed year’s penalty added up over the period covered by this data."
          />
        </div>

        <div className="mt-5 flex flex-wrap gap-x-8 gap-y-4 border-t border-[var(--color-hairline)] pt-5">
          <Stat
            size="sm"
            label="Years on record"
            value={count(data.yearsOnRoll)}
            help="How many tax years this location appears in the county's published data."
          />
          <Stat
            size="sm"
            label="Years missed"
            value={count(data.yearsUnfiled)}
            help="Years with no equipment declaration recorded — each one carrying its own 10% penalty."
          />
          <Stat
            size="sm"
            label="Years filed late"
            value={count(data.yearsFiledLate)}
            help="Filed, but after the April 15 deadline. Late still carries the penalty unless the county granted an extension."
          />
          <Stat
            size="sm"
            label="Miss rate"
            value={percent(data.yearsOnRoll ? data.yearsUnfiled / data.yearsOnRoll : null, 0)}
            help="Missed years as a share of years on record. A high rate is habit, not an accident."
          />
          <Stat
            size="sm"
            label="Tax agent"
            value={data.hasAgent ? 'On record' : 'None'}
            help="Whether a tax firm is already registered with the county to act for this business."
          />
          <Stat
            size="sm"
            label="Value pattern"
            value={data.isFrozen ? 'Frozen' : data.neverDeclines ? 'Never declines' : 'Moves'}
            help="Equipment depreciates, so a value that never moves usually means nobody has updated it — often because the business stopped reporting."
          />
        </div>
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
                      {
                        label: 'Estimated tax',
                        value: moneyExact(payload[0]?.payload?.estimatedTax),
                      },
                      {
                        label: 'Penalty',
                        value: moneyExact(payload[0]?.payload?.estimatedPenalty),
                      },
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
            <Bar
              isAnimationActive={false}
              dataKey="assessedValue"
              fill="var(--color-series-1)"
              radius={[4, 4, 0, 0]}
              maxBarSize={48}
            />
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
