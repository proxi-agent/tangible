'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import type { IntakeFile, IntakeRoute } from '@tangible/types';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { percent, plural } from '@/lib/format';
import { Button, Select } from '@/components/ui/controls';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * The drop zone for everything the client sent.
 *
 * A client's reply to "send us your register" is a register, a PDF of last
 * year's rendition, a notice, and a photo of a forklift — and the person who
 * receives it spends the first hour deciding which file is which. Triage
 * proposes that sorting; this card is where a person confirms it, file by
 * file, before anything enters a pipeline. The single-file uploads below
 * still work — this card is for the drop that arrives as a pile.
 */
export function IntakeCard({
  clientId,
  engagementId,
}: {
  clientId: string;
  engagementId: string;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement-intake', engagementId],
    queryFn: () => api.intakeFiles(engagementId),
  });

  const upload = useMutation({
    mutationFn: (files: File[]) => api.uploadIntake(engagementId, files),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement-intake', engagementId] });
    },
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading || !data) return <Skeleton className="h-24 w-full" />;

  const open = data.items.filter((item) => item.status === 'triaged' || item.status === 'failed');
  const decided = data.items.filter((item) => item.status === 'routed' || item.status === 'dismissed');

  return (
    <Card>
      <CardHeader
        title="Client drop"
        description="Drop everything the client sent — the AI proposes which file is the register, which is a prior filing or notice, and which is noise. Nothing enters a pipeline until you confirm each route."
      />
      <div className="px-5 pt-4">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) upload.mutate(files);
          }}
          className={cn(
            'flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed px-6 py-6 text-sm transition-colors outline-none',
            'focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--color-series-1)_35%,transparent)]',
            dragging
              ? 'border-[var(--color-series-1)] bg-[color-mix(in_oklab,var(--color-series-1)_8%,transparent)]'
              : 'border-[var(--color-hairline)] hover:border-[color-mix(in_oklab,var(--color-series-1)_45%,transparent)] hover:bg-[var(--color-plane)]',
          )}
        >
          <Inbox size={20} strokeWidth={1.8} className="text-[var(--color-ink-muted)]" />
          {upload.isPending ? (
            <span>Storing and triaging the drop…</span>
          ) : (
            <span className="font-medium">Drop the client&rsquo;s files here — several at once is the point</span>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) upload.mutate(files);
            e.target.value = '';
          }}
        />
        {upload.error ? (
          <p className="mt-2 text-xs text-[var(--color-critical)]">
            {upload.error instanceof Error ? upload.error.message : String(upload.error)}
          </p>
        ) : null}
      </div>

      {open.length > 0 ? (
        <ul className="space-y-3 px-5 py-4">
          {open.map((item) => (
            <TriagedRow key={item.id} item={item} engagementId={engagementId} />
          ))}
        </ul>
      ) : (
        <div className="px-5 py-3" />
      )}

      {decided.length > 0 ? (
        <div className="border-t border-[var(--color-hairline)] px-5 py-3">
          <ul className="space-y-1.5">
            {decided.map((item) => (
              <DecidedRow key={item.id} item={item} clientId={clientId} engagementId={engagementId} />
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

const ROUTE_LABELS: Record<IntakeRoute, string> = {
  register: 'Fixed asset register',
  rendition: 'Prior rendition',
  notice: 'Assessment notice',
  other: 'Something else',
};

/**
 * One file waiting on the human decision.
 *
 * The select starts on the proposal but belongs to the person — routing sends
 * whatever the select says, never what the model said. "Something else" maps
 * to dismiss on purpose: a file that fits no pipeline is a decision worth
 * recording, not a row to leave hanging.
 */
function TriagedRow({ item, engagementId }: { item: IntakeFile; engagementId: string }) {
  const queryClient = useQueryClient();
  const [route, setRoute] = useState<IntakeRoute>(item.proposedRoute ?? 'other');

  const send = useMutation({
    mutationFn: (chosen: IntakeRoute) =>
      api.routeIntake(item.id, chosen === 'other' ? 'dismiss' : chosen),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['engagement-intake', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement', engagementId] });
      void queryClient.invalidateQueries({ queryKey: ['engagement-priors', engagementId] });
    },
  });

  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-2.5 text-xs">
        <span className="min-w-0 font-medium break-all">{item.originalFilename}</span>
        <span className="tabular text-[11px] text-[var(--color-ink-muted)]">
          {(item.byteSize / 1024).toFixed(0)} KB
        </span>
        {item.sheetNames && item.sheetNames.length > 0 ? (
          <span className="text-[11px] text-[var(--color-ink-muted)]">
            {item.sheetNames.length} {plural(item.sheetNames.length, 'sheet')}:{' '}
            {item.sheetNames.join(', ')}
          </span>
        ) : null}
        {item.peek ? (
          <span className="text-[11px] text-[var(--color-ink-muted)]">
            {[
              item.peek.title,
              item.peek.formNumber ? `Form ${item.peek.formNumber}` : null,
              item.peek.accountId ? `account ${item.peek.accountId}` : null,
              item.peek.taxYear ? `${item.peek.taxYear}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || item.peek.summary}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <Select
            value={route}
            onChange={(e) => setRoute(e.target.value as IntakeRoute)}
            className="text-xs"
          >
            {(Object.keys(ROUTE_LABELS) as IntakeRoute[]).map((key) => (
              <option key={key} value={key}>
                {key === 'other' ? 'Dismiss — not for a pipeline' : ROUTE_LABELS[key]}
              </option>
            ))}
          </Select>
          <Button onClick={() => send.mutate(route)} disabled={send.isPending}>
            {send.isPending ? 'Routing…' : route === 'other' ? 'Dismiss' : 'Route'}
          </Button>
        </div>
      </div>
      {item.proposedRoute ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-ink-secondary)]">
          Proposed: {ROUTE_LABELS[item.proposedRoute]}
          {item.proposedConfidence !== null ? ` (${percent(item.proposedConfidence, 0)})` : ''} —{' '}
          {item.proposedReason}
        </p>
      ) : (
        <p className="text-[11px] text-[var(--color-ink-muted)]">
          Triage had no answer for this one — route it by hand.
        </p>
      )}
      {item.status === 'failed' && item.error ? (
        <p className="text-[11px] text-[var(--color-critical)]">{item.error}</p>
      ) : null}
      {send.error ? (
        <p className="text-[11px] text-[var(--color-critical)]">
          {send.error instanceof Error ? send.error.message : String(send.error)}
        </p>
      ) : null}
    </li>
  );
}

/** A decision already made, kept visible: where each file went, or that it was dismissed. */
function DecidedRow({
  item,
  clientId,
  engagementId,
}: {
  item: IntakeFile;
  clientId: string;
  engagementId: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-ink-muted)]">
      <Badge tone={item.status === 'routed' ? 'good' : 'neutral'}>
        {item.status === 'routed' && item.routedKind ? ROUTE_LABELS[item.routedKind] : 'dismissed'}
      </Badge>
      <span className="min-w-0 break-all">{item.originalFilename}</span>
      {item.status === 'routed' && item.routedKind === 'register' && item.routedId ? (
        <Link
          href={`/clients/${clientId}/engagements/${engagementId}/files/${item.routedId}`}
          className="underline underline-offset-2 hover:text-[var(--color-ink)]"
        >
          review mapping
        </Link>
      ) : null}
    </li>
  );
}
