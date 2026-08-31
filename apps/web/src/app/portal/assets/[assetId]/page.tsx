'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, Layers, Receipt, Scale } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { AssetAppraisalState, AssetProfile } from '@tangible/types';
import { api } from '@/lib/api';
import { day, money, moneyExact, percent } from '@/lib/format';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';
import { usePortal } from '@/components/portal/portal-context';

/**
 * One asset, in full, from the client's side.
 *
 * The same profile the firm reads — the book record, how we recognised it
 * across imports, what it is classified as, where it sits, the valuation
 * arithmetic step by step, what it has been rendered at, and what has changed
 * about it. The endpoint takes the firm's own working notes off it: who
 * confirmed a category and when, and which model proposed it. Everything that
 * explains the number stays.
 *
 * This is the page a controller lands on from a row they are about to accept.
 * The question they have at that moment is never "what is this asset" — they
 * own it — it is "where did your number come from", and the valuation card is
 * the answer.
 */
export default function PortalAssetPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const { engagementId, href } = usePortal();

  const { data, isLoading, error } = useQuery({
    queryKey: ['asset-profile', engagementId, assetId],
    queryFn: () => api.assetProfile(engagementId!, assetId),
    enabled: engagementId !== null,
  });

  if (error) {
    return (
      <Card>
        <ErrorState error={error} />
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-6 w-96 max-w-full" />
        <Card>
          <div className="space-y-3 p-5">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-24 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  const { asset } = data;

  return (
    <div className="space-y-5">
      <PageHeader
        back={
          <Link
            href={href('/portal')}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
          >
            <ArrowLeft size={13} />
            Your report
          </Link>
        }
        title={asset.description ?? 'Untitled asset'}
        meta={
          <>
            {asset.isDisposed ? <Badge tone="critical">Disposed in your books</Badge> : null}
            {data.isAbsent ? (
              <Badge tone="warning">
                Not in your latest file
                <InfoTip
                  content="It was in a register you sent earlier and is missing from the newest one. That is not the same as a disposal — a narrower export looks identical — so it stays on the books until you tell us otherwise."
                  size={12}
                  className="ml-1 align-text-bottom"
                />
              </Badge>
            ) : null}
          </>
        }
        description={
          <>
            {asset.assetTag ? <>Your tag {asset.assetTag} · </> : null}
            {data.firstSeen?.appliedAt ? (
              <>on the register since {day(data.firstSeen.appliedAt.slice(0, 10))}</>
            ) : (
              <>from the register you sent</>
            )}
          </>
        }
      />

      <Card>
        <CardHeader
          title="Your book record"
          icon={Layers}
          description="Exactly as it came off the register you sent — nothing here is ours."
        />
        <StatGrid columns={4}>
          <StatCell>
            <Stat label="Original cost" value={moneyExact(asset.originalCost)} size="sm" />
          </StatCell>
          <StatCell>
            <Stat label="Acquired" value={asset.acquisitionYear ?? '—'} size="sm" />
          </StatCell>
          <StatCell>
            <Stat
              label="Accumulated depreciation"
              value={moneyExact(asset.accumulatedDepreciation)}
              size="sm"
              help="Book depreciation, which is a different calculation from the district’s. It does not set the taxable value."
            />
          </StatCell>
          <StatCell>
            <Stat label="Net book value" value={moneyExact(asset.netBookValue)} size="sm" />
          </StatCell>
        </StatGrid>
        <div className="grid gap-x-8 gap-y-2 border-t border-[var(--color-hairline)] px-5 py-3 text-sm sm:grid-cols-3">
          <Line label="Serial number" value={asset.serialNumber} />
          <Line label="Vendor" value={asset.vendor} />
          <Line label="GL account" value={asset.glAccount} />
          <Line label="Your category" value={asset.category} />
          <Line label="Cost centre" value={asset.department} />
          <Line label="Location in your file" value={asset.location} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="What we are treating it as"
            icon={Scale}
            description="The schedule the district depreciates it on follows from this."
          />
          {data.classification === null ? (
            <EmptyState title="Not classified yet">
              Until it is classified there is no schedule to value it on, so it carries no number.
            </EmptyState>
          ) : (
            <div className="space-y-3 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{data.classification.label ?? 'Unclassified'}</Badge>
                <Badge tone={data.classification.status === 'confirmed' ? 'good' : 'neutral'}>
                  {data.classification.status === 'confirmed'
                    ? 'Confirmed by a person'
                    : data.classification.status === 'needs-review'
                      ? 'In review'
                      : 'Read from the description'}
                </Badge>
                <span className="text-xs text-[var(--color-ink-muted)]">
                  {percent(data.classification.confidence, 0)} confident
                </span>
              </div>
              {data.classification.rationale ? (
                <p className="text-sm text-[var(--color-ink-secondary)]">
                  {data.classification.rationale}
                </p>
              ) : null}
              {data.classification.lifeClassOverride !== null ? (
                <Callout tone="neutral" title="Life set by hand">
                  Valued over {data.classification.lifeClassOverride} years rather than the default
                  for its class.
                </Callout>
              ) : null}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Where it sits"
            icon={Building2}
            description="Which of your sites it is rendered at — and so which district assesses it."
          />
          {data.placement === null ? (
            <EmptyState title="Not placed at a site yet">
              Your register did not say where this one lives. Until it is placed it goes on the
              return for the whole business rather than a specific account.
            </EmptyState>
          ) : (
            <div className="space-y-1 px-5 py-4 text-sm">
              <p className="font-medium">{data.placement.label}</p>
              {data.placement.addressLine1 ? (
                <p className="text-[var(--color-ink-secondary)]">
                  {data.placement.addressLine1}
                  {data.placement.city ? `, ${data.placement.city}` : ''}
                  {data.placement.stateCode ? ` ${data.placement.stateCode}` : ''}
                </p>
              ) : null}
              {data.placement.jurisdictionName ? (
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {data.placement.jurisdictionName}
                  {data.placement.accountId ? ` · account ${data.placement.accountId}` : ''}
                </p>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="How the value was arrived at"
          icon={Receipt}
          description="The district’s own arithmetic, run on your cost — cost, indexed, then depreciated."
          help="An appraisal district does not use your book depreciation. It replaces cost with what the asset would cost new today, then applies a percent-good factor from a published schedule for its class and age. This card shows each step so you can check it against the schedule."
        />
        <Valuation state={data.appraisal} />
      </Card>

      {data.filings.length > 0 ? (
        <Card>
          <CardHeader
            title="What it has been rendered at"
            description="Returns this asset has appeared on."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {data.filings.map((filing) => (
              <li
                key={filing.filingId}
                className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5 text-sm"
              >
                <span className="font-medium">{filing.taxYear}</span>
                <span className="text-[var(--color-ink-secondary)]">
                  {filing.locationLabel ?? 'All property'}
                  {filing.jurisdictionName ? ` · ${filing.jurisdictionName}` : ''}
                </span>
                <span className="tabular ml-auto">
                  {filing.scheduleValue === null ? '—' : money(filing.scheduleValue)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {data.findings.length > 0 ? (
        <Card>
          <CardHeader
            title="Findings that touch this asset"
            description="Every position on your report that names this line."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {data.findings.map((finding) => (
              <li key={`${finding.setId}:${finding.key}`} className="px-5 py-2.5">
                <Link
                  href={href(`/portal/report/${encodeURIComponent(finding.key)}`)}
                  className="text-sm font-medium text-[var(--color-accent-ink)] hover:underline"
                >
                  {finding.title}
                </Link>
                <p className="text-xs text-[var(--color-ink-muted)]">
                  {finding.effect === 'removes'
                    ? 'Takes value off the return'
                    : 'Changes how it is reported'}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="What has changed about it"
          description="Every difference between the registers you have sent us."
          help="Book depreciation moves every year on every asset, so those changes are recorded but kept out of the way. What is listed here is everything else — a cost restated, a description rewritten, a disposal marked."
        />
        {material(data).length === 0 ? (
          <EmptyState title="Nothing has moved">
            This asset has read the same way in every register you have sent.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-[var(--color-hairline)]">
            {material(data).map((event) => (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5">
                <span className="text-sm">{event.summary}</span>
                <span className="ml-auto text-xs text-[var(--color-ink-muted)]">
                  {day(event.occurredAt.slice(0, 10))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function material(profile: AssetProfile) {
  return profile.events.filter((event) => event.significance === 'material');
}

function Line({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <p>
      <span className="eyebrow mr-2">{label}</span>
      {value}
    </p>
  );
}

/**
 * The waterfall, or the reason there isn't one.
 *
 * Every refusal state gets a sentence rather than a blank: an asset with no
 * number on it is a question somebody has to answer, and "—" does not say who.
 */
function Valuation({ state }: { state: AssetAppraisalState }) {
  if (state.state === 'valued') {
    return (
      <>
        <div className="grid gap-x-8 gap-y-3 px-5 py-4 sm:grid-cols-4">
          <Step
            label="Original cost"
            value={moneyExact(state.replacementCostNew / state.indexFactor)}
          />
          <Step
            label="Cost new today"
            value={moneyExact(state.replacementCostNew)}
            note={`× ${state.indexFactor.toFixed(3)} index`}
          />
          <Step
            label="Percent good"
            value={percent(state.percentGood, 0)}
            note={
              typeof state.schedule === 'number'
                ? `${state.schedule}-year schedule`
                : state.schedule
            }
          />
          <Step label="Market value" value={moneyExact(state.marketValue)} emphasis />
        </div>
        <p className="border-t border-[var(--color-hairline)] px-5 py-2.5 text-xs text-[var(--color-ink-secondary)]">
          About {money(state.estimatedTax)} of tax a year at {percent(state.taxRate, 2)}
          {state.atFloor
            ? '. It has reached the schedule’s floor — the district stops depreciating it here however old it gets.'
            : '.'}
          {state.sic
            ? ` Life from the district’s SIC ${state.sic.code} table (${state.sic.description}), ${state.sic.life} years.`
            : ''}
        </p>
      </>
    );
  }

  const message: Record<Exclude<AssetAppraisalState['state'], 'valued'>, string> = {
    disposed: 'Your books show it gone, so it is not on the return and carries no value.',
    excluded: 'It is not business personal property, so it does not belong on the return at all.',
    'needs-review':
      'Somebody is still deciding what class this belongs to. A number now would be a guess.',
    unclassified: 'Not classified yet, so there is no schedule to depreciate it on.',
    'no-schedule': 'The district publishes no schedule that fits this one.',
    gap: 'Something the calculation needs is missing from the register.',
  };

  const detail =
    state.state === 'excluded'
      ? state.label
      : state.state === 'no-schedule'
        ? state.detail
        : state.state === 'gap'
          ? `${state.reason}: ${state.detail}`
          : null;

  return (
    <div className="px-5 py-4">
      <p className="text-sm">{message[state.state]}</p>
      {detail ? <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{detail}</p> : null}
    </div>
  );
}

function Step({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note?: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`tabular mt-0.5 ${emphasis ? 'text-base font-semibold' : 'text-sm'}`}>
        {value}
      </p>
      {note ? <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{note}</p> : null}
    </div>
  );
}
