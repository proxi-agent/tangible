'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { classificationOptions, lineMappingLabel } from '@tangible/classification';
import type {
  ClassificationStatus,
  ExtractedNotice,
  ExtractedRendition,
  FootingIssue,
  LineMappingRunResult,
  MappedPriorLine,
  PriorDocument,
  RenditionScheduleKey,
} from '@tangible/types';
import { MIXED_LINE_KEY } from '@tangible/types';
import { api, type MappedPriorDocument } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, moneyExact, percent, plural } from '@/lib/format';
import {
  ClassificationStatusBadge,
  LineMappingSourceBadge,
  PriorDocumentStatusBadge,
} from '@/components/workspace/badges';
import { CommitFindings } from '@/components/workspace/commit-findings';
import { PriorComparisonView } from '@/components/workspace/prior-comparison';
import { Button, ChipGroup, Select, type ChipOption } from '@/components/ui/controls';
import { Card, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { InfoTip, Tooltip } from '@/components/ui/tooltip';

/**
 * Reading one prior filing, and deciding what it said.
 *
 * The page is ordered the way trust is built, not the way the data is stored.
 * First: is this the right client's form, and does it add up? Nothing below that
 * means anything if the answer is no. Then: what did the filer's own words mean.
 * Then, last, the rollup those two produce — which is the number every later
 * comparison against the register is measured from, and the reason the two
 * questions above get the room they do.
 */

/** Form 50-144's own names for its schedules. */
const SCHEDULE_NAMES: Record<RenditionScheduleKey, string> = {
  A: 'Personal property under $20,000',
  B: 'Inventory',
  C: 'Supplies',
  D: 'Licensed vehicles',
  E: 'Furniture, fixtures, machinery, equipment and computers',
  F: 'Property leased or consigned from others',
};

const lineValue = (line: MappedPriorLine): number =>
  line.historicalCost ?? line.goodFaithEstimate ?? 0;

export default function PriorDocumentPage() {
  const { clientId, engagementId, documentId } = useParams<{
    clientId: string;
    engagementId: string;
    documentId: string;
  }>();

  const { data, error, isLoading } = useQuery({
    queryKey: ['prior', documentId],
    queryFn: () => api.priorDocument(documentId),
  });

  // Already cached by the engagement page in every path that reaches here, so
  // this costs nothing and lets the identity check below actually compare.
  const { data: engagement } = useQuery({
    queryKey: ['engagement', engagementId],
    queryFn: () => api.engagement(engagementId),
  });

  // The accounts this engagement files under — one per site, so a return
  // naming any of them is one of ours.
  const { data: owed } = useQuery({
    queryKey: ['engagement-returns', engagementId],
    queryFn: () => api.returns(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  const { document, lines, basis } = data;
  const isRendition = document.kind === 'rendition';

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/clients/${clientId}/engagements/${engagementId}`}
          className="flex items-center gap-1.5 text-sm text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Engagement
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {document.originalFilename}
          </h1>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {isRendition ? 'Rendition as filed' : 'Notice of appraised value'}
            {document.extractionModel ? ` · read by ${document.extractionModel}` : ''}
          </p>
        </div>
        <PriorDocumentStatusBadge status={document.status} />
      </div>

      <IdentityCard
        document={document}
        engagementTaxYear={engagement?.engagement.taxYear ?? null}
        engagementAccountIds={
          owed?.returns.map((r) => r.accountId).filter((id): id is string => id !== null) ?? []
        }
        clientName={engagement?.client.name ?? null}
      />

      {isRendition ? (
        <>
          <FootingCard document={document} />
          <WordingCard documentId={documentId} lines={lines} />
          <ReconciliationCard basis={basis} document={document} />
          <ComparisonSection
            clientId={clientId}
            engagementId={engagementId}
            documentId={documentId}
          />
        </>
      ) : (
        <NoticeCard extracted={document.extracted as ExtractedNotice | null} />
      )}
    </div>
  );
}

/**
 * The comparison, fetched on its own.
 *
 * A separate query rather than a field on the document, because it reads the
 * whole classified register and the published schedules — work the reviewer
 * settling wordings above should never wait on. It also invalidates on its own:
 * accepting one mapping changes this and nothing else on the page.
 */
function ComparisonSection({
  clientId,
  engagementId,
  documentId,
}: {
  clientId: string;
  engagementId: string;
  documentId: string;
}) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['prior-comparison', documentId],
    queryFn: () => api.priorComparison(documentId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <PriorComparisonView comparison={data} />
      {/* Below the comparison, not above it: committing is what you do having
          read the thing, and a button at the top invites committing instead. */}
      {data.findings.length > 0 ? (
        <div className="flex justify-end">
          <CommitFindings
            clientId={clientId}
            engagementId={engagementId}
            source="register-comparison"
            priorDocumentId={documentId}
          />
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Is this the right document?
// ---------------------------------------------------------------------------

/**
 * The check nobody remembers to make.
 *
 * Clients send the wrong year, and multi-location clients send one location's
 * form for another location's account. Both produce a return that extracts
 * perfectly, foots perfectly, and compares against entirely the wrong register.
 * There is no arithmetic that catches it — only reading the two side by side.
 */
function IdentityCard({
  document,
  engagementTaxYear,
  engagementAccountIds,
  clientName,
}: {
  document: PriorDocument;
  engagementTaxYear: number | null;
  /** One per site. A multi-location client files a return against each. */
  engagementAccountIds: string[];
  clientName: string | null;
}) {
  const extracted = document.extracted as (ExtractedRendition & ExtractedNotice) | null;

  // A document naming one of the engagement's accounts is the right document,
  // so the account row only disagrees when it names none of them — and then it
  // shows every account it could have been, since "not this one" is not an
  // answer somebody can act on.
  const filed = document.documentAccountId?.replace(/\D/g, '') ?? null;
  const matched =
    filed !== null && engagementAccountIds.some((id) => id.replace(/\D/g, '') === filed);

  const rows: { label: string; onForm: string | null; expected: string | null }[] = [
    { label: 'Owner', onForm: extracted?.ownerName ?? null, expected: clientName },
    {
      label: 'Tax year',
      onForm: document.documentTaxYear ? String(document.documentTaxYear) : null,
      expected: engagementTaxYear ? String(engagementTaxYear) : null,
    },
    {
      label: 'Account',
      onForm: document.documentAccountId,
      expected:
        engagementAccountIds.length === 0
          ? null
          : matched
            ? document.documentAccountId
            : engagementAccountIds.join(', '),
    },
    { label: 'District', onForm: extracted?.districtName ?? null, expected: null },
  ];

  const unreadable = extracted?.unreadable ?? [];

  return (
    <Card>
      <CardHeader
        title="What the document says it is"
        description="Read off the form itself and shown against the engagement, because a return whose figures all add up can still be the wrong year or the wrong location."
      />
      <div className="grid grid-cols-1 gap-px bg-[var(--color-hairline)] sm:grid-cols-4">
        {rows.map((row) => {
          const mismatch =
            row.expected !== null &&
            row.onForm !== null &&
            row.onForm.trim().toLowerCase() !== row.expected.trim().toLowerCase();
          return (
            <div key={row.label} className="bg-[var(--color-surface)] px-4 py-3">
              <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                {row.label}
              </p>
              <p
                className={cn(
                  'mt-0.5 truncate text-sm font-medium',
                  mismatch ? 'text-[var(--color-warning)]' : '',
                )}
                title={row.onForm ?? undefined}
              >
                {row.onForm ?? <span className="text-[var(--color-ink-muted)]">not read</span>}
              </p>
              {mismatch ? (
                <p className="mt-0.5 text-xs text-[var(--color-warning)]">
                  engagement says {row.expected}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Named gaps, not filled ones: a guessed figure in a filed return is a
          fabricated fact, so extraction says what it could not read instead. */}
      {unreadable.length > 0 ? (
        <div className="border-t border-[var(--color-hairline)] px-5 py-3">
          <p className="text-xs font-medium text-[var(--color-ink-secondary)]">
            {unreadable.length} {plural(unreadable.length, 'thing')} on the page could not be read
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[var(--color-ink-muted)]">
            {unreadable.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Does it add up?
// ---------------------------------------------------------------------------

function FootingCard({ document }: { document: PriorDocument }) {
  const footing = document.footing;
  if (!footing) {
    return (
      <Card>
        <CardHeader title="Whether it adds up" />
        <EmptyState title="Nothing was read from this document">
          {document.error ?? 'Extraction produced no schedules to check.'}
        </EmptyState>
      </Card>
    );
  }

  const delta = footing.statedTotal === null ? null : footing.derivedTotal - footing.statedTotal;
  const errors = footing.issues.filter((issue) => issue.severity === 'error');
  const warnings = footing.issues.filter((issue) => issue.severity === 'warning');

  return (
    <Card>
      <CardHeader
        title="Whether it adds up"
        description="The schedules were read line by line and the printed totals were read separately."
        help="Comparing the two is a real test — a total derived by summing our own lines would agree by construction and prove nothing."
      />

      <div className="grid grid-cols-2 gap-px border-y border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-4">
        <Tile label="Lines read" value={count(footing.lineCount)} />
        <Tile label="Sum of those lines" value={moneyExact(footing.derivedTotal)} />
        <Tile label="Printed on the form" value={moneyExact(footing.statedTotal)} />
        <Tile
          label="Difference"
          value={delta === null ? '—' : moneyExact(delta)}
          tone={delta === null ? undefined : delta === 0 ? 'good' : 'warning'}
        />
      </div>

      {/* The arithmetic verdict is kept apart from everything else that came
          up. A return can foot perfectly and still carry warnings worth
          reading — the tax year, an unreadable region — and folding the two
          together would say the figures are in doubt when they are not. */}
      {errors.length === 0 ? (
        <p className="flex items-center gap-1.5 px-5 py-3 text-sm text-[var(--color-good)]">
          <CircleCheck size={14} strokeWidth={2} />
          Every schedule sums to its own printed total, and the schedules sum to the form&rsquo;s.
        </p>
      ) : null}

      {footing.issues.length > 0 ? (
        <ul className="divide-y divide-[var(--color-hairline)] border-t border-[var(--color-hairline)]">
          {[...errors, ...warnings].map((issue, index) => (
            <IssueRow key={`${issue.code}-${index}`} issue={issue} />
          ))}
        </ul>
      ) : null}

      {/* A discrepancy is not a broken upload. Filers make arithmetic errors,
          and one in a filed return may be worth more than the register. */}
      {errors.length > 0 ? (
        <p className="border-t border-[var(--color-hairline)] px-5 py-3 text-xs text-[var(--color-ink-secondary)]">
          A return whose totals do not add up is kept as filed, discrepancies and all — the error may be the
          client&rsquo;s rather than ours, and that is a finding. What it withholds is the right to
          be treated as a settled baseline until someone has looked at the page.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Two of the checks compare years rather than dollars, and a year rendered as
 * "$2,027" makes a plain warning look like a corrupted figure.
 */
const YEAR_CODES = new Set(['tax-year-mismatch', 'implausible-year']);

function IssueRow({ issue }: { issue: FootingIssue }) {
  const critical = issue.severity === 'error';
  const asNumber = (value: number) =>
    YEAR_CODES.has(issue.code) ? String(value) : moneyExact(value);
  return (
    <li className="flex items-start gap-2.5 px-5 py-3">
      <AlertTriangle
        size={14}
        strokeWidth={2}
        className={cn(
          'mt-0.5 shrink-0',
          critical ? 'text-[var(--color-critical)]' : 'text-[var(--color-warning)]',
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm">{issue.message}</p>
        <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
          {issue.schedule ? `Schedule ${issue.schedule} · ` : ''}
          {issue.code}
          {issue.expected !== null && issue.actual !== null
            ? ` · expected ${asNumber(issue.expected)}, read ${asNumber(issue.actual)}`
            : ''}
        </p>
      </div>
    </li>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warning' | 'critical';
}) {
  return (
    <div className="bg-[var(--color-surface)] px-4 py-2.5">
      <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
        {label}
      </p>
      <p
        className={cn(
          'tabular mt-0.5 text-base font-semibold',
          tone === 'good' ? 'text-[var(--color-good)]' : '',
          tone === 'warning' ? 'text-[var(--color-warning)]' : '',
          tone === 'critical' ? 'text-[var(--color-critical)]' : '',
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// What the filer's words meant
// ---------------------------------------------------------------------------

/**
 * One group of lines that share a piece of wording.
 *
 * The grouping is not cosmetic — it is the grain the decision actually has. On
 * Schedule E a single wording spans a decade of year-acquired rows, and settling
 * one settles all of them, so asking about each row separately would be ten
 * identical questions with ten chances to answer inconsistently.
 */
interface WordingGroup {
  key: string;
  schedule: RenditionScheduleKey;
  wording: string;
  lines: MappedPriorLine[];
  reported: number;
  /** The weakest reading in the group: one queued line queues the whole wording. */
  representative: MappedPriorLine;
  /** Set when the group's lines do not agree, which a re-confirmation resolves. */
  divided: boolean;
}

const STATUS_RANK: Record<ClassificationStatus, number> = {
  'needs-review': 0,
  'auto-accepted': 1,
  confirmed: 2,
};

function groupByWording(lines: MappedPriorLine[]): WordingGroup[] {
  const groups = new Map<string, WordingGroup>();

  for (const line of lines) {
    const key = line.mapping.fingerprint ?? `${line.schedule}|${line.type.trim().toLowerCase()}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        key,
        schedule: line.schedule,
        wording: line.type.trim(),
        lines: [line],
        reported: lineValue(line),
        representative: line,
        divided: false,
      });
      continue;
    }
    existing.lines.push(line);
    existing.reported += lineValue(line);
    if (line.mapping.categoryKey !== existing.representative.mapping.categoryKey) {
      existing.divided = true;
    }
    if (STATUS_RANK[line.mapping.status] < STATUS_RANK[existing.representative.mapping.status]) {
      existing.representative = line;
    }
  }

  for (const group of groups.values()) {
    group.lines.sort((a, b) => (b.yearAcquired ?? 0) - (a.yearAcquired ?? 0));
  }

  // Queued first, then by money, because the reviewer's time is worth the most
  // where the most cost is riding on the answer.
  return [...groups.values()].sort(
    (a, b) =>
      STATUS_RANK[a.representative.mapping.status] - STATUS_RANK[b.representative.mapping.status] ||
      b.reported - a.reported,
  );
}

const STATUS_FILTERS: ChipOption<ClassificationStatus>[] = [
  {
    value: 'needs-review',
    label: 'Waiting on you',
    description: 'Nothing is measured off an unsettled reading — these hold up the rollup below.',
  },
  {
    value: 'auto-accepted',
    label: 'Settled without asking',
    description:
      'The schedule letter or a confident reading decided it. Worth spot-checking, not worth clicking through.',
  },
  {
    value: 'confirmed',
    label: 'Confirmed by a reviewer',
    description:
      'A person read this wording. It will replay on every return that uses these words.',
  },
];

function WordingCard({ documentId, lines }: { documentId: string; lines: MappedPriorLine[] }) {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<ClassificationStatus[]>([]);
  const [lastRun, setLastRun] = useState<LineMappingRunResult | null>(null);

  const groups = useMemo(() => groupByWording(lines), [lines]);

  const run = useMutation({
    mutationFn: (remap: boolean) => api.mapPriorLines(documentId, remap),
    onSuccess: (result) => {
      setLastRun(result);
      void queryClient.invalidateQueries({ queryKey: ['prior', documentId] });
      // Settling a wording moves cost between placed and unplaced, which is the
      // input the comparison is built from.
      void queryClient.invalidateQueries({ queryKey: ['prior-comparison', documentId] });
    },
  });

  const queued = groups.filter((g) => g.representative.mapping.status === 'needs-review');
  const unread = groups.filter((g) => g.representative.mapping.categoryKey === null);
  const shown =
    filters.length === 0
      ? groups
      : groups.filter((g) => filters.includes(g.representative.mapping.status));

  const fromForm = groups.filter((g) => g.representative.mapping.source === 'schedule').length;
  const fromMemory = groups.filter((g) => g.representative.mapping.source === 'memory').length;
  const queuedCost = queued.reduce((sum, g) => sum + g.reported, 0);

  if (lines.length === 0) {
    return (
      <Card>
        <CardHeader title="What the wording means" />
        <EmptyState title="No lines were read off this return">
          There is nothing to map until extraction finds schedules on the page.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="What the wording means"
        description="A rendition is filed in the taxpayer's own words — “Mach & Equip”, “F F & E” — read back into our categories here."
        help="This join is what makes the return comparable with the register, so it is a separate, visible, arguable step rather than something extraction quietly decided."
        action={
          <div className="flex items-center gap-2">
            <Tooltip
              title="Re-read every wording"
              content="Discards the machine readings and asks again from scratch. Anything a reviewer confirmed is kept — a human decision is never overwritten by a re-run."
            >
              <Button variant="ghost" onClick={() => run.mutate(true)} disabled={run.isPending}>
                Re-read all
              </Button>
            </Tooltip>
            {unread.length > 0 ? (
              <Button onClick={() => run.mutate(false)} disabled={run.isPending}>
                <Sparkles size={14} strokeWidth={2} />
                {run.isPending
                  ? 'Reading…'
                  : `Read ${unread.length} ${plural(unread.length, 'wording')}`}
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-px border-y border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-5">
        <Tile label="Distinct wordings" value={count(groups.length)} />
        <Tile
          label="Waiting on you"
          value={count(queued.length)}
          tone={queued.length > 0 ? 'warning' : undefined}
        />
        <Tile label="Settled by the form" value={count(fromForm)} />
        <Tile label="Replayed from memory" value={count(fromMemory)} />
        <Tile
          label="Cost not yet settled"
          value={moneyExact(queuedCost)}
          tone={queuedCost > 0 ? 'warning' : undefined}
        />
      </div>

      {run.error ? (
        <p className="px-5 pt-3 text-xs text-[var(--color-critical)]">
          {run.error instanceof Error ? run.error.message : String(run.error)}
        </p>
      ) : null}
      {lastRun ? <RunSummary result={lastRun} /> : null}

      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <ChipGroup
          options={STATUS_FILTERS}
          selected={filters}
          onToggle={(value) =>
            setFilters((current) =>
              current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
            )
          }
        />
        <span className="text-xs text-[var(--color-ink-muted)]">
          {shown.length === groups.length
            ? `${count(groups.length)} ${plural(groups.length, 'wording')} across ${count(lines.length)} ${plural(lines.length, 'line')}`
            : `${count(shown.length)} of ${count(groups.length)}`}
        </span>
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Nothing matches that filter">
          Clear a chip to see the rest of the return.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-[var(--color-hairline)] border-t border-[var(--color-hairline)]">
          {shown.map((group) => (
            <WordingRow key={group.key} group={group} documentId={documentId} />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** The run, in a sentence — the counts alone read like telemetry. */
function RunSummary({ result }: { result: LineMappingRunResult }) {
  const parts: string[] = [];
  if (result.fromSchedule > 0) {
    parts.push(`${count(result.fromSchedule)} settled by the schedule letter alone`);
  }
  if (result.fromMemory > 0) {
    parts.push(`${count(result.fromMemory)} replayed from a reviewer's earlier decision`);
  }
  if (result.fromAi > 0) {
    parts.push(
      `${count(result.fromAi)} read by ${result.model ?? 'the model'}, from ${count(result.distinctSent)} distinct ${plural(result.distinctSent, 'question')}`,
    );
  }

  return (
    <div className="border-b border-[var(--color-hairline)] px-5 py-3 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
      {result.aiUnavailable ? (
        <p className="text-[var(--color-warning)]">
          No model is configured, so only the schedule letters and memory could decide. Everything
          else is waiting on a reviewer.
        </p>
      ) : (
        <p>
          {count(result.considered)} {plural(result.considered, 'line')} considered
          {parts.length > 0 ? ` — ${parts.join(', ')}` : ''}.{' '}
          {result.needsReview > 0
            ? `${count(result.needsReview)} ${plural(result.needsReview, 'line')} came back short of the bar and ${plural(result.needsReview, 'is', 'are')} waiting below.`
            : 'Nothing came back short of the bar.'}
        </p>
      )}
    </div>
  );
}

const OPTIONS = classificationOptions();
const SCHEDULE_OPTIONS = OPTIONS.filter((option) => option.kind === 'schedule');
const EXCLUSION_OPTIONS = OPTIONS.filter((option) => option.kind === 'exclusion');

function WordingRow({ group, documentId }: { group: WordingGroup; documentId: string }) {
  const queryClient = useQueryClient();
  const mapping = group.representative.mapping;
  const [choice, setChoice] = useState(mapping.categoryKey ?? '');
  const [remember, setRemember] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const decide = useMutation({
    mutationFn: () =>
      api.decideLineMapping(group.representative.id, {
        categoryKey: choice,
        // The group *is* the set of lines sharing this wording, so the fan-out
        // is what the reviewer just agreed to rather than an extra option.
        applyToMatching: true,
        remember,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['prior', documentId] });
      // Settling a wording moves cost between placed and unplaced, which is the
      // input the comparison is built from.
      void queryClient.invalidateQueries({ queryKey: ['prior-comparison', documentId] });
    },
  });

  const settled = mapping.status !== 'needs-review' && !group.divided;
  const description = OPTIONS.find((option) => option.key === choice)?.description;
  const years = group.lines
    .map((line) => line.yearAcquired)
    .filter((year): year is number => year !== null);
  const yearSpan =
    years.length === 0
      ? null
      : years.length === 1
        ? String(years[0])
        : `${Math.min(...years)}–${Math.max(...years)}`;

  return (
    <li className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-start lg:gap-6">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <Tooltip title={`Schedule ${group.schedule}`} content={SCHEDULE_NAMES[group.schedule]}>
            <span className="rounded border border-[var(--color-hairline)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-ink-secondary)]">
              {group.schedule}
            </span>
          </Tooltip>
          {/* Verbatim, in quotation marks, because it is a quotation from a
              filed document and not our own label for anything. */}
          <p className="min-w-0 text-sm font-medium">
            &ldquo;{group.wording || <span className="text-[var(--color-ink-muted)]">blank</span>}
            &rdquo;
          </p>
        </div>

        <p className="tabular mt-1 text-xs text-[var(--color-ink-secondary)]">
          {moneyExact(group.reported)} reported · {count(group.lines.length)}{' '}
          {plural(group.lines.length, 'line')}
          {yearSpan ? ` · acquired ${yearSpan}` : ''}
        </p>

        {mapping.rationale ? (
          <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-muted)]">
            {mapping.rationale}
          </p>
        ) : null}

        {group.divided ? (
          <p className="mt-1.5 text-xs text-[var(--color-warning)]">
            The lines using these words do not currently agree. Confirming here settles all of them.
          </p>
        ) : null}

        {group.lines.length > 1 || group.lines[0]?.sourcePage !== null ? (
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="mt-2 flex items-center gap-1 text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
          >
            {expanded ? (
              <ChevronDown size={12} strokeWidth={2} />
            ) : (
              <ChevronRight size={12} strokeWidth={2} />
            )}
            {expanded ? 'Hide' : 'Show'} the {count(group.lines.length)}{' '}
            {plural(group.lines.length, 'line')} as filed
          </button>
        ) : null}

        {expanded ? (
          <table className="tabular mt-2 w-full max-w-md text-xs">
            <thead>
              <tr className="text-left text-[var(--color-ink-muted)]">
                <th className="py-1 pr-3 font-medium">Acquired</th>
                <th className="py-1 pr-3 text-right font-medium">Cost</th>
                <th className="py-1 pr-3 text-right font-medium">Estimate</th>
                <th className="py-1 text-right font-medium">Page</th>
              </tr>
            </thead>
            <tbody className="border-t border-[var(--color-hairline)]">
              {group.lines.map((line) => (
                <tr key={line.id}>
                  <td className="py-1 pr-3">{line.yearAcquired ?? 'not broken out'}</td>
                  <td className="py-1 pr-3 text-right">{moneyExact(line.historicalCost)}</td>
                  <td className="py-1 pr-3 text-right">{moneyExact(line.goodFaithEstimate)}</td>
                  <td className="py-1 text-right text-[var(--color-ink-muted)]">
                    {line.sourcePage ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-2 lg:w-96">
        <div className="flex flex-wrap items-center gap-1.5">
          <ClassificationStatusBadge status={mapping.status} />
          <LineMappingSourceBadge source={mapping.source} />
          {mapping.source === 'ai' ? (
            <span className="tabular text-xs text-[var(--color-ink-muted)]">
              {percent(mapping.confidence, 0)} confident
            </span>
          ) : null}
          {group.representative.isCorrected ? (
            <span className="text-xs text-[var(--color-ink-muted)]">corrected</span>
          ) : null}
        </div>

        <Select value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="">Nothing decided yet</option>
          <optgroup label="Valued on a schedule">
            {SCHEDULE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Off the rendition">
            {EXCLUSION_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Not one category at all">
            <option value={MIXED_LINE_KEY}>{lineMappingLabel(MIXED_LINE_KEY)}</option>
          </optgroup>
        </Select>

        <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
          {choice === MIXED_LINE_KEY
            ? 'The form printed several kinds of property as one number, and nothing can split it. The cost stays in the reported total and is carried below as unplaceable rather than assigned to whichever category the wording leans toward.'
            : (description ?? 'Pick the category these words refer to.')}
        </p>

        <label className="flex items-center gap-2 text-xs text-[var(--color-ink-secondary)]">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Remember these words
          <InfoTip
            title="Remember these words"
            content="Controllers in one industry write their schedules the same way, so this reading replays on the next client who files these words — no model call, no second question."
            size={11}
          />
        </label>

        {/* Settled rows get the quieter button. Every wording on a clean return
            is already decided, and a page of primary buttons would put the same
            weight on re-confirming them as on the one that needs an answer. */}
        <Button
          variant={settled ? 'secondary' : 'primary'}
          onClick={() => decide.mutate()}
          disabled={!choice || decide.isPending}
        >
          {decide.isPending
            ? 'Recording…'
            : settled
              ? `Change for ${count(group.lines.length)} ${plural(group.lines.length, 'line')}`
              : `Confirm for ${count(group.lines.length)} ${plural(group.lines.length, 'line')}`}
        </Button>

        {decide.error ? (
          <p className="text-xs text-[var(--color-critical)]">
            {decide.error instanceof Error ? decide.error.message : String(decide.error)}
          </p>
        ) : null}

        {decide.data ? (
          <p className="flex items-start gap-1.5 text-xs text-[var(--color-good)]">
            <Check size={11} strokeWidth={3} className="mt-0.5 shrink-0" />
            <span>
              Settled {count(decide.data.applied)} {plural(decide.data.applied, 'line')}
              {decide.data.remembered ? ', and remembered for future returns' : ''}.
              {decide.data.memoryConflict
                ? ' Memory already held a different reading for these words — both are on the record, and the next return using them will come back here.'
                : ''}
            </span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// The number every comparison starts from
// ---------------------------------------------------------------------------

type MappedBasis = MappedPriorDocument['basis'];

/**
 * The reported total, expressed in our categories — and the proof that nothing
 * fell out on the way.
 *
 * The reconciliation is the point of this panel, not a footnote to it. A rollup
 * that quietly dropped the lines it could not read would produce a "they
 * under-reported by $400,000" finding out of nothing but our own gaps, and that
 * finding would look exactly like a real one. So every dollar is either placed
 * in a category or carried below with a reason, and the two always sum back to
 * what the form printed.
 */
function ReconciliationCard({ basis, document }: { basis: MappedBasis; document: PriorDocument }) {
  const byCategory = useMemo(() => {
    const map = new Map<
      string,
      { categoryKey: string; reported: number; years: { year: number | null; reported: number }[] }
    >();
    for (const bucket of basis.placed) {
      const entry = map.get(bucket.categoryKey) ?? {
        categoryKey: bucket.categoryKey,
        reported: 0,
        years: [],
      };
      entry.reported += bucket.reported;
      entry.years.push({ year: bucket.yearAcquired, reported: bucket.reported });
      map.set(bucket.categoryKey, entry);
    }
    return [...map.values()].sort((a, b) => b.reported - a.reported);
  }, [basis.placed]);

  const printed = document.footing?.statedTotal ?? null;
  const ties = printed !== null && Math.round(printed) === Math.round(basis.reportedTotal);

  return (
    <Card>
      <CardHeader
        title="What was reported, in our categories"
        description="The basis every comparison against the register starts from."
        help="Cost that could not be placed is carried here with the reason it could not, never dropped — a gap of ours would otherwise read as an under-report of theirs."
      />

      {basis.reportedTotal === 0 ? (
        <EmptyState title="Nothing to roll up yet">
          Settle the wording above and the reported cost lands here in our categories.
        </EmptyState>
      ) : (
        <>
          <div className="px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
              Placed — comparable against the register
            </p>
            {byCategory.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                Nothing has been placed yet.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--color-hairline)]">
                {byCategory.map((entry) => (
                  <li key={entry.categoryKey} className="py-2">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="text-sm font-medium">{lineMappingLabel(entry.categoryKey)}</p>
                      <p className="tabular text-sm font-semibold">{moneyExact(entry.reported)}</p>
                    </div>
                    {/* The year matters: it is what the district's depreciation
                        schedule is indexed on, so a category total alone is not
                        yet comparable with anything. */}
                    <p className="tabular mt-0.5 text-xs text-[var(--color-ink-muted)]">
                      {entry.years
                        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
                        .map(
                          (year) => `${year.year ?? 'no year given'} ${moneyExact(year.reported)}`,
                        )
                        .join('  ·  ')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {basis.unplaced.length > 0 ? (
            <div className="border-t border-[var(--color-hairline)] px-5 py-4">
              <p className="text-[11px] font-medium tracking-wide text-[var(--color-ink-muted)] uppercase">
                Carried, not compared
              </p>
              <ul className="mt-2 divide-y divide-[var(--color-hairline)]">
                {basis.unplaced.map((bucket) => (
                  <li
                    key={`${bucket.reason}-${bucket.categoryKey ?? 'none'}`}
                    className="flex items-baseline justify-between gap-4 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">{bucket.label}</p>
                      <p className="mt-0.5 truncate text-xs text-[var(--color-ink-muted)]">
                        {count(bucket.lineCount)} {plural(bucket.lineCount, 'line')}
                        {bucket.wordings.length > 0
                          ? ` · ${bucket.wordings.map((w) => `“${w}”`).join(', ')}`
                          : ''}
                      </p>
                    </div>
                    <p
                      className={cn(
                        'tabular shrink-0 text-sm font-semibold',
                        bucket.reason === 'needs-review' ? 'text-[var(--color-warning)]' : '',
                      )}
                    >
                      {moneyExact(bucket.reported)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="border-t border-[var(--color-hairline)] bg-[var(--color-plane)] px-5 py-4">
            <dl className="tabular space-y-1.5 text-sm">
              <div className="flex justify-between gap-4 text-[var(--color-ink-secondary)]">
                <dt>Placed</dt>
                <dd>{moneyExact(basis.placedTotal)}</dd>
              </div>
              <div className="flex justify-between gap-4 text-[var(--color-ink-secondary)]">
                <dt>Carried</dt>
                <dd>{moneyExact(basis.unplacedTotal)}</dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-[var(--color-hairline)] pt-1.5 font-semibold">
                <dt>Reported total</dt>
                <dd>{moneyExact(basis.reportedTotal)}</dd>
              </div>
              {printed !== null ? (
                <div
                  className={cn(
                    'flex items-center justify-between gap-4 text-xs',
                    ties ? 'text-[var(--color-good)]' : 'text-[var(--color-warning)]',
                  )}
                >
                  <dt className="flex items-center gap-1.5">
                    {ties ? (
                      <CircleCheck size={12} strokeWidth={2} />
                    ) : (
                      <AlertTriangle size={12} strokeWidth={2} />
                    )}
                    {ties
                      ? 'Ties to the total printed on the form'
                      : 'Does not tie to the total printed on the form'}
                  </dt>
                  <dd>{moneyExact(printed)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The notice
// ---------------------------------------------------------------------------

function NoticeCard({ extracted }: { extracted: ExtractedNotice | null }) {
  if (!extracted) {
    return (
      <Card>
        <CardHeader title="What the district concluded" />
        <EmptyState title="Nothing was read from this notice">
          The document is stored and can be opened, but extraction produced no values.
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="What the district concluded"
        description="The value the district put on this account, read from the notice itself."
        help="The roll carries assessed values for the four Texas counties we hold, but a notice carries two things the roll does not: the protest deadline actually printed on it, and whether the value was set without a rendition on file."
      />

      <div className="grid grid-cols-2 gap-px border-y border-[var(--color-hairline)] bg-[var(--color-hairline)] sm:grid-cols-4">
        <Tile label="Appraised" value={moneyExact(extracted.appraisedValue)} />
        <Tile label="Assessed" value={moneyExact(extracted.assessedValue)} />
        <Tile label="Prior year" value={moneyExact(extracted.priorYearValue)} />
        <Tile label="Protest by" value={extracted.protestDeadline ?? '—'} />
      </div>

      {/* The single most consequential line on the page: a value set without a
          rendition carries the 10% penalty and an appraiser's own estimate. */}
      {extracted.renditionPenaltyApplied === true ? (
        <p className="flex items-start gap-2 px-5 py-3 text-sm text-[var(--color-warning)]">
          <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
          The notice says the value was set without a rendition on file — so it is the
          district&rsquo;s own estimate, and it carries the 10% failure-to-render penalty.
        </p>
      ) : null}

      {extracted.unreadable.length > 0 ? (
        <div className="border-t border-[var(--color-hairline)] px-5 py-3">
          <p className="text-xs font-medium text-[var(--color-ink-secondary)]">Could not be read</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-[var(--color-ink-muted)]">
            {extracted.unreadable.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
