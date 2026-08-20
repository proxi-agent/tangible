'use client';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CircleCheck,
  FileText,
  Gavel,
  MapPin,
  Stamp,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type {
  EngagementReturn,
  EngagementReturns,
  Rendition,
  RenditionDecision,
  RenditionBasis,
} from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, money, moneyExact, plural } from '@/lib/format';
import { Button } from '@/components/ui/controls';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The rendition draft.
 *
 * A rendition is signed under penalty of perjury, so this screen is built to
 * make the filer's obligations visible rather than to look finished. The
 * blockers sit above the form, not below it; the basis choice is a real control
 * with its consequences spelled out; and every asset left off the form is
 * listed with the reason it was left off.
 */
export default function FilingPage() {
  const { clientId, engagementId } = useParams<{ clientId: string; engagementId: string }>();
  const [basis, setBasis] = useState<RenditionBasis>('cost');
  const [filedByAgent, setFiledByAgent] = useState(true);
  // Null is "no return chosen". For the ordinary one-site engagement that is
  // also the answer, and the server resolves it to the only return there is.
  const [locationId, setLocationId] = useState<string | null>(null);

  const returns = useQuery({
    queryKey: ['engagement-returns', engagementId],
    queryFn: () => api.returns(engagementId),
  });

  const { data, error, isLoading } = useQuery({
    queryKey: ['engagement-rendition', engagementId, basis, filedByAgent, locationId],
    queryFn: () => api.rendition(engagementId, { basis, filedByAgent, locationId }),
    placeholderData: (previous) => previous,
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;

  const site = locationId ? `&location=${encodeURIComponent(locationId)}` : '';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <Link
          href={`/clients/${clientId}/engagements/${engagementId}`}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
        >
          <ArrowLeft size={13} strokeWidth={2} />
          Back to the engagement
        </Link>
        <Link
          href={`/clients/${clientId}/engagements/${engagementId}/filing/form?basis=${basis}&agent=${filedByAgent}${site}`}
          className="ml-auto inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-ink)] hover:underline"
        >
          <FileText size={13} strokeWidth={2} />
          View the form
        </Link>
      </div>

      {returns.data && returns.data.returns.length > 1 ? (
        <ReturnPicker owed={returns.data} chosen={locationId} onChoose={setLocationId} />
      ) : null}

      <Card>
        <CardHeader
          title={`Form 50-144 — ${data.clientName}${chosenLabel(returns.data, locationId)}, tax year ${data.taxYear}`}
          description={
            <>
              {data.jurisdictionName ?? data.jurisdictionId ?? 'No jurisdiction set'}
              {data.accountId ? ` · account ${data.accountId}` : ' · no account number'}
              {data.sicCode ? ` · SIC ${data.sicCode}` : ''} · drafted{' '}
              {new Date(data.generatedAt).toLocaleDateString()}
            </>
          }
        />
        <BasisControls
          basis={basis}
          filedByAgent={filedByAgent}
          onBasis={setBasis}
          onAgent={setFiledByAgent}
          rendition={data}
        />
        <Totals rendition={data} />
      </Card>

      <Blockers rendition={data} />
      {data.decisions.length > 0 ? <Decisions rendition={data} /> : null}
      <Schedules rendition={data} />
      {data.exclusions.length > 0 ? <Exclusions rendition={data} /> : null}
      <Deadlines rendition={data} />
    </div>
  );
}

/**
 * Which of this engagement's returns is on screen.
 *
 * A district opens one account per business location, so a client with two
 * sites files two forms — not one form covering both. This strip exists to make
 * that visible before anyone signs anything: the returns are listed whether or
 * not one is picked, with the property and the account behind each, so the
 * count is a fact about the engagement rather than a surprise at the printer.
 *
 * Nothing is selected to begin with, deliberately. The draft below then comes
 * back covering the whole register and blocked, which is the honest answer to a
 * screen that assumed a single form — and it is a worse outcome to quietly show
 * one site's return as if it were the filing.
 */
function ReturnPicker({
  owed,
  chosen,
  onChoose,
}: {
  owed: EngagementReturns;
  chosen: string | null;
  onChoose: (locationId: string | null) => void;
}) {
  return (
    <Card>
      <CardHeader
        title={`${count(owed.returns.length)} returns for this engagement`}
        description="Property is assessed where it stood on January 1 and each business location has its own account, so each site here is its own Form 50-144. Pick the one you are working on — the schedules, the totals and the findings below are all measured against that site alone."
        action={
          owed.unplacedCount > 0 ? (
            <span className="text-xs text-[var(--color-warning)]">
              {count(owed.unplacedCount)} {plural(owed.unplacedCount, 'asset')} on no return
            </span>
          ) : null
        }
      />
      <div className="flex flex-wrap gap-2 px-5 py-3">
        {owed.returns.map((entry) => (
          <ReturnChip
            key={entry.locationId}
            entry={entry}
            active={chosen === entry.locationId}
            onClick={() => onChoose(chosen === entry.locationId ? null : entry.locationId)}
          />
        ))}
      </div>
    </Card>
  );
}

function ReturnChip({
  entry,
  active,
  onClick,
}: {
  entry: EngagementReturn;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`The return for ${entry.label}`}
      className={cn(
        'cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors',
        active
          ? 'border-[var(--color-series-1)] bg-[color-mix(in_oklab,var(--color-series-1)_10%,transparent)]'
          : 'border-[var(--color-hairline)] bg-[var(--color-surface)] hover:bg-[var(--color-plane)]',
      )}
    >
      <span className="flex items-center gap-1.5 text-sm font-medium">
        <MapPin size={13} strokeWidth={2} className="text-[var(--color-ink-muted)]" />
        {entry.label}
      </span>
      <span className="tabular mt-0.5 block text-xs text-[var(--color-ink-secondary)]">
        {count(entry.assetCount)} {plural(entry.assetCount, 'asset')} · {money(entry.totalCost)}
      </span>
      <span className="block text-[11px] text-[var(--color-ink-muted)]">
        {entry.accountId ? (
          `account ${entry.accountId}`
        ) : (
          <span className="text-[var(--color-warning)]">no account number</span>
        )}
      </span>
    </button>
  );
}

/** The site's name in the heading, but only where there is more than one. */
function chosenLabel(owed: EngagementReturns | undefined, locationId: string | null): string {
  if (!owed || owed.returns.length < 2 || !locationId) return '';
  const entry = owed.returns.find((r) => r.locationId === locationId);
  return entry ? ` at ${entry.label}` : '';
}

function BasisControls({
  basis,
  filedByAgent,
  onBasis,
  onAgent,
  rendition,
}: {
  basis: RenditionBasis;
  filedByAgent: boolean;
  onBasis: (basis: RenditionBasis) => void;
  onAgent: (value: boolean) => void;
  rendition: Rendition;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-[var(--color-hairline)] px-5 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
          Filed on
        </span>
        {(
          [
            {
              value: 'cost' as const,
              label: 'Cost and year',
              help: 'Historical cost and year acquired, per Tax Code 22.01(a)(5). Facts from the client’s own books, which the district then values with its own schedules. It also never triggers the 22.24(e) notarization requirement, at any value.',
            },
            {
              value: 'estimate' as const,
              label: 'Good faith estimate',
              help: 'A stated opinion of market value. Worth it where the schedules overstate genuinely obsolete equipment — but the chief appraiser can demand support within 21 days (22.07), and an agent-filed estimate over $150,000 must be notarized.',
            },
          ] as const
        ).map((option) => (
          <Tooltip key={option.value} title={option.label} content={option.help}>
            <button
              type="button"
              onClick={() => onBasis(option.value)}
              aria-pressed={basis === option.value}
              className={cn(
                'cursor-pointer rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                basis === option.value
                  ? 'border-[var(--color-series-1)] bg-[color-mix(in_oklab,var(--color-series-1)_14%,transparent)] text-[var(--color-series-1)]'
                  : 'border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink-secondary)] hover:bg-[var(--color-plane)]',
              )}
            >
              {option.label}
            </button>
          </Tooltip>
        ))}
      </div>

      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--color-ink-secondary)]">
        <input
          type="checkbox"
          checked={filedByAgent}
          onChange={(e) => onAgent(e.target.checked)}
          className="cursor-pointer"
        />
        Filed by us as agent
      </label>

      <div
        className={cn(
          'ml-auto flex items-center gap-1.5 text-xs',
          rendition.notarization.required
            ? 'text-[var(--color-warning)]'
            : 'text-[var(--color-ink-muted)]',
        )}
      >
        <Stamp size={13} strokeWidth={2} />
        <Tooltip
          title={rendition.notarization.required ? 'Notarization required' : 'No notarization'}
          content={rendition.notarization.reason}
        >
          <span className="cursor-help underline decoration-dotted underline-offset-2">
            {rendition.notarization.required ? 'Notarization required' : 'No notary needed'}
          </span>
        </Tooltip>
      </div>
    </div>
  );
}

function Totals({ rendition }: { rendition: Rendition }) {
  const tiles = [
    { label: 'Historical cost filed', value: money(rendition.totalHistoricalCost) },
    {
      label: 'Good faith estimate',
      value:
        rendition.totalGoodFaithEstimate === null ? '—' : money(rendition.totalGoodFaithEstimate),
      note: rendition.totalGoodFaithEstimate === null ? 'not filed on this basis' : undefined,
    },
    {
      label: 'District schedule value',
      value: money(rendition.scheduleValue),
      note: 'shown for comparison, not filed',
    },
  ];
  return (
    <div className="grid grid-cols-1 gap-px border-b border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-3">
      {tiles.map((tile) => (
        <div key={tile.label} className="bg-[var(--color-surface)] px-5 py-3">
          <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            {tile.label}
          </p>
          <p className="tabular mt-1 text-xl font-semibold">{tile.value}</p>
          {tile.note ? (
            <p className="text-[11px] text-[var(--color-ink-muted)]">{tile.note}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Blockers({ rendition }: { rendition: Rendition }) {
  const blocking = rendition.blockers.filter((b) => b.severity === 'blocking');
  const warnings = rendition.blockers.filter((b) => b.severity === 'warning');

  return (
    <Card>
      <CardHeader
        title={blocking.length > 0 ? 'Not ready to file' : 'Ready to file, with notes'}
        description="What stands between this draft and a signature. Blocking items would make the form wrong or incomplete; warnings would make it defensible but worse than it needs to be."
      />
      {rendition.blockers.length === 0 ? (
        <p className="flex items-center gap-2 px-5 py-4 text-sm text-[var(--color-good)]">
          <CircleCheck size={15} strokeWidth={2} />
          Nothing outstanding.
        </p>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)]">
          {[...blocking, ...warnings].map((item) => (
            <li key={item.key} className="flex items-start gap-3 px-5 py-3">
              <AlertTriangle
                size={14}
                strokeWidth={2}
                className={cn(
                  'mt-0.5 shrink-0',
                  item.severity === 'blocking'
                    ? 'text-[var(--color-critical)]'
                    : 'text-[var(--color-warning)]',
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">{item.message}</p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{item.resolution}</p>
              </div>
              <Badge tone={item.severity === 'blocking' ? 'critical' : 'warning'}>
                {item.severity === 'blocking' ? 'blocking' : 'note'}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const STATUS: Record<string, { label: string; tone: 'good' | 'critical' | 'warning' | 'neutral' }> =
  {
    accepted: { label: 'accepted', tone: 'good' },
    rejected: { label: 'rejected', tone: 'critical' },
    'pending-client': { label: 'with the client', tone: 'warning' },
  };

/**
 * The decision log, as it reads on the form.
 *
 * Everything else here is derived from the register; this is the only place a
 * human judgement changed the paper, so it says so out loud — including where
 * the answer is that it changed nothing. Most accepted findings describe
 * property the register or the classification already keeps off the form, and a
 * reader who assumed otherwise would be looking for a reduction that was never
 * supposed to appear.
 */
function Decisions({ rendition }: { rendition: Rendition }) {
  const undecided = rendition.decisions.filter((d) => d.status === null).length;
  return (
    <Card>
      <CardHeader
        title="Decisions carried onto this form"
        description={
          undecided > 0
            ? `Committed findings and what each one did here. ${count(undecided)} ${plural(undecided, 'has', 'have')} not been decided — a claim that went out and came back unanswered is not the same as one nobody made.`
            : 'Committed findings and what each one did here. A schedule lighter than the register has to be able to say who decided that, and on what day.'
        }
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {rendition.decisions.map((decision) => (
          <Decision key={`${decision.source}-${decision.key}`} decision={decision} />
        ))}
      </ul>
    </Card>
  );
}

function Decision({ decision }: { decision: RenditionDecision }) {
  const status = decision.status ? STATUS[decision.status] : null;
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <Gavel size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-[var(--color-ink-muted)]" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <span className="font-medium">{decision.title}</span>
          <span className="text-xs text-[var(--color-ink-muted)]">
            {decision.source === 'savings'
              ? 'savings report'
              : `comparison against the ${decision.taxYear} return`}
            {' · '}
            {money(decision.cost)} claimed
          </span>
        </p>
        <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
          {decision.effectOnForm}
        </p>
        {decision.decidedAt ? (
          <p className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">
            {decision.decidedBy ?? 'Nobody recorded'} ·{' '}
            {new Date(decision.decidedAt).toLocaleDateString()}
          </p>
        ) : null}
      </div>
      {decision.removedAssetCount > 0 ? (
        <span className="tabular shrink-0 text-xs text-[var(--color-ink-secondary)]">
          −{moneyExact(decision.removedCost)}
        </span>
      ) : null}
      <Badge tone={status?.tone ?? 'neutral'}>{status?.label ?? 'undecided'}</Badge>
    </li>
  );
}

function Schedules({ rendition }: { rendition: Rendition }) {
  return (
    <>
      {rendition.qualifiesForScheduleA ? (
        <Card>
          <p className="px-5 py-3 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            Total value is under $20,000, so the whole rendition goes on Schedule A: a general
            description and a total, with type, year and cost optional. The itemized detail below is
            still available if you would rather file it.
          </p>
        </Card>
      ) : null}
      {rendition.schedules.map((schedule) => (
        <Card key={schedule.key}>
          <CardHeader title={schedule.title} description={schedule.instruction} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-hairline)] text-[11px] tracking-wide text-[var(--color-ink-muted)] uppercase">
                  <th className="px-5 py-2 text-left font-medium">Property type</th>
                  <th className="px-5 py-2 text-right font-medium">Year acquired</th>
                  <th className="px-5 py-2 text-right font-medium">Assets</th>
                  <th className="px-5 py-2 text-right font-medium">Historical cost</th>
                  {schedule.totalEstimate !== null ? (
                    <th className="px-5 py-2 text-right font-medium">Good faith estimate</th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {schedule.lines.map((line) => (
                  <tr
                    key={`${line.type}-${line.yearAcquired}`}
                    className="border-b border-[var(--color-hairline)]"
                  >
                    <td className="px-5 py-2">{line.type}</td>
                    <td className="tabular px-5 py-2 text-right">{line.yearAcquired ?? '—'}</td>
                    <td className="tabular px-5 py-2 text-right text-[var(--color-ink-secondary)]">
                      {count(line.assetCount)}
                    </td>
                    <td className="tabular px-5 py-2 text-right">
                      {moneyExact(line.historicalCost)}
                    </td>
                    {schedule.totalEstimate !== null ? (
                      <td className="tabular px-5 py-2 text-right">
                        {moneyExact(line.goodFaithEstimate)}
                      </td>
                    ) : null}
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="px-5 py-2" colSpan={3}>
                    Total
                  </td>
                  <td className="tabular px-5 py-2 text-right">{moneyExact(schedule.totalCost)}</td>
                  {schedule.totalEstimate !== null ? (
                    <td className="tabular px-5 py-2 text-right">
                      {moneyExact(schedule.totalEstimate)}
                    </td>
                  ) : null}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </>
  );
}

function Exclusions({ rendition }: { rendition: Rendition }) {
  return (
    <Card>
      <CardHeader
        title="Deliberately not on this form"
        description="Property in the register that does not belong on the rendition. Listed with its reason, because “why isn’t this on here” is the first question anyone reviewing it will ask."
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {rendition.exclusions.map((exclusion) => (
          <li
            key={`${exclusion.categoryKey}-${exclusion.reason}`}
            className="flex flex-wrap items-baseline gap-x-3 px-5 py-2.5 text-sm"
          >
            <span className="font-medium">{exclusion.label}</span>
            <span className="text-xs text-[var(--color-ink-secondary)]">{exclusion.reason}</span>
            <span className="tabular ml-auto text-xs text-[var(--color-ink-muted)]">
              {count(exclusion.assetCount)} {plural(exclusion.assetCount, 'asset')} ·{' '}
              {moneyExact(exclusion.originalCost)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Deadlines({ rendition }: { rendition: Rendition }) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Card>
      <CardHeader
        title={`${rendition.taxYear} filing calendar`}
        description="Every date carries the statute it comes from — a deadline nobody can check is one nobody will trust when it matters."
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {rendition.deadlines.map((deadline) => {
          const past = deadline.date < today;
          return (
            <li key={deadline.key} className="flex items-start gap-3 px-5 py-2.5">
              <CalendarDays
                size={13}
                strokeWidth={2}
                className="mt-0.5 shrink-0 text-[var(--color-ink-muted)]"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className={cn('font-medium', past ? 'text-[var(--color-ink-muted)]' : '')}>
                    {deadline.label}
                  </span>
                  <span className="tabular ml-2 text-xs text-[var(--color-ink-secondary)]">
                    {new Date(`${deadline.date}T00:00:00Z`).toLocaleDateString(undefined, {
                      timeZone: 'UTC',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                  {deadline.basis}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
