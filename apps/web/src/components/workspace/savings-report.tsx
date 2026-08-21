'use client';

import { ChevronDown, ExternalLink, FileWarning, Search, TrendingDown } from 'lucide-react';
import { useState } from 'react';
import type { FindingKind, SavingsFinding, SavingsReport } from '@tangible/types';
import { cn } from '@/lib/cn';
import { count, money, moneyExact, percent, plural } from '@/lib/format';
import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The deliverable.
 *
 * This is the page that goes in front of somebody who has not agreed to
 * anything, which makes its job persuasion *by* transparency rather than
 * instead of it. Everything a sceptical controller would reach for is already
 * on the page: which schedule produced each number and a link to it, how solid
 * each finding is, the assumption behind every modeled one, the evidence rows,
 * and — printed as prominently as the total — what the report does not cover.
 *
 * The rule that shapes the layout: a question is never rendered as a saving.
 * Screening findings sit in their own section, below the total, with no dollar
 * figure attached, because the fastest way to lose a client is to headline a
 * number that falls apart the first time they ask how it was arrived at.
 */

const KIND_META: Record<
  FindingKind,
  { label: string; tone: 'good' | 'accent' | 'warning'; help: string }
> = {
  measured: {
    label: 'measured',
    tone: 'good',
    help: 'Computed from the register and the district’s published schedules. The number is what it is.',
  },
  modeled: {
    label: 'modeled',
    tone: 'accent',
    help: 'Rests on a stated assumption about how the property was rendered. The assumption is printed with the finding so you can disagree with it.',
  },
  screening: {
    label: 'needs an answer',
    tone: 'warning',
    help: 'Worth real money, but not computable from a fixed asset register alone. It needs one question answered — and it is deliberately not counted in the total until then.',
  },
};

export function SavingsReportView({ report }: { report: SavingsReport }) {
  const priced = report.findings.filter((f) => f.valueRemoved !== null);
  const screening = report.findings.filter((f) => f.valueRemoved === null);

  return (
    <div className="space-y-6">
      <Headline report={report} />

      {priced.length > 0 ? (
        <Card>
          <CardHeader
            title="What comes off the rendition"
            description="Each line is an adjustment to the value rendered."
            help="Every adjustment carries the register rows behind it and the statutory basis it rests on — a number without its basis is not a finding."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {priced.map((finding) => (
              <FindingRow key={finding.key} finding={finding} rate={report.blendedTaxRate} />
            ))}
          </ul>
        </Card>
      ) : null}

      {screening.length > 0 ? (
        <Card>
          <CardHeader
            title="Worth asking about"
            description="Levers a register cannot settle on its own."
            help="Each needs one answer from the client, and none of them is counted in the figures above — an unanswered question is not a saving."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {screening.map((finding) => (
              <FindingRow key={finding.key} finding={finding} rate={report.blendedTaxRate} />
            ))}
          </ul>
        </Card>
      ) : null}

      <Coverage report={report} />
    </div>
  );
}

function Headline({ report }: { report: SavingsReport }) {
  const { assessed, valueReduction, estimatedAnnualSaving } = report;

  return (
    <Card>
      <CardHeader
        title={`${report.clientName} — ${report.taxYear} business personal property`}
        description={<Provenance report={report} />}
      />

      {assessed && valueReduction !== null ? (
        <div className="border-b border-[var(--color-hairline)] px-5 py-5">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <Figure
              label={`Assessed today (${assessed.taxYear})`}
              value={money(assessed.appraisedValue ?? assessed.assessedValue)}
              help={`What Harris County has this account at on the public roll, account ${assessed.accountId}.`}
            />
            <Arrow />
            <Figure
              label="What the register supports"
              value={money(report.proposedTaxableValue)}
              help="The corrected position: settled classifications valued on the district's own schedules, less the statutory exemption."
            />
            <div className="ml-auto text-right">
              <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                Estimated annual saving
              </p>
              <p
                className={cn(
                  'tabular text-3xl font-semibold',
                  (estimatedAnnualSaving ?? 0) > 0
                    ? 'text-[var(--color-good)]'
                    : 'text-[var(--color-ink)]',
                )}
              >
                {money(estimatedAnnualSaving)}
              </p>
              <p className="text-[11px] text-[var(--color-ink-muted)]">
                {money(valueReduction)} of value at {percent(report.blendedTaxRate, 2)}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)] px-5 py-3">
          <p className="flex items-start gap-2 text-xs leading-relaxed">
            <FileWarning
              size={14}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-[var(--color-warning)]"
            />
            <span>
              <span className="font-medium">No saving is claimed yet.</span> Link this engagement to
              its account on the public roll and the report can compare the corrected position
              against what the district actually has. Without that there is no &ldquo;before&rdquo;,
              and a saving measured against nothing is not one.
            </span>
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-px border-b border-[var(--color-hairline)] bg-[var(--color-hairline)] lg:grid-cols-4">
        <Tile
          label="Register cost"
          value={money(report.farOriginalCost)}
          note={`${count(report.coverage.valuedCount)} settled ${plural(report.coverage.valuedCount, 'asset')}`}
        />
        <Tile
          label="Schedule value"
          value={money(report.farImpliedValue)}
          note={
            report.farOriginalCost > 0
              ? `${percent(report.farImpliedValue / report.farOriginalCost, 0)} of cost`
              : undefined
          }
        />
        <Tile
          label="Adjustments identified"
          value={money(report.totalValueRemoved)}
          note={`${count(report.findings.filter((f) => f.valueRemoved !== null).length)} priced ${plural(report.findings.filter((f) => f.valueRemoved !== null).length, 'finding')}`}
          strong={report.totalValueRemoved > 0}
        />
        <Tile
          label="Exemption applied"
          value={money(report.exemption.applied)}
          note={report.exemption.basis}
          noteHelp={report.exemption.caveat}
        />
      </div>
    </Card>
  );
}

function Provenance({ report }: { report: SavingsReport }) {
  return (
    <>
      {report.jurisdictionName ?? report.jurisdictionId ?? 'Jurisdiction not set'}
      {report.schedule ? (
        <>
          {' · valued on '}
          <a
            href={report.schedule.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 hover:text-[var(--color-ink)]"
          >
            {report.schedule.title}
            <ExternalLink size={10} strokeWidth={2} />
          </a>
          {' (p. '}
          {report.schedule.pages})
          {report.schedule.isFallbackYear ? (
            <span className="text-[var(--color-warning)]">
              {' — the '}
              {report.schedule.taxYear} schedule, as nothing is published yet for {report.taxYear}
            </span>
          ) : null}
        </>
      ) : null}
      {report.sic ? (
        <>
          {' · machinery on the '}
          {report.sic.machineryLife}-year life for SIC {report.sic.code} (
          {report.sic.description.toLowerCase()})
        </>
      ) : (
        <span className="text-[var(--color-warning)]">
          {' · no SIC set, so machinery uses the '}
          10-year placeholder rather than the district&rsquo;s published life
        </span>
      )}
      {' · prepared '}
      {new Date(report.generatedAt).toLocaleDateString()}
    </>
  );
}

function Figure({ label, value, help }: { label: string; value: string; help: string }) {
  return (
    <Tooltip title={label} content={help}>
      <span className="cursor-help">
        <span className="block text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
          {label}
        </span>
        <span className="tabular block text-2xl font-semibold">{value}</span>
      </span>
    </Tooltip>
  );
}

function Arrow() {
  return (
    <TrendingDown
      size={20}
      strokeWidth={2}
      className="mb-1.5 shrink-0 text-[var(--color-ink-muted)]"
    />
  );
}

function Tile({
  label,
  value,
  note,
  noteHelp,
  strong,
}: {
  label: string;
  value: string;
  note?: string;
  noteHelp?: string;
  strong?: boolean;
}) {
  return (
    <div className="bg-[var(--color-surface)] px-5 py-3">
      <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
        {label}
      </p>
      <p
        className={cn(
          'tabular mt-1 text-xl font-semibold',
          strong ? 'text-[var(--color-series-1)]' : '',
        )}
      >
        {value}
      </p>
      {note ? (
        noteHelp ? (
          <Tooltip title={label} content={noteHelp}>
            <span className="mt-0.5 block cursor-help text-[11px] leading-snug text-[var(--color-ink-muted)] underline decoration-dotted underline-offset-2">
              {note}
            </span>
          </Tooltip>
        ) : (
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-ink-muted)]">{note}</p>
        )
      ) : null}
    </div>
  );
}

function FindingRow({ finding, rate }: { finding: SavingsFinding; rate: number }) {
  const [open, setOpen] = useState(false);
  const meta = KIND_META[finding.kind];

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{finding.title}</h3>
            <Tooltip title={meta.label} content={meta.help}>
              <span className="cursor-help">
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </span>
            </Tooltip>
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
          {finding.valueRemoved !== null ? (
            <>
              <p className="tabular text-xl font-semibold">{money(finding.valueRemoved)}</p>
              <p className="text-[11px] text-[var(--color-ink-muted)]">
                value off · {money(finding.valueRemoved * rate)}/yr
              </p>
            </>
          ) : (
            <>
              <p className="tabular text-xl font-semibold text-[var(--color-ink-muted)]">
                {money(finding.originalCost)}
              </p>
              <p className="text-[11px] text-[var(--color-ink-muted)]">of cost in scope</p>
            </>
          )}
        </div>
      </div>

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
        {open ? 'Hide' : 'Show'} the {count(finding.assetCount)}{' '}
        {plural(finding.assetCount, 'asset')} behind this
      </button>

      {open ? (
        <div className="mt-2 overflow-x-auto rounded-md border border-[var(--color-hairline)]">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--color-hairline)] bg-[var(--color-plane)] text-[10px] tracking-wide text-[var(--color-ink-muted)] uppercase">
                <th className="px-3 py-1.5 text-left font-medium">Asset</th>
                <th className="px-3 py-1.5 text-right font-medium">Acquired</th>
                <th className="px-3 py-1.5 text-right font-medium">Cost</th>
                <th className="px-3 py-1.5 text-right font-medium">Schedule value</th>
              </tr>
            </thead>
            <tbody>
              {finding.evidence.map((row) => (
                <tr
                  key={row.assetId}
                  className="border-b border-[var(--color-hairline)] last:border-0"
                >
                  <td className="px-3 py-1.5">{row.description ?? '—'}</td>
                  <td className="tabular px-3 py-1.5 text-right">{row.acquisitionYear ?? '—'}</td>
                  <td className="tabular px-3 py-1.5 text-right">{moneyExact(row.originalCost)}</td>
                  <td className="tabular px-3 py-1.5 text-right">
                    {moneyExact(row.scheduleValue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {finding.evidence.length < finding.assetCount ? (
            <p className="px-3 py-1.5 text-[11px] text-[var(--color-ink-muted)]">
              Showing the {count(finding.evidence.length)} largest of {count(finding.assetCount)}.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/**
 * What the report does not cover, stated as plainly as what it does. A total
 * that silently omits a third of the register looks complete, which makes it
 * more dangerous than one that admits the hole.
 */
function Coverage({ report }: { report: SavingsReport }) {
  const { coverage } = report;
  const gaps: string[] = [];
  if (coverage.needsReviewCount > 0) {
    gaps.push(`${count(coverage.needsReviewCount)} still in the classification review queue`);
  }
  if (coverage.unclassifiedCount > 0) {
    gaps.push(`${count(coverage.unclassifiedCount)} not yet classified`);
  }
  if (coverage.unvaluableCount > 0) {
    gaps.push(
      `${count(coverage.unvaluableCount)} missing a cost or acquisition year to value from`,
    );
  }

  return (
    <Card>
      <CardHeader
        title="What this covers"
        description="The scope of the analysis, stated so the figures above can be read for what they are."
      />
      <div className="px-5 py-4 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        <p>
          Of {count(coverage.assetCount)} {plural(coverage.assetCount, 'asset')} on the register,{' '}
          <span className="tabular font-medium text-[var(--color-ink)]">
            {count(coverage.valuedCount)}
          </span>{' '}
          {plural(coverage.valuedCount, 'is', 'are')} priced into the corrected position
          {coverage.inFindingsCount > 0 ? (
            <>
              {' and '}
              <span className="tabular font-medium text-[var(--color-ink)]">
                {count(coverage.inFindingsCount)}
              </span>{' '}
              {plural(coverage.inFindingsCount, 'is', 'are')} accounted for in the findings above —
              disposed or not taxable, so deliberately outside the total rather than missing from it
            </>
          ) : null}
          .
        </p>
        {gaps.length > 0 ? (
          <p className="mt-1.5">
            Not included: {gaps.join('; ')}. These are excluded from every figure above rather than
            counted at a guess — the numbers only move once a person has settled them.
          </p>
        ) : (
          <p className="mt-1.5">Every asset on the register has been classified and valued.</p>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-[var(--color-ink-muted)]">
          <Search size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
          <span>
            Figures are an estimate prepared from the client&rsquo;s own fixed asset register and
            the appraisal district&rsquo;s published schedules. They are not a filed rendition and
            not tax advice; the final position depends on the answers to the questions above and on
            review of the prior year&rsquo;s filing.
          </span>
        </p>
      </div>
    </Card>
  );
}
