'use client';

import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import Link from 'next/link';
import type { EngagementDetail, FilingSeason } from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { count, plural } from '@/lib/format';
import { Card, TextLink } from '@/components/ui/primitives';

/**
 * The engagement's spine: the pipeline every season walks, and where this one
 * stands on it.
 *
 * The app has always known the order — a register becomes assets, assets get
 * classified, classified assets get placed, placed property becomes returns,
 * returns draw answers — but until now the order lived in the reader's head
 * and the page presented every stage at once. This card says which stage is
 * live, and the one thing to do next, with a link that lands on it.
 *
 * Every judgment here is borrowed, not invented. "Filed" is the record gate's
 * answer, "classified" is the queue's own count, "placed" is the season's —
 * this card computes nothing the cards behind the tabs do not already say,
 * because a second definition of done is how two screens disagree.
 */
export function EngagementPipeline({
  detail,
  tabHref,
  filingHref,
}: {
  detail: EngagementDetail;
  /** Builds the href for a tab on the engagement page, e.g. `?tab=sites`. */
  tabHref: (tab: string) => string;
  filingHref: string;
}) {
  // The same query the returns board mounts — one fetch serves both.
  const season = useQuery({
    queryKey: ['engagement-season', detail.engagement.id],
    queryFn: () => api.season(detail.engagement.id),
  });

  const steps = buildSteps(detail, season.data);
  const current = steps.find((step) => step.state === 'todo');

  return (
    <Card className="px-5 py-4">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-center gap-1">
            {/* The rule between steps is drawn only where the row is one row.
                On a phone the six chips wrap onto three lines and every wrapped
                line began with a dash hanging off its left edge, pointing at
                nothing. The chips are still in order without it. */}
            {index > 0 ? (
              <span
                aria-hidden
                className="mx-1 hidden h-px w-4 bg-[var(--color-hairline)] sm:block"
              />
            ) : null}
            <StepChip
              step={step}
              active={step === current}
              tabHref={tabHref}
              filingHref={filingHref}
            />
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-secondary)]">
        {current ? (
          <>
            <span className="font-medium text-[var(--color-ink)]">Next: </span>
            {current.detail} <Action step={current} tabHref={tabHref} filingHref={filingHref} />
          </>
        ) : season.data ? (
          'Every stage is done — the returns are out and the answers are recorded.'
        ) : (
          'Working out where the season stands…'
        )}
      </p>
    </Card>
  );
}

function StepChip({
  step,
  active,
  tabHref,
  filingHref,
}: {
  step: Step;
  active: boolean;
  tabHref: (tab: string) => string;
  filingHref: string;
}) {
  const body = (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        step.state === 'done'
          ? 'border-transparent text-[var(--color-ink-muted)]'
          : active
            ? 'border-[color-mix(in_oklab,var(--color-accent)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-accent)_10%,transparent)] text-[var(--color-ink)]'
            : 'border-transparent text-[var(--color-ink-muted)]',
      )}
    >
      {step.state === 'done' ? (
        <Check size={11} strokeWidth={2.5} className="text-[var(--color-good)]" />
      ) : (
        <span
          aria-hidden
          className={cn(
            'inline-block size-1.5 rounded-full',
            active ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-hairline)]',
          )}
        />
      )}
      {step.label}
    </span>
  );
  const href = stepHref(step, tabHref, filingHref);
  if (!href) return body;
  return (
    <Link href={href} scroll={false} className="hover:opacity-80">
      {body}
    </Link>
  );
}

function Action({
  step,
  tabHref,
  filingHref,
}: {
  step: Step;
  tabHref: (tab: string) => string;
  filingHref: string;
}) {
  if (!step.action) return null;
  const href = stepHref(step, tabHref, filingHref);
  if (!href) return null;
  return (
    <TextLink href={href} scroll={false}>
      {step.action} →
    </TextLink>
  );
}

function stepHref(step: Step, tabHref: (tab: string) => string, filingHref: string): string | null {
  if (step.goes === null) return null;
  return step.goes === 'filing' ? filingHref : tabHref(step.goes);
}

type Step = {
  id: string;
  label: string;
  state: 'done' | 'todo';
  /** What doing this step means right now, in one sentence. */
  detail: string;
  /** The verb on the link, absent where the fix lives in the header. */
  action: string | null;
  /** Which tab the step lives on, 'filing' for the draft, null for the header. */
  goes: string | 'filing' | null;
};

/**
 * The six stages, each judged by the card that owns it.
 *
 * Steps after the first unfinished one still get honest states — a season can
 * have returns filed while classification has reopened — so this maps facts,
 * not a cursor. The "current" highlight is simply the first thing not done.
 */
function buildSteps(detail: EngagementDetail, season: FilingSeason | undefined): Step[] {
  const { stats, classification, engagement, files } = detail;
  const steps: Step[] = [];

  const mappingWaiting = files.some((file) => file.status === 'parsed');
  steps.push({
    id: 'register',
    label: 'Register',
    state: stats.assetCount > 0 ? 'done' : 'todo',
    detail:
      stats.assetCount > 0
        ? ''
        : mappingWaiting
          ? 'A register is uploaded but its column mapping is not confirmed, so no assets exist yet.'
          : 'Upload the client’s fixed asset register — everything downstream is built from it.',
    action: mappingWaiting ? 'Confirm the mapping' : 'Upload it',
    goes: 'intake',
  });

  steps.push({
    id: 'county',
    label: 'County & SIC',
    state: engagement.jurisdictionId !== null ? 'done' : 'todo',
    detail:
      'Set the county in the header above — property is valued on the district’s own schedules, so nothing can be priced until it is named.',
    action: null,
    goes: null,
  });

  const unclassified = classification.unclassifiedCount + classification.needsReviewCount;
  steps.push({
    id: 'classify',
    label: 'Classify',
    state: stats.assetCount > 0 && unclassified === 0 ? 'done' : 'todo',
    detail:
      stats.assetCount === 0
        ? 'Classification starts once the register is in.'
        : `${count(unclassified)} ${plural(unclassified, 'asset needs', 'assets need')} a decision on which schedule ${plural(unclassified, 'it is', 'they are')} valued on — the decision the money turns on.`,
    action: 'Review the queue',
    goes: 'value',
  });

  const placed = season !== undefined && season.returns.length > 0;
  const unplaced = season?.unplacedCount ?? 0;
  steps.push({
    id: 'sites',
    label: 'Sites',
    state: placed && unplaced === 0 ? 'done' : 'todo',
    detail: !placed
      ? 'Nothing is placed at a site yet. Property is assessed where it stood on January 1, and placement is what decides how many returns there are.'
      : `${count(unplaced)} ${plural(unplaced, 'asset sits', 'assets sit')} at no resolved site, so ${plural(unplaced, 'it is', 'they are')} on no return at all.`,
    action: 'Place the property',
    goes: 'sites',
  });

  const returns = season?.returns ?? [];
  const filed = returns.filter((entry) => entry.status === 'filed');
  const blocked = returns.filter((entry) => entry.status === 'blocked');
  steps.push({
    id: 'file',
    label: 'File',
    state: returns.length > 0 && filed.length === returns.length ? 'done' : 'todo',
    detail:
      returns.length === 0
        ? 'Returns appear once property is placed at a site.'
        : blocked.length > 0
          ? `${count(returns.length - filed.length)} of ${count(returns.length)} ${plural(returns.length, 'return is', 'returns are')} still to file, ${count(blocked.length)} ${plural(blocked.length, 'of them blocked', 'of them blocked')}. ${blocked[0]?.blockers[0]?.message ?? ''}`
          : `${count(returns.length - filed.length)} of ${count(returns.length)} ${plural(returns.length, 'return is', 'returns are')} ready to go out.`,
    action: 'Open the draft',
    goes: 'filing',
  });

  // Answered means the year stopped moving: a resolution on the record, or a
  // protest window that closed with nothing filed — settling by silence is
  // still settling, and a step that never finishes teaches people to ignore it.
  const unanswered = filed.filter((entry) => {
    if (entry.notice === null) return true;
    if (entry.notice.resolution !== null) return false;
    return entry.notice.protestFiledOn !== null || entry.notice.protest.open;
  });
  steps.push({
    id: 'answers',
    label: 'The answers',
    state: filed.length > 0 && unanswered.length === 0 ? 'done' : 'todo',
    detail:
      filed.length === 0
        ? 'The district answers once a return has gone out.'
        : `${count(unanswered.length)} filed ${plural(unanswered.length, 'return is', 'returns are')} waiting on the district — record the notice when it lands, and work the protest from the board below.`,
    action: 'The returns board',
    goes: 'overview',
  });

  return steps;
}
