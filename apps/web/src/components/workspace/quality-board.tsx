'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleCheck, FlaskConical, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { SCHEDULES } from '@tangible/valuation';
import type { FindingMetrics, QualityView, RuleStatus } from '@tangible/types';
import { api } from '@/lib/api';
import { count, day, money, percent, plural } from '@/lib/format';
import { Segmented } from '@/components/ui/controls';
import {
  Badge,
  Card,
  CardHeader,
  Callout,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';
import { AcceptanceCard } from '@/components/workspace/acceptance-card';
import { ModelCard } from '@/components/workspace/model-card';
import { RuleDraftCard } from '@/components/workspace/rule-draft-card';

/**
 * How well the engine is doing, and what stands behind every rule it applies.
 *
 * This screen exists because the incumbent failure mode in this market is not a
 * bad model, it is a good model nobody is measuring. A depreciation table goes
 * stale, a detector's threshold drifts, and both keep producing numbers that
 * look exactly like the right ones. So the page is built around two questions a
 * person can answer in one read: is the gate closed, and what is each detector's
 * precision where it is actually being used.
 *
 * Everything on it is measured off work the firm already did. There is no
 * labelling exercise anywhere in the product — a reviewer accepting or
 * rejecting a row in the queue *is* the label, stamped with the score and the
 * signals that row carried when they saw it.
 */
export function QualityBoard() {
  const [audience, setAudience] = useState<'firm' | 'client'>('firm');
  const quality = useQuery({ queryKey: ['quality'], queryFn: () => api.quality() });

  if (quality.error) return <ErrorState error={quality.error} />;
  if (!quality.data) return <Loading />;

  const view = quality.data;
  const report = audience === 'firm' ? view.report : view.clientReport;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality"
        eyebrow="Engine"
        description="Precision per finding type per jurisdiction, measured off the review queue, and the citation behind every rule the engine applies."
        meta={[
          `${count(view.report.labelCount)} ${plural(view.report.labelCount, 'label')}`,
          `${count(view.rules.length)} ${plural(view.rules.length, 'rule')}`,
          `gate ${view.gate.ok ? 'green' : 'red'}`,
        ]}
      />

      <GateCard view={view} />

      <Card>
        <CardHeader
          title="Precision"
          icon={FlaskConical}
          description="Of the rows somebody judged, the share they accepted. A finding that was deferred or is waiting on the client is not a verdict and is left out of the denominator."
          help="Recall is deliberately absent. A row the engine never flagged produces no decision, so no quantity of labels can measure what was missed — that question belongs to the golden fixtures, where the full expected set is written down by hand."
          action={
            <Segmented
              size="sm"
              ariaLabel="Whose decisions"
              value={audience}
              onChange={setAudience}
              options={[
                { value: 'firm', label: 'Firm' },
                { value: 'client', label: 'Client' },
              ]}
            />
          }
        />
        <StatGrid columns={4}>
          <StatCell>
            <Stat
              label="Labels"
              value={count(report.labelCount)}
              note={`${count(report.judgedCount)} judged`}
              help="Every accept, reject or deferral ever recorded on a savings finding. It grows by doing the work."
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Precision"
              value={report.precision === null ? '—' : percent(report.precision)}
              note={report.precision === null ? 'not enough judged rows' : 'across every finding'}
              tone={report.precision !== null && report.precision < 0.7 ? 'critical' : 'default'}
            />
          </StatCell>
          <StatCell>
            <Stat
              label="Engagements"
              value={count(report.engagementCount)}
              help="How many seasons the labels come from. A number built on one client's register measures that register."
            />
          </StatCell>
          <StatCell>
            <Stat label="Reviewers" value={count(report.reviewerCount)} />
          </StatCell>
        </StatGrid>

        {report.byFinding.length === 0 ? (
          <EmptyState title="Nothing judged yet">
            {audience === 'firm'
              ? 'Precision appears here as soon as somebody works a finding queue. Each accept or reject is one label.'
              : 'No client has accepted or rejected a row yet. Their decisions are scored apart from the firm’s — a controller declining to make an argument is not evidence the detector was wrong.'}
          </EmptyState>
        ) : (
          <MetricsTable rows={report.byFinding} target={report.byFinding[0]?.target ?? 200} />
        )}
      </Card>

      {report.byFindingJurisdiction.length > 1 ? (
        <Card>
          <CardHeader
            title="By jurisdiction"
            description="The same numbers split by district, because a detector that rests on a Texas statute is not the same detector in Florida."
          />
          <MetricsTable
            rows={report.byFindingJurisdiction}
            target={report.byFinding[0]?.target ?? 200}
            showJurisdiction
          />
        </Card>
      ) : null}

      {report.calibration.some((bin) => bin.judged > 0) ? (
        <Card>
          <CardHeader
            title="Calibration"
            description="What the engine said the odds were, against what happened. A row scored 0.8 should be right about eight times in ten."
            help="This is what makes the confidence score a number rather than a mood. If the observed column sits below the expected one, the scores are optimistic and the threshold control on the report is quietly selling positions the evidence does not support."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {report.calibration
              .filter((bin) => bin.judged > 0)
              .map((bin) => {
                const gap =
                  bin.observed === null || bin.expected === null
                    ? null
                    : bin.observed - bin.expected;
                return (
                  <li
                    key={bin.lower}
                    className="flex items-center gap-4 px-5 py-3 text-sm text-[var(--color-ink)]"
                  >
                    <span className="tabular w-24 shrink-0 text-[var(--color-ink-muted)]">
                      {bin.lower.toFixed(1)}–{bin.upper.toFixed(1)}
                    </span>
                    <span className="tabular w-20 shrink-0 text-[var(--color-ink-secondary)]">
                      {count(bin.judged)} judged
                    </span>
                    <span className="tabular w-28 shrink-0">
                      said {bin.expected === null ? '—' : percent(bin.expected)}
                    </span>
                    <span className="tabular w-28 shrink-0">
                      was {bin.observed === null ? '—' : percent(bin.observed)}
                    </span>
                    {gap === null ? null : (
                      <Badge tone={Math.abs(gap) < 0.1 ? 'good' : gap < 0 ? 'warning' : 'neutral'}>
                        {gap > 0 ? '+' : ''}
                        {percent(gap)}
                      </Badge>
                    )}
                  </li>
                );
              })}
          </ul>
        </Card>
      ) : null}

      {report.thresholds.some((point) => point.judged > 0) ? (
        <Card>
          <CardHeader
            title="Where to set the threshold"
            description="What the report's confidence floor buys and what it costs, priced in the value of the correct findings it would drop."
            help="The floor is already a control on the report and in each client's portal settings. This is the evidence for where to put it: precision rises as it rises, and the last column is the recovery that stops being shown to get there."
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead>
                <tr className="border-b border-[var(--color-hairline)] text-left">
                  <Th>Floor</Th>
                  <Th align="right">Rows kept</Th>
                  <Th align="right">Precision</Th>
                  <Th align="right">Correct kept</Th>
                  <Th align="right">Correct value dropped</Th>
                </tr>
              </thead>
              <tbody>
                {report.thresholds.map((point) => (
                  <tr key={point.threshold} className="border-b border-[var(--color-hairline)]">
                    <Td>{point.threshold.toFixed(2)}</Td>
                    <Td align="right">{count(point.judged)}</Td>
                    <Td align="right">
                      {point.precision === null ? '—' : percent(point.precision)}
                    </Td>
                    <Td align="right">
                      {point.keptCorrectShare === null ? '—' : percent(point.keptCorrectShare)}
                    </Td>
                    <Td align="right">{money(point.droppedCorrectValue)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/*
        Under precision and above the rules, which is the order these four
        answer a single question: is a finding right, how sure was the engine
        entitled to be, how often does a district agree it is right, and what
        does the firm stand on when it argues. The third is the only one
        measured off money rather than off opinion; the second is the only one
        that changes what the engine does next time.
      */}
      <ModelCard />

      <AcceptanceCard />

      <SchedulesCard />

      <RulesCard rules={view.rules} />

      <RuleDraftCard />

      {view.engagements.length > 0 ? (
        <Card>
          <CardHeader
            title="Measured over"
            description="Which seasons the labels come from. Precision built on one register is a fact about that register."
          />
          <ul className="divide-y divide-[var(--color-hairline)]">
            {view.engagements.map((engagement) => (
              <li
                key={engagement.id}
                className="flex items-center justify-between gap-4 px-5 py-3 text-sm"
              >
                <span className="truncate text-[var(--color-ink)]">
                  {engagement.clientName} · {engagement.taxYear}
                </span>
                <span className="tabular shrink-0 text-[var(--color-ink-muted)]">
                  {count(engagement.labels)} {plural(engagement.labels, 'label')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function GateCard({ view }: { view: QualityView }) {
  const gate = view.gate;
  return (
    <Card>
      <CardHeader
        title="Release gate"
        icon={gate.ok ? CircleCheck : ShieldAlert}
        description="Every golden in the repository, run against the rules as they stand right now."
        help="No rule or model change should reach a customer without this passing. A golden is a known asset and the value the district's own published arithmetic gives it, or a small register and the findings a person decided must and must not come off it."
        action={
          <Badge tone={gate.ok ? 'good' : 'critical'} dot>
            {gate.ok ? 'Passing' : `${count(gate.failures.length)} blocking`}
          </Badge>
        }
      />
      <StatGrid columns={3}>
        <StatCell>
          <Stat label="Goldens run" value={count(gate.goldensRun)} />
        </StatCell>
        <StatCell>
          <Stat
            label="Failing"
            value={count(gate.goldensFailed)}
            tone={gate.goldensFailed > 0 ? 'critical' : 'default'}
          />
        </StatCell>
        <StatCell>
          <Stat label="Run for" value={day(gate.ranAt)} />
        </StatCell>
      </StatGrid>
      {gate.failures.length > 0 ? (
        <div className="space-y-2 px-5 pb-4">
          {gate.failures.map((failure) => (
            <Callout key={failure} tone="critical" icon={ShieldAlert}>
              {failure}
            </Callout>
          ))}
        </div>
      ) : null}
      {gate.warnings.length > 0 ? (
        <div className="space-y-2 px-5 pb-5">
          {/* Said rather than hidden. A gap in the suite that nobody can see is
              the same as no suite at all. */}
          {gate.warnings.map((warning) => (
            <Callout key={warning} tone="warning" icon={TriangleAlert}>
              {warning}
            </Callout>
          ))}
        </div>
      ) : null}
    </Card>
  );
}

function MetricsTable({
  rows,
  target,
  showJurisdiction = false,
}: {
  rows: FindingMetrics[];
  target: number;
  showJurisdiction?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-[var(--color-hairline)] text-left">
            <Th>Finding</Th>
            {showJurisdiction ? <Th>District</Th> : null}
            <Th align="right">Judged</Th>
            <Th align="right">Precision</Th>
            <Th align="right">Value accepted</Th>
            <Th align="right">Toward {count(target)}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.findingKey}::${row.jurisdictionId ?? 'all'}`}
              className="border-b border-[var(--color-hairline)]"
            >
              <Td>{row.findingKey}</Td>
              {showJurisdiction ? <Td>{row.jurisdictionId ?? '—'}</Td> : null}
              <Td align="right">{count(row.judged)}</Td>
              <Td align="right">
                {row.precision === null ? (
                  <span className="text-[var(--color-ink-muted)]">
                    —{' '}
                    <InfoTip
                      size={12}
                      content={`${count(row.judged)} judged ${plural(row.judged, 'row')} is too few to state a precision. A small sample that happens to be perfect is not a 100% detector.`}
                    />
                  </span>
                ) : (
                  <>
                    {percent(row.precision)}
                    {row.interval === null ? null : (
                      <span className="text-[var(--color-ink-muted)]">
                        {' '}
                        ±{percent(row.interval)}
                      </span>
                    )}
                  </>
                )}
              </Td>
              <Td align="right">{money(row.correctValue)}</Td>
              <Td align="right">
                <Progress labeled={row.labeled} target={row.target} />
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** How far a finding type is from having a dataset anyone would quote. */
function Progress({ labeled, target }: { labeled: number; target: number }) {
  const share = Math.min(1, target > 0 ? labeled / target : 0);
  return (
    <span className="flex items-center justify-end gap-2">
      <span
        aria-hidden
        className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-sunken)]"
      >
        <span
          className="block h-full rounded-full bg-[var(--color-accent)]"
          style={{ width: `${share * 100}%` }}
        />
      </span>
      <span className="tabular text-[var(--color-ink-muted)]">{count(labeled)}</span>
    </span>
  );
}

/**
 * What each jurisdiction's tables can and cannot value today.
 *
 * A schedule in this repository has two states and the difference is the whole
 * point of printing it. Harris County's tables are transcribed, checked against
 * goldens and in use. Florida's statutory rules are written and cited, and its
 * three depreciation attachments are not read yet — so the schedule appraises
 * nothing and says so, rather than defaulting an index factor to 1.000. That
 * default would understate the district's own market value, which would
 * overstate what a client is overpaying, which is the one direction an error in
 * this product must never go.
 *
 * So the gap is a screen rather than a comment in a data file: it names the
 * document, the tables still missing out of it, and what is standing in for
 * them until they land.
 */
function SchedulesCard() {
  return (
    <Card>
      <CardHeader
        title="Schedules"
        description="The depreciation tables behind every valuation, and what each one is still missing."
        help="A jurisdiction with no schedule cannot be valued at all — the picker only offers the ones loaded here. A jurisdiction whose schedule is loaded but whose tables are untranscribed is worse than that if it is hidden: it looks ready. Both states are printed."
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {SCHEDULES.map((schedule) => (
          <li
            key={`${schedule.jurisdictionId}:${schedule.taxYear}`}
            className="space-y-1.5 px-5 py-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-[var(--color-ink)]">
                {schedule.jurisdictionName}
              </span>
              <Badge tone="neutral">{schedule.taxYear}</Badge>
              {schedule.status === 'committed' ? (
                <Badge tone="good">valuing</Badge>
              ) : (
                <Badge tone="warning">values nothing yet</Badge>
              )}
              {schedule.appliesStatewide ? <Badge tone="accent">statewide standard</Badge> : null}
            </div>
            <p className="text-xs text-[var(--color-ink-muted)]">
              {schedule.source.title} · {schedule.source.pages} · {schedule.provenance.authoredBy}
            </p>
            {schedule.awaiting ? (
              <Callout tone="warning" title={`Awaiting ${schedule.awaiting.document}`}>
                <ul className="list-disc space-y-1 pl-4">
                  {schedule.awaiting.missing.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {schedule.awaiting.url ? (
                  <p className="mt-2">
                    <a
                      href={schedule.awaiting.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {schedule.awaiting.url}
                    </a>
                  </p>
                ) : null}
              </Callout>
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function RulesCard({ rules }: { rules: RuleStatus[] }) {
  return (
    <Card>
      <CardHeader
        title="Rules"
        description="Every depreciation table and every detector, with the authority it rests on, the window it applies in, and who signed it off."
        help="A rule in this product is code, and code that decides a client's tax position needs the same things a workpaper does: a citation, an effective date range, a jurisdiction scope, an author and an approver. The gate refuses a schedule missing any of them."
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {rules.map((rule) => (
          <li key={rule.provenance.ruleId} className="space-y-1.5 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-[var(--color-ink)]">
                {rule.provenance.title}
              </span>
              <Badge tone={rule.kind === 'valuation' ? 'accent' : 'neutral'}>{rule.kind}</Badge>
              {rule.inEffect ? null : <Badge tone="critical">{rule.staleReason}</Badge>}
              {rule.provenance.approvedBy ? (
                <Badge tone="good">approved · {rule.provenance.approvedBy}</Badge>
              ) : (
                <Badge tone="warning">approval outstanding</Badge>
              )}
            </div>
            <p className="text-sm text-[var(--color-ink-secondary)]">{rule.provenance.citation}</p>
            <p className="text-xs text-[var(--color-ink-muted)]">
              {rule.provenance.jurisdictions?.join(', ') ?? 'every jurisdiction'} ·{' '}
              {rule.provenance.effectiveFrom}
              {rule.provenance.effectiveTo
                ? ` to ${rule.provenance.effectiveTo}`
                : ' onward'} ·{' '}
              {rule.goldenCount > 0
                ? `${count(rule.goldenCount)} ${plural(rule.goldenCount, 'golden')}`
                : 'no golden'}
              {rule.kind === 'detector'
                ? ` · ${count(rule.labelCount)} ${plural(rule.labelCount, 'label')}`
                : ''}{' '}
              · {rule.provenance.authoredBy}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      className={`eyebrow px-5 py-2.5 font-normal ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

function Td({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td
      className={`px-5 py-2.5 text-[var(--color-ink)] ${align === 'right' ? 'tabular text-right' : ''}`}
    >
      {children}
    </td>
  );
}

function Loading() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Quality"
        eyebrow="Engine"
        description="Precision per finding type per jurisdiction, measured off the review queue, and the citation behind every rule the engine applies."
      />
      <Card>
        <div className="space-y-2 p-5">
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-3.5 w-full max-w-xl" />
        </div>
        <ul className="divide-y divide-[var(--color-hairline)]">
          {[0, 1, 2].map((row) => (
            <li key={row} className="px-5 py-4">
              <Skeleton className="h-4 w-full max-w-md" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
