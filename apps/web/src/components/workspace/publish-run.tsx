'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { RUN_STEP_LABEL, type RunStep } from '@tangible/types';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/controls';

/**
 * Sending the report to the client, as a deliberate act.
 *
 * The firm's report is live and the client's is published, and this is the one
 * control that moves a number across that line. It is not a save and not a
 * commit: committing a finding set records what the partner decided, and this
 * says a business outside the firm may now read it — and emails them to say so.
 *
 * What it shows when there is nothing to do matters as much as the button.
 * "Never published" is the state a preparer is most likely to be wrong about,
 * because the firm-side page looks finished either way; a report that exists
 * only in this office is a client who has been told nothing.
 */
export function PublishRun({ engagementId }: { engagementId: string }) {
  const queryClient = useQueryClient();

  const runs = useQuery({
    queryKey: ['runs', engagementId],
    queryFn: () => api.runs(engagementId),
    // A run started here finishes somewhere else. This is one of two places in
    // the app that polls, and it stops as soon as nothing is in flight.
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === 'queued' || run.status === 'running')
        ? 5_000
        : false,
  });

  const publish = useMutation({
    mutationFn: () => api.requestRun(engagementId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['runs', engagementId] }),
  });

  const inFlight = runs.data?.find((run) => run.status === 'queued' || run.status === 'running');
  const published = runs.data?.find((run) => run.status === 'published');
  const failed = !inFlight && !published ? runs.data?.find((run) => run.status === 'failed') : null;

  return (
    <div className="flex items-center gap-3">
      <div className="text-right text-xs text-[var(--color-ink-muted)]">
        {inFlight ? (
          <span>
            {inFlight.step ? RUN_STEP_LABEL[inFlight.step as RunStep] : 'Queued'}…
          </span>
        ) : published ? (
          <>
            <span className="block">
              Client last saw{' '}
              {new Date(published.publishedAt!).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
              })}
            </span>
            {/* The reference, because the client's copy prints it too and a
                caller quoting one has to be findable from this side. */}
            <span className="block font-mono">{published.id.slice(0, 8)}</span>
          </>
        ) : failed ? (
          // The error itself, not a euphemism: this reader is the one who can
          // act on it. The client's own screen says none of this.
          <span className="text-[var(--color-critical)]">
            Last run failed{failed.error ? `: ${failed.error.slice(0, 80)}` : ''}
          </span>
        ) : (
          <span>Not published — the client has no report yet</span>
        )}
      </div>
      <Button
        onClick={() => publish.mutate()}
        disabled={publish.isPending || inFlight !== undefined}
      >
        <Send className="h-3.5 w-3.5" aria-hidden />
        {published ? 'Publish again' : 'Publish to client'}
      </Button>
    </div>
  );
}
