'use client';

import { AlertTriangle, ChevronDown, Scale, ShieldAlert, TrendingDown } from 'lucide-react';
import { useState } from 'react';
import type {
  CategoryVerdict,
  ComparisonCategory,
  ComparisonFinding,
  RegisterComparison,
} from '@tangible/filing';
import type { FindingKind } from '@tangible/types';
import { cn } from '@/lib/cn';
import { count, money, moneyExact, plural } from '@/lib/format';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The return, held against the register.
 *
 * Laid out in the order a reviewer earns the right to the next line. First how
 * much of each side is even in the comparison — a page that opened with
 * "they over-reported $400,000" while a third of the return sat unread would be
 * worse than no page. Then what the difference decomposes into. Then the
 * findings, savings and exposure in the same list, because a client who hears
 * only the refund half of a comparison is being sold to rather than advised.
 */

const KIND_META: Record<FindingKind, { label: string; tone: 'good' | 'accent' | 'warning'; help: string }> = {
  measured: {
    label: 'measured',
    tone: 'good',
    help: 'Computed from the register, the return and the district’s published schedules. Nothing was assumed.',
  },
  modeled: {
    label: 'modeled',
    tone: 'accent',
    help: 'Rests on a stated assumption, printed with the finding so you can disagree with it.',
  },
  screening: {
    label: 'needs an answer',
    tone: 'warning',
    help: 'Not settleable from these two documents alone.',
  },
};

const VERDICT_META: Record<CategoryVerdict, { label: string; tone: 'neutral' | 'good' | 'warning' | 'critical' }> = {
  agrees: { label: 'agrees', tone: 'good' },
  'over-reported': { label: 'over-reported', tone: 'warning' },
  'under-reported': { label: 'under-reported', tone: 'critical' },
  'only-reported': { label: 'on the return only', tone: 'warning' },
  'only-owned': { label: 'on the register only', tone: 'critical' },
};

export function PriorComparisonView({ comparison }: { comparison: RegisterComparison }) {
  const nothingToCompare =
    comparison.comparedRegisterCost === 0 && comparison.comparedReportedCost === 0;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title={`The ${comparison.taxYear} return against the register`}
          description={
            <>
              Every compared dollar lands in exactly one bucket below, so the columns add back to
              the totals. Property acquired after January 1, {comparison.taxYear} and property the
              register dates as disposed before it are held out by name rather than netted in —
              a plain subtraction reports the calendar as a finding.
              {comparison.scheduleTaxYear !== null ? (
                <>
                  {' '}
                  Values are on {comparison.scheduleJurisdiction}’s {comparison.scheduleTaxYear}{' '}
                  schedules
                  {comparison.scheduleTaxYear !== comparison.taxYear ? (
                    <span className="text-[var(--color-warning)]">
                      {' '}
                      — the {comparison.taxYear} tables are not loaded, so this is the nearest
                      published year
                    </span>
                  ) : null}
                  .
                </>
              ) : (
                ' No published schedule covers this jurisdiction, so costs are compared and values are not.'
              )}
            </>
          }
        />

        {nothingToCompare ? (
          <EmptyState title="Nothing lines up yet">
            Settle the wording above and classify the register, and the two sides meet here.
          </EmptyState>
        ) : (
          <>
            <Decomposition comparison={comparison} />
            <Values comparison={comparison} />
          </>
        )}
      </Card>

      {comparison.findings.length > 0 ? (
        <Card>
          <CardHeader
            title="What the difference is"
            description="Named rather than netted."
            help="A saving and an exposure are different claims about the same client, and both belong on the page — netting them would hide one behind the other."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {comparison.findings.map((finding) => (
              <FindingRow key={finding.key} finding={finding} />
            ))}
          </ul>
        </Card>
      ) : nothingToCompare ? null : (
        <Card>
          <EmptyState title="The return matches the register">
            Every category and vintage in scope agrees within a dollar. That is a finding of its
            own: this account has no rendition-side position to take.
          </EmptyState>
        </Card>
      )}

      {comparison.categories.length > 0 ? <CategoryTable comparison={comparison} /> : null}

      <OutOfScope comparison={comparison} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// How the two sides decompose
// ---------------------------------------------------------------------------

/**
 * The reconciliation, as a bar rather than a table.
 *
 * Reallocation is the segment worth the ink: it is invisible in any total, it
 * recurs every year nobody looks, and on an indexed schedule it is often worth
 * more than the over-reporting sitting next to it.
 */
function Decomposition({ comparison }: { comparison: RegisterComparison }) {
  const { matchedCost, reallocatedCost, overReportedCost, underReportedCost } = comparison;
  const span = matchedCost + reallocatedCost + overReportedCost + underReportedCost;
  const segments = [
    { key: 'matched', label: 'Agrees', value: matchedCost, className: 'bg-[var(--color-good)]' },
    {
      key: 'reallocated',
      label: 'Wrong category',
      value: reallocatedCost,
      className: 'bg-[var(--color-series-1)]',
    },
    {
      key: 'over',
      label: 'Over-reported',
      value: overReportedCost,
      className: 'bg-[var(--color-warning)]',
    },
    {
      key: 'under',
      label: 'Not reported',
      value: underReportedCost,
      className: 'bg-[var(--color-critical)]',
    },
  ].filter((segment) => segment.value > 0);

  return (
    <div className="px-5 py-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <Figure
          label="Register, in scope"
          value={moneyExact(comparison.comparedRegisterCost)}
          sub={`of ${money(comparison.registerTotal)} on the register`}
        />
        <Figure
          label="Return, placed"
          value={moneyExact(comparison.comparedReportedCost)}
          sub={`of ${money(comparison.reportedTotal)} reported`}
        />
      </div>

      {span > 0 ? (
        <>
          <div className="mt-4 flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-plane)]">
            {/* The Tooltip wrapper is an inline-flex span, which would collapse a
                percentage-width flex child — the legend below carries the same
                two facts, so the bar stays a bar. */}
            {segments.map((segment) => (
              <div
                key={segment.key}
                className={cn('h-full', segment.className)}
                style={{ width: `${(segment.value / span) * 100}%` }}
                title={`${segment.label} — ${moneyExact(segment.value)}`}
              />
            ))}
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {segments.map((segment) => (
              <li key={segment.key} className="flex items-baseline gap-2">
                <span className={cn('mt-1 size-2 shrink-0 rounded-full', segment.className)} />
                <span className="text-xs text-[var(--color-ink-secondary)]">{segment.label}</span>
                <span className="tabular text-xs font-semibold">{money(segment.value)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** What the same two sides are worth once the district's tables are applied. */
function Values({ comparison }: { comparison: RegisterComparison }) {
  if (!comparison.hasSchedule || comparison.valueDifference === null) return null;

  const difference = comparison.valueDifference;
  const materially = Math.abs(difference) >= 1;
  const unpriced = comparison.unpricedRegisterCost + comparison.unpricedReportedCost;

  return (
    <div className="border-t border-[var(--color-hairline)] bg-[var(--color-plane)] px-5 py-4">
      <dl className="tabular flex flex-wrap items-baseline gap-x-8 gap-y-2 text-sm">
        <div className="flex gap-2">
          <dt className="text-[var(--color-ink-secondary)]">
            {comparison.unpricedReportedCost > 0 ? 'Value as filed, at least' : 'Value as filed'}
          </dt>
          <dd className="font-semibold">{moneyExact(comparison.reportedValue)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[var(--color-ink-secondary)]">
            {comparison.unpricedRegisterCost > 0
              ? 'Value the register supports, at least'
              : 'Value the register supports'}
          </dt>
          <dd className="font-semibold">{moneyExact(comparison.registerValue)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-[var(--color-ink-secondary)]">Difference</dt>
          <dd
            className={cn(
              'font-semibold',
              !materially
                ? ''
                : difference > 0
                  ? 'text-[var(--color-good)]'
                  : 'text-[var(--color-critical)]',
            )}
          >
            {difference > 0 ? '+' : ''}
            {moneyExact(difference)}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-[var(--color-ink-muted)]">
        {!materially
          ? 'The two sides value the same on the district’s tables.'
          : difference > 0
            ? 'The return is carrying more value than the register supports — that gap is the position.'
            : 'The register supports more value than the return carries. Correcting it raises the client’s position, which is why it is on the page.'}
        {unpriced > 0 ? (
          <>
            {' '}
            <span className="text-[var(--color-warning)]">
              {comparison.unpricedRegisterCost > 0
                ? `${moneyExact(comparison.unpricedRegisterCost)} of register cost`
                : ''}
              {comparison.unpricedRegisterCost > 0 && comparison.unpricedReportedCost > 0
                ? ' and '
                : ''}
              {comparison.unpricedReportedCost > 0
                ? `${moneyExact(comparison.unpricedReportedCost)} of reported cost`
                : ''}{' '}
              could not be valued — usually a missing acquisition year — so the figures above are
              floors and the difference between them is not settled.
            </span>
          </>
        ) : null}
      </p>
    </div>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
        {label}
      </p>
      <p className="tabular mt-0.5 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="tabular mt-0.5 text-xs text-[var(--color-ink-muted)]">{sub}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

function FindingRow({ finding }: { finding: ComparisonFinding }) {
  const [open, setOpen] = useState(false);
  const kind = KIND_META[finding.kind];
  const exposure = finding.effect === 'exposure';
  const detailCount = finding.assets.length + finding.cells.length;

  return (
    <li className={cn('px-5 py-4', exposure ? 'bg-[color-mix(in_oklab,var(--color-critical)_4%,transparent)]' : '')}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {exposure ? (
              <ShieldAlert size={14} strokeWidth={2} className="text-[var(--color-critical)]" />
            ) : (
              <TrendingDown size={14} strokeWidth={2} className="text-[var(--color-good)]" />
            )}
            <h3 className="text-sm font-semibold">{finding.title}</h3>
            <Tooltip title={kind.label} content={kind.help}>
              <span className="cursor-help">
                <Badge tone={kind.tone}>{kind.label}</Badge>
              </span>
            </Tooltip>
            {exposure ? <Badge tone="critical">exposure</Badge> : null}
          </div>
          <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {finding.summary}
          </p>
          <p className="mt-2 max-w-3xl border-l-2 border-[var(--color-hairline)] pl-3 text-xs leading-relaxed text-[var(--color-ink-muted)]">
            {finding.basis}
          </p>
          {finding.assumption ? (
            <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-[var(--color-ink-muted)] italic">
              {finding.assumption}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 text-right">
          <p
            className={cn(
              'tabular text-xl font-semibold',
              exposure ? 'text-[var(--color-critical)]' : '',
            )}
          >
            {money(finding.value ?? finding.cost)}
          </p>
          <p className="text-[11px] text-[var(--color-ink-muted)]">
            {finding.value === null
              ? 'of cost · no schedule to value it'
              : `of value · ${money(finding.cost)} of cost`}
          </p>
        </div>
      </div>

      {detailCount > 0 ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded text-[11px] text-[var(--color-ink-secondary)] outline-none hover:text-[var(--color-ink)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]"
          >
            <ChevronDown
              size={12}
              strokeWidth={2}
              className={cn('transition-transform', open ? 'rotate-180' : '')}
            />
            {open ? 'Hide' : 'Show'} what is behind this
          </button>

          {open ? (
            <div className="mt-2 space-y-3">
              {finding.cells.length > 0 ? <CellTable cells={finding.cells} /> : null}
              {finding.assets.length > 0 ? (
                <div className="overflow-x-auto rounded-md border border-[var(--color-hairline)]">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)] text-[10px] tracking-wide text-[var(--color-ink-muted)] uppercase">
                        <th className="px-3 py-1.5 text-left font-medium">Register asset</th>
                        <th className="px-3 py-1.5 text-right font-medium">Acquired</th>
                        <th className="px-3 py-1.5 text-right font-medium">Cost</th>
                        <th className="px-3 py-1.5 text-right font-medium">Schedule value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {finding.assets.map((row) => (
                        <tr
                          key={row.assetId}
                          className="border-b border-[var(--color-hairline)] last:border-0"
                        >
                          <td className="px-3 py-1.5">{row.description ?? '—'}</td>
                          <td className="tabular px-3 py-1.5 text-right">
                            {row.acquisitionYear ?? '—'}
                          </td>
                          <td className="tabular px-3 py-1.5 text-right">
                            {moneyExact(row.originalCost)}
                          </td>
                          <td className="tabular px-3 py-1.5 text-right">
                            {moneyExact(row.scheduleValue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </li>
  );
}

function CellTable({ cells }: { cells: ComparisonFinding['cells'] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--color-hairline)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)] text-[10px] tracking-wide text-[var(--color-ink-muted)] uppercase">
            <th className="px-3 py-1.5 text-left font-medium">Category</th>
            <th className="px-3 py-1.5 text-right font-medium">Acquired</th>
            <th className="px-3 py-1.5 text-right font-medium">Register</th>
            <th className="px-3 py-1.5 text-right font-medium">Return</th>
            <th className="px-3 py-1.5 text-right font-medium">Difference</th>
          </tr>
        </thead>
        <tbody>
          {cells.map((cell) => (
            <tr
              key={`${cell.categoryKey}-${cell.yearAcquired ?? 'none'}`}
              className="border-b border-[var(--color-hairline)] last:border-0"
            >
              <td className="px-3 py-1.5">
                {cell.label}
                {/* The filer's own words, kept so the mapping can be argued with. */}
                {cell.wordings.length > 0 ? (
                  <span className="ml-1.5 text-[var(--color-ink-muted)]">
                    {cell.wordings.map((w) => `“${w}”`).join(', ')}
                  </span>
                ) : null}
              </td>
              <td className="tabular px-3 py-1.5 text-right">{cell.yearAcquired ?? '—'}</td>
              <td className="tabular px-3 py-1.5 text-right">{moneyExact(cell.registerCost)}</td>
              <td className="tabular px-3 py-1.5 text-right">{moneyExact(cell.reportedCost)}</td>
              <td
                className={cn(
                  'tabular px-3 py-1.5 text-right font-medium',
                  cell.difference > 0
                    ? 'text-[var(--color-warning)]'
                    : cell.difference < 0
                      ? 'text-[var(--color-critical)]'
                      : '',
                )}
              >
                {cell.difference > 0 ? '+' : ''}
                {moneyExact(cell.difference)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Category by category
// ---------------------------------------------------------------------------

function CategoryTable({ comparison }: { comparison: RegisterComparison }) {
  return (
    <Card>
      <CardHeader
        title="Category by category"
        description="Open a row for its acquisition years."
        help="A category can agree in total and disagree in every vintage inside it, which on an indexed schedule is most of what the property is worth."
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)] text-[10px] tracking-wide text-[var(--color-ink-muted)] uppercase">
              <th className="px-5 py-2 text-left font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Register</th>
              <th className="px-3 py-2 text-right font-medium">Return</th>
              <th className="px-3 py-2 text-right font-medium">Difference</th>
              <th className="px-5 py-2 text-right font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {comparison.categories.map((category) => (
              <CategoryRow key={category.categoryKey} category={category} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CategoryRow({ category }: { category: ComparisonCategory }) {
  const [open, setOpen] = useState(false);
  const verdict = VERDICT_META[category.verdict];

  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer border-b border-[var(--color-hairline)] hover:bg-[var(--color-plane)]"
      >
        <td className="px-5 py-2">
          <span className="flex items-center gap-1.5">
            <ChevronDown
              size={12}
              strokeWidth={2}
              className={cn(
                'shrink-0 text-[var(--color-ink-muted)] transition-transform',
                open ? 'rotate-180' : '-rotate-90',
              )}
            />
            <span className="font-medium">{category.label}</span>
            <span className="text-xs text-[var(--color-ink-muted)]">
              {count(category.cells.length)} {plural(category.cells.length, 'year')}
            </span>
          </span>
        </td>
        <td className="tabular px-3 py-2 text-right">{moneyExact(category.registerCost)}</td>
        <td className="tabular px-3 py-2 text-right">{moneyExact(category.reportedCost)}</td>
        <td
          className={cn(
            'tabular px-3 py-2 text-right font-medium',
            category.difference > 0
              ? 'text-[var(--color-warning)]'
              : category.difference < 0
                ? 'text-[var(--color-critical)]'
                : 'text-[var(--color-ink-muted)]',
          )}
        >
          {category.difference > 0 ? '+' : ''}
          {moneyExact(category.difference)}
        </td>
        <td className="px-5 py-2 text-right">
          <span className="inline-flex items-center gap-1.5">
            {category.yearsDisagree ? (
              <Tooltip
                title="Right total, wrong years"
                content="The category agrees in total, but its acquisition years do not line up. The district indexes cost by vintage, so the same total spread across different years is a different value."
              >
                <span className="cursor-help">
                  <AlertTriangle
                    size={12}
                    strokeWidth={2}
                    className="text-[var(--color-warning)]"
                  />
                </span>
              </Tooltip>
            ) : null}
            <Badge tone={verdict.tone}>{verdict.label}</Badge>
          </span>
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)]">
          <td colSpan={5} className="px-5 py-3">
            <CellTable cells={category.cells} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// What the comparison did not touch
// ---------------------------------------------------------------------------

/**
 * Printed as prominently as anything above it, and deliberately so. Every
 * dollar here is a dollar the comparison chose not to reason about, and a
 * reader who does not know its size cannot judge the size of anything else.
 */
function OutOfScope({ comparison }: { comparison: RegisterComparison }) {
  const registerAside = comparison.registerAside.reduce((sum, aside) => sum + aside.cost, 0);
  const reportedAside = comparison.reportedAside.reduce((sum, bucket) => sum + bucket.reported, 0);
  const unsettled = comparison.reportedAside.filter((b) => b.reason === 'needs-review');

  return (
    <Card>
      <CardHeader
        title="What this comparison did not touch"
        description="Held out rather than netted."
        help="Cost on either side that is not in the columns above is here, with the reason it is here — folding it into the totals would make the comparison balance by accident."
      />

      {registerAside === 0 && reportedAside === 0 ? (
        <div className="px-5 py-4">
          <p className="text-sm text-[var(--color-ink-secondary)]">
            Both sides are fully in scope: every register row and every reported dollar reached a
            category and a year.
          </p>
        </div>
      ) : (
        <div className="grid gap-px bg-[var(--color-hairline)] sm:grid-cols-2">
          <AsideList
            title="From the register"
            total={registerAside}
            items={comparison.registerAside.map((aside) => ({
              key: aside.reason,
              label: aside.label,
              detail: `${count(aside.assetCount)} ${plural(aside.assetCount, 'asset')}`,
              amount: aside.cost,
              warn: aside.reason === 'needs-review' || aside.reason === 'unclassified',
            }))}
          />
          <AsideList
            title="From the return"
            total={reportedAside}
            items={comparison.reportedAside.map((bucket) => ({
              key: `${bucket.reason}-${bucket.categoryKey ?? 'none'}`,
              label: bucket.label,
              detail: `${count(bucket.lineCount)} ${plural(bucket.lineCount, 'line')}${
                bucket.wordings.length > 0
                  ? ` · ${bucket.wordings.map((w) => `“${w}”`).join(', ')}`
                  : ''
              }`,
              amount: bucket.reported,
              warn: bucket.reason === 'needs-review' || bucket.reason === 'blended',
            }))}
          />
        </div>
      )}

      {unsettled.length > 0 ? (
        <div className="flex items-start gap-2 border-t border-[var(--color-hairline)] bg-[color-mix(in_oklab,var(--color-warning)_8%,transparent)] px-5 py-3">
          <Scale size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed">
            {money(unsettled.reduce((sum, b) => sum + b.reported, 0))} of the return is still in the
            mapping queue. Settle it before this comparison goes anywhere: an unread line is not
            evidence of an omission, and a finding built on one would be ours rather than theirs.
          </p>
        </div>
      ) : null}

      <div className="border-t border-[var(--color-hairline)] px-5 py-3">
        <p className="tabular text-xs text-[var(--color-ink-muted)]">
          {count(comparison.coverage.comparedAssetCount)} of{' '}
          {count(comparison.coverage.assetCount)} register{' '}
          {plural(comparison.coverage.assetCount, 'asset')} compared ·{' '}
          {count(comparison.coverage.comparedLineCount)}{' '}
          {plural(comparison.coverage.comparedLineCount, 'line')} of the return placed
          {comparison.coverage.unvaluableAssetCount > 0
            ? ` · ${count(comparison.coverage.unvaluableAssetCount)} compared ${plural(
                comparison.coverage.unvaluableAssetCount,
                'asset',
              )} the schedules could not value, usually a missing acquisition year`
            : ''}
        </p>
      </div>
    </Card>
  );
}

function AsideList({
  title,
  total,
  items,
}: {
  title: string;
  total: number;
  items: { key: string; label: string; detail: string; amount: number; warn: boolean }[];
}) {
  return (
    <div className="bg-[var(--color-surface)] px-5 py-4">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
          {title}
        </p>
        <p className="tabular text-sm font-semibold">{moneyExact(total)}</p>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">Nothing held out.</p>
      ) : (
        <ul className="mt-2 divide-y divide-[var(--color-hairline)]">
          {items.map((item) => (
            <li key={item.key} className="flex items-baseline justify-between gap-4 py-2">
              <div className="min-w-0">
                <p className="text-sm">{item.label}</p>
                <p className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
                  {item.detail}
                </p>
              </div>
              <p
                className={cn(
                  'tabular shrink-0 text-sm font-semibold',
                  item.warn ? 'text-[var(--color-warning)]' : '',
                )}
              >
                {moneyExact(item.amount)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
