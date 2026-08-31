'use client';

import { useQuery } from '@tanstack/react-query';
import { Brain } from 'lucide-react';
import { useState } from 'react';
import { ruleFor } from '@tangible/savings';
import type { FindingModel } from '@tangible/types';
import { api } from '@/lib/api';
import { count, percent, plural } from '@/lib/format';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Skeleton,
  Stat,
  StatCell,
  StatGrid,
} from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Where the engine has stopped guessing, and where it has not.
 *
 * Every confidence score this product prints has been a sum of weights somebody
 * wrote down with a sentence next to each one. This card is the record of those
 * weights being replaced, one finding at a time, by coefficients fitted on what
 * reviewers actually decided — and, far more often in the first year, the
 * record of a finding that has not earned that yet and is still scored by hand.
 *
 * The second is the reason this screen exists at all. A model that quietly took
 * over would be a model nobody could argue with; a screen that prints "fitted
 * on 61 decisions, no better than the weights out of fold, so the weights
 * stand" is one a person can check. Both losses are shown whether the fit won
 * or lost, because a win by a hair should look like a win by a hair.
 */
export function ModelCard() {
  const [selected, setSelected] = useState<string | null>(null);
  const model = useQuery({ queryKey: ['detection-model'], queryFn: () => api.model() });

  if (model.error) return <ErrorState error={model.error} />;
  if (!model.data) return <Loading />;

  const data = model.data;
  if (data.findings.length === 0) return <Nothing />;

  const findings = [...data.findings].sort(
    (a, b) => Number(b.adopted) - Number(a.adopted) || b.labels - a.labels,
  );
  const active = findings.find((finding) => finding.findingKey === selected) ?? findings[0]!;

  return (
    <Card>
      <CardHeader
        title="What the queue has taught the engine"
        icon={Brain}
        description="Confidence weights refitted on the firm's own accept and reject decisions, adopted per finding only where the fit beats the authored weights on decisions it never saw."
        help="The training set is the review queue itself — each decision was stamped with the signals the row was carrying when a reviewer answered. Client decisions are excluded: a controller declining to make an argument is not the same fact as a detector being wrong, and training on both would teach the engine to doubt positions that are correct and unpopular."
      />

      <StatGrid>
        <StatCell>
          <Stat
            label="Decisions"
            value={count(data.labels)}
            help="Firm accepts and rejects across every client and season. Abstentions are work rather than evidence and are not counted."
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Findings fitted"
            value={`${count(data.adopted.length)} of ${count(data.findings.length)}`}
            help="Findings whose rows are scored by coefficients rather than by the authored weights."
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Signals in play"
            value={count(new Set(data.findings.flatMap((f) => f.features.map((x) => x.code))).size)}
            help="Distinct signals reviewers have seen at least twice. Anything a new evidence source starts emitting appears here on its own."
          />
        </StatCell>
      </StatGrid>

      <Findings findings={findings} selected={active.findingKey} onSelect={setSelected} />
      <Features finding={active} />

      {data.adopted.length === 0 ? (
        <div className="px-5 pb-5">
          <Callout tone="neutral" title="Every row is still scored by hand">
            No finding has enough decisions — or a fit that beats its weights out of fold — to be
            scored by the model. That is the expected state for a while, and it costs nothing: the
            engine behaves exactly as it did before the fit existed, and each row says so.
          </Callout>
        </div>
      ) : null}
    </Card>
  );
}

function Findings({
  findings,
  selected,
  onSelect,
}: {
  findings: FindingModel[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[52rem] text-xs">
        <thead>
          <tr className="text-2xs border-y border-[var(--color-hairline)] text-left font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
            <th className="px-5 py-2">Finding</th>
            <th className="px-3 py-2 text-right">Decisions</th>
            <th className="px-3 py-2 text-right">Accepted</th>
            <th className="px-3 py-2 text-right">
              <Tooltip content="Mean log loss on decisions held out of the fit, model against the authored weights. Lower is better, and the model is adopted only when it is lower by a clear margin — on a few dozen decisions a hair's-breadth win is a coin toss.">
                <span>Fit / weights</span>
              </Tooltip>
            </th>
            <th className="px-5 py-2">Standing</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-hairline)]">
          {findings.map((finding) => (
            <tr
              key={finding.findingKey}
              onClick={() => onSelect(finding.findingKey)}
              className={`cursor-pointer align-top ${
                finding.findingKey === selected ? 'bg-[var(--color-surface)]' : ''
              }`}
            >
              <td className="px-5 py-2.5">
                <div>{ruleFor(finding.findingKey)?.title ?? finding.findingKey}</div>
                <div className="mt-0.5 text-[var(--color-ink-muted)]">{finding.findingKey}</div>
              </td>
              <td className="tabular px-3 py-2.5 text-right">{count(finding.labels)}</td>
              <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-muted)]">
                {percent(finding.accepted / Math.max(1, finding.labels))}
              </td>
              <td className="tabular px-3 py-2.5 text-right">
                {finding.fittedLoss === null || finding.baselineLoss === null ? (
                  <span className="text-[var(--color-ink-muted)]">—</span>
                ) : (
                  <>
                    <span className={finding.adopted ? 'font-medium' : ''}>
                      {finding.fittedLoss.toFixed(3)}
                    </span>
                    <span className="text-[var(--color-ink-muted)]">
                      {' '}
                      / {finding.baselineLoss.toFixed(3)}
                    </span>
                  </>
                )}
              </td>
              <td className="px-5 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={finding.adopted ? 'good' : 'neutral'}>
                    {finding.adopted ? 'Fitted' : 'Authored'}
                  </Badge>
                  <span className="text-[var(--color-ink-muted)]">{finding.reason}</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One finding's signals, with the authored weight and the fitted one side by
 * side in the same units.
 *
 * The units are log-odds, which is not what the weights were written in — they
 * were written as movements of a probability, and probabilities do not add.
 * Translating the authored weight into log-odds at the finding's own base rate
 * is what makes the two columns comparable at all, and the tooltip says so,
 * because a reviewer who reads +0.16 in the code and +0.50 here deserves to
 * know that nothing was changed except the units.
 */
function Features({ finding }: { finding: FindingModel }) {
  const title = ruleFor(finding.findingKey)?.title ?? finding.findingKey;
  const features = [...finding.features].sort(
    (a, b) => Math.abs(b.fitted - b.prior) - Math.abs(a.fitted - a.prior),
  );

  return (
    <div className="border-t border-[var(--color-hairline)]">
      <div className="px-5 py-3 text-xs text-[var(--color-ink-muted)]">
        {title}: {count(finding.labels)} {plural(finding.labels, 'decision')}, starting from a base
        of {percent(1 / (1 + Math.exp(-finding.priorIntercept)))} and fitted at{' '}
        {percent(1 / (1 + Math.exp(-finding.intercept)))} before any signal fires.
      </div>
      {features.length === 0 ? (
        <div className="px-5 pb-5 text-xs text-[var(--color-ink-muted)]">
          No signal has been seen twice on this finding yet.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-xs">
            <thead>
              <tr className="text-2xs border-y border-[var(--color-hairline)] text-left font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                <th className="px-5 py-2">Signal</th>
                <th className="px-3 py-2 text-right">Seen</th>
                <th className="px-3 py-2 text-right">Accepted</th>
                <th className="px-3 py-2 text-right">
                  <Tooltip content="The weight somebody authored, translated into log-odds at this finding's base rate. The number in the source is a movement of a probability; this is the same claim in the units the fit works in.">
                    <span>Authored</span>
                  </Tooltip>
                </th>
                <th className="px-3 py-2 text-right">
                  <Tooltip content="Where the decisions moved it. A signal seen a handful of times comes back almost exactly where it started — the fit is anchored to the authored weight and the labels have to earn every step away from it.">
                    <span>Fitted</span>
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-hairline)]">
              {features.map((feature) => (
                <tr key={feature.code} className="align-top">
                  <td className="px-5 py-2.5">
                    <div>{feature.label}</div>
                    <div className="mt-0.5 text-[var(--color-ink-muted)]">{feature.code}</div>
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">{count(feature.observations)}</td>
                  <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-muted)]">
                    {percent(feature.accepted / Math.max(1, feature.observations))}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right text-[var(--color-ink-muted)]">
                    {signed(feature.prior)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right font-medium">
                    {signed(feature.fitted)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;

/**
 * Before the first decision, and it says what would change that.
 *
 * Not an error and not a missing integration — a practice that has not worked a
 * queue yet has nothing to fit on, and the engine is doing exactly what it was
 * designed to do without one.
 */
function Nothing() {
  return (
    <Card>
      <CardHeader
        title="What the queue has taught the engine"
        icon={Brain}
        description="Confidence weights refitted on the firm's own accept and reject decisions."
      />
      <div className="px-5 pb-5">
        <EmptyState title="Nobody has answered a flagged row yet">
          Every accept or reject in the review queue is a label, stamped with the signals the row
          was carrying at the time. Once a finding has forty of them, its weights are refitted and
          adopted if they beat the authored ones out of fold.
        </EmptyState>
      </div>
    </Card>
  );
}

function Loading() {
  return (
    <Card>
      <CardHeader title="What the queue has taught the engine" icon={Brain} />
      <div className="space-y-2 px-5 pb-5">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    </Card>
  );
}
