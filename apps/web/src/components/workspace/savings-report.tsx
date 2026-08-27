'use client';

import { ChevronDown, ExternalLink, FileWarning, Search, TrendingDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { AskRecord, FindingKind, SavingsFinding, SavingsReport } from '@tangible/types';
import { cn } from '@/lib/cn';
import { count, day, money, moneyExact, percent, plural } from '@/lib/format';
import {
  Badge,
  Card,
  CardHeader,
  PageHeader,
  Stat,
  StatCell,
  TextLink,
} from '@/components/ui/primitives';
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

export function SavingsReportView({
  report,
  asks = [],
  back,
  actions,
}: {
  report: SavingsReport;
  /**
   * The season's asks ledger, so a screening finding can print the answer the
   * client has already given for it. The report is what an operator has open
   * on a call; a question settled last week in the portal and still shown here
   * as outstanding is how the same question gets asked twice.
   */
  asks?: AskRecord[];
  back?: ReactNode;
  /** What can be done with the report — rendered beside its title. */
  actions?: ReactNode;
}) {
  const priced = report.findings.filter((f) => f.valueRemoved !== null);
  const screening = report.findings.filter((f) => f.valueRemoved === null);

  return (
    <div className="space-y-6">
      {/* The report's own name is the page's name. It had been the heading of
          the first card, which left the page itself unnamed and put the
          provenance line — where the schedules came from, and when it was
          prepared — in the same grey as a card subtitle. */}
      <PageHeader
        back={back}
        title={`${report.clientName} — ${report.taxYear} business personal property`}
        description={`${report.jurisdictionName ?? report.jurisdictionId ?? 'Jurisdiction not set'} · prepared ${new Date(report.generatedAt).toLocaleDateString()}`}
        actions={actions}
      />
      <Headline report={report} asks={asks} />

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
              <FindingRow
                key={finding.key}
                finding={finding}
                rate={report.blendedTaxRate}
                ask={asks.find((row) => row.subject === finding.key) ?? null}
              />
            ))}
          </ul>
        </Card>
      ) : null}

      <Coverage report={report} />
    </div>
  );
}

function Headline({ report, asks }: { report: SavingsReport; asks: AskRecord[] }) {
  const { assessed, valueReduction, estimatedAnnualSaving } = report;

  return (
    <Card>
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
            {/* Pushed to the far right only while there is a far right. Stacked
                on a phone it reads as the third figure in a column, and a
                right-aligned column of one looks like a mistake. */}
            <div className="w-full text-left sm:ml-auto sm:w-auto sm:text-right">
              <p className="text-2xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
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
              <p className="text-xs text-[var(--color-ink-muted)]">
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

      <LeakageBand report={report} asks={asks} />

      <div className="grid grid-cols-2 gap-px overflow-hidden border-b border-[var(--color-hairline)] lg:grid-cols-3">
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
          label="Exemption applied"
          value={money(report.exemption.applied)}
          note={report.exemption.basis}
          noteHelp={report.exemption.caveat}
        />
      </div>

      <Method report={report} />
    </Card>
  );
}

/**
 * The leakage headline as three numbers, never one. A single dollarized total
 * blends what was computed with what was assumed and what is still only a
 * question, and collapses under the first sophisticated question about it.
 * Kept apart, each number is defensible on its own terms — and a lead is a
 * count on purpose, because a question does not have a dollar figure yet.
 */
function LeakageBand({ report, asks }: { report: SavingsReport; asks: AskRecord[] }) {
  const l = report.leakage;
  if (!l || (l.measuredValue === 0 && l.modeledValue === 0 && l.leadCount === 0)) return null;
  const rate = report.blendedTaxRate;
  // One row of "everything is one jurisdiction" is the headline repeated, so
  // the split only renders when there is a split to show.
  const split = l.byJurisdiction.length > 1 ? l.byJurisdiction : null;

  // Answering a lead does not price it — each needs its own rule, and a number
  // that appeared the moment a client typed a sentence would be a guess. So the
  // note says what is actually outstanding: the question, or the pricing.
  const leads = report.findings.filter((finding) => finding.kind === 'screening');
  const answered = leads.filter(
    (finding) => asks.find((ask) => ask.subject === finding.key)?.status === 'answered',
  ).length;
  const leadNote =
    answered === 0
      ? 'not counted until answered'
      : answered === leads.length
        ? 'answered — still to be priced by hand'
        : `${count(answered)} of ${count(leads.length)} answered, none priced yet`;

  return (
    <div className="border-b border-[var(--color-hairline)] px-5 py-4">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
        <LeakageFigure
          label="Measured"
          value={money(l.measuredValue)}
          note={`≈ ${money(l.measuredValue * rate)} of tax a year`}
          tone="good"
          help={KIND_META.measured.help}
        />
        <LeakageFigure
          label="Modeled"
          value={money(l.modeledValue)}
          note={`≈ ${money(l.modeledValue * rate)} of tax a year`}
          tone="accent"
          help={KIND_META.modeled.help}
        />
        <LeakageFigure
          label="Leads worth pursuing"
          value={`${count(l.leadCount)}`}
          note={`on ${money(l.leadCost)} of cost — ${leadNote}`}
          tone="warning"
          help={KIND_META.screening.help}
        />
      </div>

      {split ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-2xs text-left font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                <th className="py-1.5 pr-4 font-medium">Jurisdiction</th>
                <th className="py-1.5 pr-4 font-medium">Sites</th>
                <th className="py-1.5 pr-4 text-right font-medium">Measured</th>
                <th className="py-1.5 pr-4 text-right font-medium">Modeled</th>
                <th className="py-1.5 text-right font-medium">Leads</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-hairline)]">
              {split.map((row) => (
                <tr key={row.jurisdictionId ?? '(unplaced)'}>
                  <td className="py-1.5 pr-4">
                    {row.jurisdictionName ?? row.jurisdictionId ?? (
                      <span className="text-[var(--color-warning)]">No site placed yet</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-4 text-[var(--color-ink-secondary)]">
                    {row.siteLabels.length > 0 ? row.siteLabels.join(', ') : '—'}
                  </td>
                  <td className="tabular py-1.5 pr-4 text-right">{money(row.measuredValue)}</td>
                  <td className="tabular py-1.5 pr-4 text-right">{money(row.modeledValue)}</td>
                  <td className="tabular py-1.5 text-right">{count(row.leadCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const LEAKAGE_TONE: Record<'good' | 'accent' | 'warning', string> = {
  good: 'text-[var(--color-good)]',
  accent: 'text-[var(--color-accent)]',
  warning: 'text-[var(--color-warning)]',
};

function LeakageFigure({
  label,
  value,
  note,
  tone,
  help,
}: {
  label: string;
  value: string;
  note: string;
  tone: 'good' | 'accent' | 'warning';
  help: string;
}) {
  return (
    <Tooltip title={label} content={help}>
      <span className="cursor-help">
        <span className="text-2xs block font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
          {label}
        </span>
        <span className={cn('tabular block text-2xl font-semibold', LEAKAGE_TONE[tone])}>
          {value}
        </span>
        <span className="block text-xs leading-snug text-[var(--color-ink-muted)]">{note}</span>
      </span>
    </Tooltip>
  );
}

/**
 * What the figures were computed from.
 *
 * These had been one middot-joined sentence under the page title, three lines
 * long, with the "we used last year's schedule" warning buried mid-clause. They
 * are not one fact: a controller who doubts the total reaches for exactly one
 * of them — which schedule, which life — and has to pick it back out of the
 * prose. Labelled, each is answerable on its own, and the warnings sit where
 * the eye already is rather than inside a sentence.
 *
 * At the foot of the card rather than the head of it, because it explains
 * numbers the reader has already seen.
 */
function Method({ report }: { report: SavingsReport }) {
  return (
    <dl className="flex flex-wrap gap-x-10 gap-y-3 px-5 py-3.5">
      <MethodFact label="Valued on">
        {report.schedule ? (
          <>
            <TextLink href={report.schedule.url} external>
              {report.schedule.title}
              <ExternalLink size={10} strokeWidth={2} />
            </TextLink>{' '}
            <span className="text-[var(--color-ink-muted)]">p.&nbsp;{report.schedule.pages}</span>
            {report.schedule.isFallbackYear ? (
              <span className="block text-[var(--color-warning)]">
                The {report.schedule.taxYear} schedule — nothing is published yet for{' '}
                {report.taxYear}.
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-[var(--color-warning)]">No schedule set</span>
        )}
      </MethodFact>

      <MethodFact label="Machinery life">
        {report.sic ? (
          <>
            {report.sic.machineryLife}-year{' '}
            <span className="text-[var(--color-ink-muted)]">
              · SIC {report.sic.code} ({report.sic.description.toLowerCase()})
            </span>
          </>
        ) : (
          <span className="text-[var(--color-warning)]">
            10-year placeholder — no SIC set, so this is not the district&rsquo;s published life
          </span>
        )}
      </MethodFact>
    </dl>
  );
}

function MethodFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-0.5 text-xs leading-relaxed">{children}</dd>
    </div>
  );
}

function Figure({ label, value, help }: { label: string; value: string; help: string }) {
  return <Stat size="lg" label={label} value={value} help={help} />;
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
    <StatCell>
      <Stat
        label={label}
        value={value}
        tone={strong ? 'accent' : 'default'}
        note={
          note && noteHelp ? (
            <Tooltip title={label} content={noteHelp}>
              <span className="cursor-help underline decoration-dotted underline-offset-2">
                {note}
              </span>
            </Tooltip>
          ) : (
            note
          )
        }
      />
    </StatCell>
  );
}

function FindingRow({
  finding,
  rate,
  ask = null,
}: {
  finding: SavingsFinding;
  rate: number;
  /** The client's own answer to this finding's question, once there is one. */
  ask?: AskRecord | null;
}) {
  const [open, setOpen] = useState(false);
  // A screening finding that has been answered is no longer waiting on anyone
  // outside the firm, and printing "needs an answer" directly above the answer
  // is how a report stops being believed.
  const meta =
    ask?.status === 'answered'
      ? {
          label: 'answered — not yet priced',
          tone: 'good' as const,
          help: 'The client has answered the question this finding turns on. Pricing it is a separate judgment their answer does not make on its own, so it stays out of the figures above until somebody works it through.',
        }
      : KIND_META[finding.kind];

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
          {/* Body size, not footnote size. This is the sentence the client
              actually reads, and it had been set in the same 13px as the
              statutory basis quoted under it — two tiers of type a pixel
              apart, which reads as one grey block rather than a finding and
              its authority. */}
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-[var(--color-ink-secondary)]">
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
          {ask ? <ClientAnswer ask={ask} /> : null}
        </div>

        <div className="shrink-0 text-right">
          {finding.valueRemoved !== null ? (
            <>
              <p className="tabular text-xl font-semibold">{money(finding.valueRemoved)}</p>
              <p className="text-xs text-[var(--color-ink-muted)]">
                value off · {money(finding.valueRemoved * rate)}/yr
              </p>
            </>
          ) : (
            <>
              <p className="tabular text-xl font-semibold text-[var(--color-ink-muted)]">
                {money(finding.originalCost)}
              </p>
              <p className="text-xs text-[var(--color-ink-muted)]">of cost in scope</p>
            </>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-2 inline-flex cursor-pointer items-center gap-1 rounded text-xs text-[var(--color-ink-secondary)] outline-none hover:text-[var(--color-ink)] focus-visible:ring-[3px] focus-visible:ring-[color-mix(in_oklab,var(--color-accent)_30%,transparent)]"
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
              <tr className="text-2xs border-b border-[var(--color-hairline)] bg-[var(--color-plane)] tracking-wide text-[var(--color-ink-muted)] uppercase">
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
                  <td className="px-3 py-1.5">
                    {row.description ?? '—'}
                    {/* The register's own tag, where it had one — the only
                        handle that means anything in a call with the client. */}
                    {row.assetTag ? (
                      <span className="ml-1.5 font-mono text-[var(--color-ink-muted)]">
                        {row.assetTag}
                      </span>
                    ) : null}
                  </td>
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
            <p className="px-3 py-1.5 text-xs text-[var(--color-ink-muted)]">
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
      {/* Body size. This is the paragraph a sceptical controller reads
          hardest — what the total leaves out — and it had been set two steps
          below the findings it qualifies. */}
      <div className="px-5 py-4 text-sm leading-relaxed text-[var(--color-ink-secondary)]">
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
        <p className="mt-3 flex items-start gap-1.5 text-xs text-[var(--color-ink-muted)]">
          <Search size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
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

/**
 * What the client said when this question was put to them.
 *
 * Printed as the client's words, not paraphrased into the finding: the whole
 * point of the ledger is that the answer on the record is the one they gave.
 * An unanswered question shows as asked-and-waiting rather than disappearing —
 * knowing it is out there is what stops it being asked again.
 */
function ClientAnswer({ ask }: { ask: AskRecord }) {
  if (ask.status !== 'answered' || ask.answer === null) {
    return (
      <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
        Asked in the client portal {day(ask.createdAt.slice(0, 10))} — no answer yet.
      </p>
    );
  }
  return (
    <div className="mt-2.5 max-w-3xl rounded-[var(--radius-control)] border border-[color-mix(in_oklab,var(--color-good)_28%,transparent)] bg-[var(--color-good-soft)] px-3 py-2">
      <p className="eyebrow">The client answered</p>
      <p className="mt-1 text-sm leading-relaxed">{ask.answer}</p>
      {ask.answeredAt ? (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
          {day(ask.answeredAt.slice(0, 10))}
        </p>
      ) : null}
    </div>
  );
}
