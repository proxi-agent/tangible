'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History } from 'lucide-react';
import { useState } from 'react';
import type {
  FindingDispositionStatus,
  FindingKind,
  FindingSet,
  StoredFinding,
} from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, moneyExact, plural } from '@/lib/format';
import { FindingDispositionBadge, FindingEffectBadge } from '@/components/workspace/badges';
import { Button, TextInput } from '@/components/ui/controls';
import { Badge, Card, CardHeader } from '@/components/ui/primitives';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * A committed set: what was said, and what has been decided about it.
 *
 * Read-only in every figure. The numbers here are not recomputed on the way to
 * the screen even where recomputing them would be easy, because the whole point
 * of the record is that it says what it said in March. The one live thing on
 * the page is the decision column, and the one live *number* is the staleness
 * flag — which exists so nobody sends a five-week-old report believing it is
 * this morning's.
 */

const KIND_HELP: Record<FindingKind, string> = {
  measured: 'Computed from the register and the district’s published schedules.',
  modeled: 'Rests on a stated assumption, printed with the finding.',
  screening: 'Needs one answer from the client before it can be sized.',
};

const CHOICES: { value: FindingDispositionStatus; label: string; help: string }[] = [
  {
    value: 'accepted',
    label: 'Take it',
    help: 'We are taking this position. It belongs in the filing and in the fee.',
  },
  {
    value: 'pending-client',
    label: 'Ask',
    help: 'Asked; waiting on the client. The normal state of a screening finding.',
  },
  {
    value: 'rejected',
    label: 'Drop',
    help: 'Looked at and dropped. Write down why — the note is the part worth keeping.',
  },
];

export function FindingSetView({ set }: { set: FindingSet }) {
  return (
    <div className="space-y-5">
      <Headline set={set} />
      <Card>
        <CardHeader
          title="Findings"
          description="Each line was frozen when this version was committed."
          help="What you decide here is recorded against the engagement, not against this copy, so it carries forward the next time the analysis is committed."
        />
        <ul className="divide-y divide-[var(--color-hairline)]">
          {set.findings.map((finding) => (
            <FindingRow key={finding.id} finding={finding} setId={set.id} />
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Headline({ set }: { set: FindingSet }) {
  const committed = new Date(set.committedAt);
  return (
    <Card>
      <div className="space-y-4 px-5 py-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xs tracking-wide text-[var(--color-ink-muted)] uppercase">
            {set.headline.label}
          </span>
          <span className="text-3xl font-semibold tracking-tight tabular-nums">
            {moneyExact(set.headline.value)}
          </span>
          <Badge tone="neutral">tax year {set.taxYear}</Badge>
        </div>

        {set.headline.caveat ? (
          <p className="max-w-2xl text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {set.headline.caveat}
          </p>
        ) : null}

        <p className="text-xs text-[var(--color-ink-secondary)]">
          {set.label ? <span className="text-[var(--color-ink)]">{set.label} — </span> : null}
          committed {committed.toLocaleDateString()} at{' '}
          {committed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {set.committedBy ? ` by ${set.committedBy}` : ''}
        </p>

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <Figure label="Findings" value={count(set.findingCount)} />
          <Figure label="Decided" value={`${count(set.decidedCount)} of ${count(set.findingCount)}`} />
          <Figure label="Cost involved" value={moneyExact(set.totalCost)} />
          <Figure label="Value effect" value={moneyExact(set.totalValue)} />
          {set.exposureCount > 0 ? (
            <Figure
              label="Exposure"
              value={`${count(set.exposureCount)} ${plural(set.exposureCount, 'finding')}`}
            />
          ) : null}
        </div>

        {set.isStale ? (
          <div className="flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--color-warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--color-warning)_10%,transparent)] px-3 py-2.5">
            <AlertTriangle
              size={14}
              strokeWidth={2}
              className="mt-0.5 shrink-0 text-[var(--color-warning)]"
            />
            <p className="text-xs leading-relaxed">
              The register, the classifications or the return’s mapping have changed since this was
              committed. Nothing here is wrong — it is what was said on{' '}
              {committed.toLocaleDateString()} — but the live report no longer matches it. Commit a
              fresh version before sending this one out.
            </p>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--color-ink-muted)]">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
    </div>
  );
}

function FindingRow({ finding, setId }: { finding: StoredFinding; setId: string }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState(finding.disposition?.note ?? '');

  const decide = useMutation({
    mutationFn: (body: { status: FindingDispositionStatus | null; note?: string | null }) =>
      api.decideFinding(finding.id, body),
    onSuccess: (result) => {
      queryClient.setQueryData<FindingSet>(['finding-set', setId], (previous) =>
        previous
          ? {
              ...previous,
              ...result.set,
              findings: previous.findings.map((row) =>
                row.id === result.finding.id ? result.finding : row,
              ),
            }
          : previous,
      );
      void queryClient.invalidateQueries({
        queryKey: ['finding-sets', finding.engagementId],
      });
    },
  });

  const disposition = finding.disposition;

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{finding.title}</span>
            <FindingEffectBadge effect={finding.effect} />
            <Tooltip title={finding.kind} content={KIND_HELP[finding.kind]}>
              <Badge tone="neutral" className="cursor-help">
                {finding.kind}
              </Badge>
            </Tooltip>
            {disposition ? <FindingDispositionBadge status={disposition.status} /> : null}
          </div>
          <p className="max-w-2xl text-xs leading-relaxed text-[var(--color-ink-secondary)]">
            {finding.summary}
          </p>
          <p className="max-w-2xl text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
            {finding.basis}
            {finding.assumption ? ` Assumes: ${finding.assumption}` : ''}
          </p>
        </div>

        <div className="shrink-0 text-right text-xs">
          <div className="font-medium tabular-nums">{moneyExact(finding.value)}</div>
          <div className="text-[11px] text-[var(--color-ink-muted)] tabular-nums">
            {moneyExact(finding.cost)} cost · {count(finding.assetCount)}{' '}
            {plural(finding.assetCount, 'asset')}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-[var(--color-hairline)] p-0.5">
          {CHOICES.map((choice) => (
            <button
              key={choice.value}
              type="button"
              title={choice.help}
              disabled={decide.isPending}
              aria-pressed={disposition?.status === choice.value}
              onClick={() =>
                decide.mutate({
                  // Pressing the current choice clears it. Undecided has to be
                  // reachable, or a mis-click becomes a permanent record of a
                  // decision nobody made.
                  status: disposition?.status === choice.value ? null : choice.value,
                  note: note.trim() || null,
                })
              }
              className={cn(
                'cursor-pointer rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed',
                disposition?.status === choice.value
                  ? 'bg-[color-mix(in_oklab,var(--color-series-1)_14%,transparent)] text-[var(--color-ink)]'
                  : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
              )}
            >
              {choice.label}
            </button>
          ))}
        </div>

        <TextInput
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (!disposition || note.trim() === (disposition.note ?? '')) return;
            decide.mutate({ status: disposition.status, note: note.trim() || null });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          disabled={!disposition}
          placeholder={disposition ? 'Why — one line' : 'Decide first, then say why'}
          className="h-8 max-w-md flex-1 text-xs"
          aria-label="Why this was decided"
        />

        {disposition ? (
          <span className="text-[11px] text-[var(--color-ink-muted)]">
            {new Date(disposition.decidedAt).toLocaleDateString()}
            {disposition.decidedBy ? ` · ${disposition.decidedBy}` : ''}
          </span>
        ) : null}
      </div>

      {disposition?.isCarried ? <Carried finding={finding} /> : null}
    </li>
  );
}

/**
 * A decision made on an earlier version, shown here because it is being applied
 * to a finding it was not literally made about.
 *
 * The decision still stands — it is the client's, not ours to revoke — but a
 * client who accepted a $96,000 position never consented to a $184,000 one, and
 * silently carrying the acceptance across would be putting words in their mouth.
 */
function Carried({ finding }: { finding: StoredFinding }) {
  const disposition = finding.disposition;
  if (!disposition) return null;

  return (
    <div className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
      <History size={12} strokeWidth={2} className="mt-0.5 shrink-0" />
      <span>
        Carried from an earlier version.
        {disposition.hasMovedSinceDecision ? (
          <span className="text-[var(--color-warning)]">
            {' '}
            The numbers have moved since — decided against {moneyExact(disposition.decidedValue)} on{' '}
            {moneyExact(disposition.decidedCost)} of cost, now {moneyExact(finding.value)} on{' '}
            {moneyExact(finding.cost)}. Worth confirming it still holds.
          </span>
        ) : null}
      </span>
    </div>
  );
}
