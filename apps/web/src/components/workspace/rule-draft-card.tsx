'use client';

import { useMutation } from '@tanstack/react-query';
import { Copy, FileCode2 } from 'lucide-react';
import { useState } from 'react';
import type { DraftScheduleResult } from '@tangible/types';
import { api } from '@/lib/api';
import { Button, Field, TextArea, TextInput } from '@/components/ui/controls';
import { Badge, Callout, Card, CardHeader } from '@/components/ui/primitives';

/**
 * Adding a county, without giving a model the keys to the valuation.
 *
 * The split is the point. A model reads the district's published guide and
 * transcribes the tables; arithmetic here and in `@tangible/eval` checks the
 * things that are true of every published schedule — percent good falls with
 * age, index factors rise with it, nothing is outside 0–100; and what comes
 * back is *source text*, which a person reads, commits, and has reviewed like
 * any other change. Nothing on this card takes effect anywhere.
 *
 * The alternative — schedules living in a table an agent writes to — would mean
 * a client's assessed value could move between two runs with no diff to read
 * and nobody's name against it. That is the incumbent failure mode with a
 * faster engine bolted on.
 */
export function RuleDraftCard() {
  const [jurisdictionId, setJurisdictionId] = useState('');
  const [jurisdictionName, setJurisdictionName] = useState('');
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [guideText, setGuideText] = useState('');

  const draft = useMutation({
    mutationFn: () =>
      api.draftSchedule({
        jurisdictionId: jurisdictionId.trim(),
        jurisdictionName: jurisdictionName.trim(),
        taxYear: Number(taxYear),
        sourceTitle: sourceTitle.trim(),
        sourceUrl: sourceUrl.trim() === '' ? null : sourceUrl.trim(),
        guideText,
      }),
  });

  const ready =
    jurisdictionId.trim().length > 3 &&
    jurisdictionName.trim().length > 2 &&
    sourceTitle.trim().length > 2 &&
    Number.isInteger(Number(taxYear)) &&
    guideText.trim().length >= 200;

  return (
    <Card>
      <CardHeader
        icon={FileCode2}
        title="Draft a district's schedule"
        description="Paste the published guide. What comes back is a source file to review and commit — it changes nothing until someone does."
        help="Runtime valuation never calls a model. This is the only place one reads a guide, it runs when a person asks it to, and its output is text."
      />

      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Jurisdiction id" help="Lowercase, state first — tx-dallas, fl-broward.">
            <TextInput
              value={jurisdictionId}
              onChange={(e) => setJurisdictionId(e.target.value)}
              placeholder="tx-dallas"
              spellCheck={false}
            />
          </Field>
          <Field label="District" help="How a person says it. Printed on reports.">
            <TextInput
              value={jurisdictionName}
              onChange={(e) => setJurisdictionName(e.target.value)}
              placeholder="Dallas County, TX"
            />
          </Field>
          <Field label="Tax year" help="The year the guide governs, not the year it was published.">
            <TextInput
              value={taxYear}
              onChange={(e) => setTaxYear(e.target.value)}
              inputMode="numeric"
            />
          </Field>
          <Field label="Document" help="Its own title, as the citation will quote it.">
            <TextInput
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
              placeholder="DCAD BPP Valuation Procedures, Tax Year 2026"
            />
          </Field>
          <Field
            label="Source URL"
            help="Recorded in the citation. Nothing fetches it — the text below is what gets read."
            className="sm:col-span-2"
          >
            <TextInput
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://…"
              spellCheck={false}
            />
          </Field>
        </div>

        <Field
          label="Guide text"
          help="Paste the whole valuation section, tables included. A partial paste produces a partial schedule, and the review will say which columns are missing."
        >
          <TextArea
            rows={8}
            value={guideText}
            onChange={(e) => setGuideText(e.target.value)}
            placeholder="Paste the extracted text of the district's BPP valuation guide…"
            spellCheck={false}
            className="font-mono text-xs"
          />
        </Field>

        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            onClick={() => draft.mutate()}
            disabled={!ready || draft.isPending}
          >
            {draft.isPending ? 'Reading the guide…' : 'Draft the schedule'}
          </Button>
          <span className="text-xs text-[var(--color-ink-muted)]">
            {ready
              ? 'Nothing is saved. The response is a file to review.'
              : 'Fill in the district, the year, the document, and at least a page of the guide.'}
          </span>
        </div>

        {draft.error ? (
          <Callout tone="critical">
            {draft.error instanceof Error ? draft.error.message : String(draft.error)}
          </Callout>
        ) : null}
        {draft.data ? <DraftResult result={draft.data} /> : null}
      </div>
    </Card>
  );
}

function DraftResult({ result }: { result: DraftScheduleResult }) {
  const { review, draft } = result;
  const slug = `${draft.jurisdictionId}-${draft.taxYear}`;

  return (
    <div className="space-y-4 border-t border-[var(--color-hairline)] pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={review.ok ? 'good' : 'critical'} dot>
          {review.ok ? 'Coherent' : `${review.problems.length} blocking`}
        </Badge>
        <Badge tone="neutral">
          {draft.percentGood.length} percent-good{' '}
          {draft.percentGood.length === 1 ? 'column' : 'columns'}
        </Badge>
        <Badge tone="neutral">{draft.indexFactors.length} index years</Badge>
        <Badge tone="neutral">{draft.sicProfiles.length} SIC profiles</Badge>
        <span className="ml-auto text-xs text-[var(--color-ink-muted)]">{result.model}</span>
      </div>

      {/* Problems first and unmissable: the two tables below are perfectly
          readable source code whether or not the numbers in them can be true,
          and that is exactly how a bad schedule gets committed. */}
      {review.problems.map((problem) => (
        <Callout key={problem} tone="critical">
          {problem}
        </Callout>
      ))}
      {review.observations.map((observation) => (
        <Callout key={observation} tone="warning">
          {observation}
        </Callout>
      ))}

      <Callout tone="neutral" title="What to do with this">
        Read the tables against the guide, then put the first file at{' '}
        <code className="font-mono text-xs">packages/valuation/src/schedules/{slug}.ts</code> and
        the second at <code className="font-mono text-xs">packages/eval/src/goldens/{slug}.ts</code>
        , register the schedule, and open a pull request. The goldens arrive with their expectations
        blank on purpose — they have to come from a real assessment notice, not from running our own
        arithmetic against the transcription they exist to guard. Set{' '}
        <code className="font-mono text-xs">approvedBy</code> when someone has actually checked the
        cells.
      </Callout>

      <SourceBlock label={`${slug}.ts`} source={review.scheduleModule} />
      <SourceBlock label={`goldens/${slug}.ts`} source={review.goldenModule} />
    </div>
  );
}

function SourceBlock({ label, source }: { label: string; source: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-hairline)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--color-hairline)] bg-[var(--color-sunken)] px-3 py-2">
        <span className="font-mono text-xs text-[var(--color-ink-secondary)]">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void navigator.clipboard.writeText(source).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <Copy size={13} />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <pre className="max-h-80 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
        {source}
      </pre>
    </div>
  );
}
