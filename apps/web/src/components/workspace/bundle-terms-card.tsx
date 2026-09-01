'use client';

import { useQuery } from '@tanstack/react-query';
import { Copy, ShieldAlert, WholeWord } from 'lucide-react';
import { useState } from 'react';
import type {
  BundleTermChallengeView,
  BundleTermProposalView,
  WithheldPhraseView,
} from '@tangible/types';
import { api } from '@/lib/api';
import { count, percent, plural } from '@/lib/format';
import { Button } from '@/components/ui/controls';
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
 * The wordings the advisor knows, held against the wordings the firm settles.
 *
 * `bundles.ts` is twenty-seven phrases somebody typed once. It reads register
 * descriptions all day and has never been told whether any of them were the
 * right phrases, because the place a person's answer about a wording is stored
 * — the classification memory — was never read as anything but a cache. It is
 * also a labelled corpus, and this card is what it says.
 *
 * Nothing here applies itself. A proposal is a line of source to paste and a
 * challenge is an argument to have; the advisor's list changes when somebody
 * edits the file and opens a diff, exactly as a schedule does. That bar is
 * higher than these signals strictly need — a bundle hint changes no
 * classification and files nothing — but lower stakes are a reason for a low
 * bar, not for no signature.
 */
export function BundleTermsCard() {
  const board = useQuery({ queryKey: ['bundle-terms'], queryFn: () => api.bundleTerms() });

  if (board.error) return <ErrorState error={board.error} />;
  if (!board.data) return <Loading />;

  const data = board.data;
  if (data.observations === 0) return <Nothing />;

  return (
    <Card>
      <CardHeader
        icon={WholeWord}
        title="What the register calls things"
        description="The bundle advisor's wording list, graded against every description this practice has settled — and the wordings it has never heard of that predict the same thing."
        help="A phrase is judged only on wordings a person settled and nobody later disagreed with. Prior-return line mappings live in the same table and are excluded: their keys name form lines, not classes, and counting them would deflate every rate on this card."
      />

      <StatGrid columns={4}>
        <StatCell>
          <Stat
            label="Settled wordings"
            value={count(data.observations)}
            note={`${count(data.exclusionObservations)} an exclusion`}
            help="One row per distinct description a reviewer answered. Forty invoices reading the same way are one wording, because they are one judgement."
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Phrases judged"
            value={count(data.judgedPhrases)}
            help="Every one- and two-word phrase the record used often enough to say anything about."
          />
        </StatCell>
        <StatCell>
          <Stat
            label="In the list today"
            value={count(data.vocabularySize)}
            note={`${count(data.challenges.length)} the record argues with`}
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Proposed"
            value={count(data.proposals.length)}
            tone={data.proposals.length > 0 ? 'accent' : 'default'}
            note={data.withheld.length > 0 ? `${count(data.withheld.length)} withheld` : undefined}
          />
        </StatCell>
      </StatGrid>

      <Proposals rows={data.proposals} />
      <Withheld rows={data.withheld} />
      <Challenges rows={data.challenges} />
      <Unobserved terms={data.unobserved} />
    </Card>
  );
}

/**
 * Wordings the record settles as an exclusion and the advisor cannot see.
 *
 * Two numbers per row, never one. "72% of the time" means nothing until you
 * know what share of everything was that exclusion anyway; a phrase that fires
 * on the record's own base rate has told you it is a common word, not a signal.
 */
function Proposals({ rows }: { rows: BundleTermProposalView[] }) {
  if (rows.length === 0) {
    return (
      <div className="border-t border-[var(--color-hairline)] px-5 py-4 text-sm text-[var(--color-ink-muted)]">
        Nothing to add. No wording outside the list carried an exclusion often enough, or cleanly
        enough, to be worth proposing.
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--color-hairline)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-2">
        <h3 className="text-sm font-medium">
          <Tooltip content="Each rate is pulled toward the share of all settled wordings that carried this exclusion — the hypothesis that the phrase means nothing — in proportion to how few mentions it has. A phrase seen six times cannot outvote that on its own.">
            <span>Wordings worth adding</span>
          </Tooltip>
        </h3>
        <p className="text-xs text-[var(--color-ink-muted)]">
          {count(rows.length)} {plural(rows.length, 'proposal')}. Paste one and open a diff; nothing
          here is stored.
        </p>
      </div>
      <ul className="divide-y divide-[var(--color-hairline)]">
        {rows.map((row) => (
          <li key={`${row.exclusionKey}:${row.phrase}`} className="space-y-2 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-[var(--color-ink)]">{row.phrase}</span>
              <Badge tone="accent">{row.label}</Badge>
              <span className="tabular text-xs text-[var(--color-ink-secondary)]">
                {percent(row.precision)} against a {percent(row.baseRate)} base
              </span>
              <span className="tabular text-xs text-[var(--color-ink-muted)]">
                {count(row.support)} of {count(row.mentions)}
                {row.contradicting > 0 ? ` · ${count(row.contradicting)} taxable` : ''}
              </span>
            </div>

            {row.alternates.length > 0 ? (
              /*
               * One signal wearing several faces. These fired on exactly the
               * same settled rows, so the record cannot separate them — saying
               * so is more honest than picking one silently or printing the
               * same finding five times.
               */
              <p className="text-xs text-[var(--color-ink-muted)]">
                Indistinguishable here from {row.alternates.map((one) => `“${one}”`).join(', ')} —
                same rows, every time.
              </p>
            ) : null}

            <ul className="space-y-0.5">
              {row.samples.map((sample) => (
                <li key={sample} className="truncate text-xs text-[var(--color-ink-soft)]">
                  {sample}
                </li>
              ))}
            </ul>

            <SourceLine source={row.source} />
            <p className="text-xs text-[var(--color-ink-muted)]">{row.basis}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The proposals that would have been wrong in the expensive direction.
 *
 * Installation genuinely predicts an intangible in the record — a software
 * rollout is an installation — and publishing it would tell a preparer to strip
 * an installation cost out of an asset's basis. Installation is part of the
 * reported cost. That is not a worse estimate, it is a sworn return understated
 * by an amount the firm put there, so the arithmetic loses to the statute and
 * says why in public rather than dropping the row.
 */
function Withheld({ rows }: { rows: WithheldPhraseView[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-[var(--color-hairline)] px-5 py-4">
      <Callout tone="critical" icon={ShieldAlert} title="Withheld, though the record supports them">
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={`${row.exclusionKey}:${row.phrase}`}>
              <span className="font-mono">{row.phrase}</span> — {percent(row.precision)} across{' '}
              {count(row.mentions)} {plural(row.mentions, 'wording')}, and it overlaps{' '}
              <span className="font-mono">{row.collidesWith}</span>. {row.reason}
            </li>
          ))}
        </ul>
      </Callout>
    </div>
  );
}

/**
 * Terms in the list the record mostly settles the other way.
 *
 * A challenge is weaker than a proposal and is drawn weaker. A wording ends up
 * in the list because somebody had a reason — often a statute rather than a
 * frequency — and a register that mostly uses it another way is evidence about
 * this firm's clients, not proof the term is wrong. So these are printed as an
 * argument to have, with the classes it actually got, and never as a deletion.
 */
function Challenges({ rows }: { rows: BundleTermChallengeView[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-[var(--color-hairline)]">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-2">
        <h3 className="text-sm font-medium">Terms the record disagrees with</h3>
        <p className="text-xs text-[var(--color-ink-muted)]">
          Worth an argument, not a deletion. A term can be right about the statute and wrong about
          this practice&rsquo;s registers.
        </p>
      </div>
      <ul className="divide-y divide-[var(--color-hairline)]">
        {rows.map((row) => (
          <li key={`${row.exclusionKey}:${row.phrase}`} className="space-y-2 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-[var(--color-ink)]">{row.phrase}</span>
              <Badge tone="warning">{row.label}</Badge>
              <span className="tabular text-xs text-[var(--color-ink-secondary)]">
                {percent(row.precision)} across {count(row.mentions)}{' '}
                {plural(row.mentions, 'wording')}
              </span>
            </div>
            <p className="text-xs text-[var(--color-ink-secondary)]">
              Settled instead as{' '}
              {row.settledAs.map((one) => `${one.categoryKey} (${count(one.count)})`).join(', ')}.
            </p>
            <ul className="space-y-0.5">
              {row.samples.map((sample) => (
                <li key={sample} className="truncate text-xs text-[var(--color-ink-soft)]">
                  {sample}
                </li>
              ))}
            </ul>
            <p className="text-xs text-[var(--color-ink-muted)]">{row.basis}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Terms nothing in the record has ever used.
 *
 * Named, and named as a non-finding. A word no register happened to use is a
 * word this practice has not met — capitalized interest is real and rare — and
 * an unchallenged term sitting silently next to a list of challenged ones would
 * read as endorsed.
 */
function Unobserved({ terms }: { terms: string[] }) {
  if (terms.length === 0) return null;
  return (
    <div className="border-t border-[var(--color-hairline)] px-5 py-4">
      <p className="text-xs text-[var(--color-ink-muted)]">
        {count(terms.length)} {plural(terms.length, 'term')} no settled wording has ever used:{' '}
        {terms.map((term) => (
          <span key={term} className="font-mono">
            {term}
            {term === terms[terms.length - 1] ? '' : ', '}
          </span>
        ))}
        . Nothing on this card is an opinion about them — silence is not disagreement.
      </p>
    </div>
  );
}

/** The line to paste into `TERMS`, and the only output of this card. */
function SourceLine({ source }: { source: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-hairline)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] bg-[var(--color-sunken)] px-3 py-2">
        <span className="font-mono text-xs text-[var(--color-ink-secondary)]">
          packages/classification/src/bundles.ts
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void (async () => {
              await navigator.clipboard.writeText(source);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })();
          }}
        >
          <Copy size={13} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
        {source}
      </pre>
    </div>
  );
}

function Nothing() {
  return (
    <Card>
      <CardHeader
        icon={WholeWord}
        title="What the register calls things"
        description="The bundle advisor's wording list, graded against every description this practice has settled."
      />
      <EmptyState title="No settled wording to read yet">
        The advisor&rsquo;s twenty-seven phrases are the only vocabulary it has, and confirming
        classifications in the review queue is what starts adding to them. Every confirmed
        description is one row here; nothing extra is asked of anybody.
      </EmptyState>
    </Card>
  );
}

function Loading() {
  return (
    <Card>
      <CardHeader icon={WholeWord} title="What the register calls things" />
      <div className="space-y-3 p-5">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </Card>
  );
}
