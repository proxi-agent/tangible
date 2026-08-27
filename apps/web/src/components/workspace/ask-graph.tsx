'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Boxes, LayoutList, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import type { GraphAskRecord, GraphReference } from '@tangible/types';
import { api } from '@/lib/api';
import { day } from '@/lib/format';
import { Button, TextArea } from '@/components/ui/controls';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { InfoTip } from '@/components/ui/tooltip';

/**
 * Ask the record a question and read the answer with the record still in reach.
 *
 * The same contract as the drafting agents — code assembles every fact, the
 * model only writes — with one addition that matters more here than in a
 * letter: an answer carries references, and code checked each one against the
 * digest before this screen ever saw it. So a chip below is a link that leads
 * somewhere, and a claim that leaned on something the record does not hold
 * shows up as a dropped-reference line rather than a confident sentence.
 *
 * Exchanges accumulate; none is ever edited. Ask again after the register
 * moves and the older answer stays readable as what the record said then.
 */
const ASK_HELP =
  'The answer is assembled the way every draft here is: code gathers the facts first, and the answer is stored beside the exact facts it was given. Nothing outside that digest reaches the answer, so “the record does not hold this” is a real answer and not a failure. References are checked against the digest before you see them — a citation the record cannot back is dropped and counted.';

export function AskGraph({
  clientId,
  engagementId,
  back,
}: {
  clientId: string;
  engagementId: string;
  back?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState('');
  const query = useQuery({
    queryKey: ['graph-asks', engagementId],
    queryFn: () => api.graphAsks(engagementId),
  });

  const ask = useMutation({
    mutationFn: () => api.askGraph(engagementId, question.trim()),
    onSuccess: (result) => {
      queryClient.setQueryData(
        ['graph-asks', engagementId],
        (previous: { asks: GraphAskRecord[] } | undefined) => ({
          asks: [result.ask, ...(previous?.asks ?? [])],
        }),
      );
      setQuestion('');
    },
  });

  if (query.error) return <ErrorState error={query.error} />;
  const asks = query.data?.asks ?? [];
  const ready = question.trim().length >= 3;

  return (
    <div className="space-y-4">
      {/* The page says what this screen is; the card gets on with asking. */}
      <PageHeader
        back={back}
        title="Ask the record"
        meta={<InfoTip title="Ask the record" content={ASK_HELP} />}
        description="A question about this engagement, answered from the register, the findings, and the season board — the same data the screens render."
      />
      <Card>
        <div className="space-y-2.5 p-5">
          <TextArea
            rows={2}
            className="w-full"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Which sites are still unfiled, and what is holding each one up?"
            maxLength={500}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              disabled={!ready || ask.isPending}
              onClick={() => ask.mutate()}
            >
              {ask.isPending ? 'Reading the record…' : 'Ask'}
            </Button>
            <span className="text-xs text-[var(--color-ink-muted)]">
              Answers are kept — this engagement&rsquo;s last twenty are below.
            </span>
          </div>
          {ask.error ? (
            <p className="text-xs leading-relaxed text-[var(--color-critical)]">
              {ask.error instanceof Error ? ask.error.message : String(ask.error)}
            </p>
          ) : null}
        </div>
      </Card>

      {query.isLoading ? (
        <Card>
          <div className="space-y-2 p-5">
            <Skeleton className="h-4 w-64" />
            <Skeleton className="h-3.5 w-full max-w-lg" />
            <Skeleton className="h-3.5 w-full max-w-md" />
          </div>
        </Card>
      ) : asks.length === 0 ? (
        <EmptyState title="Nothing asked yet">
          Questions and their answers are recorded here, each one frozen with the facts it was
          answered from.
        </EmptyState>
      ) : (
        asks.map((record) => (
          <Exchange
            key={record.id}
            record={record}
            clientId={clientId}
            engagementId={engagementId}
          />
        ))
      )}
    </div>
  );
}

function Exchange({
  record,
  clientId,
  engagementId,
}: {
  record: GraphAskRecord;
  clientId: string;
  engagementId: string;
}) {
  const { answer, facts } = record;
  return (
    <Card>
      <div className="space-y-3 p-5">
        {/* The question is this card's heading — it had been a bold paragraph,
            which left a page of exchanges with no headings in it at all. */}
        <h2 className="text-base leading-snug font-semibold tracking-[-0.011em]">
          {record.question}
        </h2>
        {/* Reading the answer is the whole point of the screen, so it is set at
            body size rather than the caption size a card's subtitle uses. */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-[var(--color-ink-secondary)]">
          {answer.answer}
        </p>

        {answer.references.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {answer.references.map((reference) => (
              <ReferenceChip
                key={`${reference.kind}|${reference.id ?? ''}`}
                reference={reference}
                clientId={clientId}
                engagementId={engagementId}
              />
            ))}
          </div>
        ) : null}

        {answer.limits.length > 0 ? (
          <div className="text-xs leading-relaxed">
            {/* Facing the firm, not the client — what the record could not settle. */}
            <p className="font-medium text-[var(--color-warning)]">What this answer could not do</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[var(--color-ink-muted)]">
              {answer.limits.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-[var(--color-ink-muted)]">
          Answered {day(record.createdAt.slice(0, 10))}
          {record.model ? <> by {record.model}</> : null} from the record as it stood then:{' '}
          {facts.assets.length} asset {facts.assets.length === 1 ? 'line' : 'lines'}
          {facts.assetsOmitted > 0 ? (
            <> of {facts.assets.length + facts.assetsOmitted}</>
          ) : null}, {facts.findings.length} {facts.findings.length === 1 ? 'finding' : 'findings'},{' '}
          {facts.season.sites.length} {facts.season.sites.length === 1 ? 'site' : 'sites'}.
        </p>
      </div>
    </Card>
  );
}

/** A checked reference, so following it never lands on something that is not there. */
function ReferenceChip({
  reference,
  clientId,
  engagementId,
}: {
  reference: GraphReference;
  clientId: string;
  engagementId: string;
}) {
  const base = `/clients/${clientId}/engagements/${engagementId}`;
  const Icon =
    reference.kind === 'asset'
      ? Boxes
      : reference.kind === 'site'
        ? MapPin
        : reference.kind === 'report'
          ? FileText
          : LayoutList;
  // Sites and the season board both live on the engagement page; only the
  // per-asset profile and the report have routes of their own.
  const href =
    reference.kind === 'asset'
      ? `${base}/assets/${reference.id}`
      : reference.kind === 'report'
        ? `${base}/report`
        : base;

  return (
    <Link
      href={href}
      className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-ink-secondary)] transition-colors hover:bg-[var(--color-plane)] hover:text-[var(--color-ink)]"
    >
      <Icon size={11} strokeWidth={2} />
      {reference.label}
    </Link>
  );
}
