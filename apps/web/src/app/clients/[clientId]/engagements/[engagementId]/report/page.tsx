'use client';

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { BackLink, Card, ErrorState, Skeleton } from '@/components/ui/primitives';
import { CommitFindings } from '@/components/workspace/commit-findings';
import { PublishRun } from '@/components/workspace/publish-run';
import { SavingsReportView } from '@/components/workspace/savings-report';

/**
 * The savings report on its own route, so it can be sent as a link rather than
 * described. It is a view over live data — settling one more row in the review
 * queue changes it — which is the right behaviour for something an operator
 * pulls up mid-conversation.
 */
export default function SavingsReportPage() {
  const { clientId, engagementId } = useParams<{ clientId: string; engagementId: string }>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['engagement-savings', engagementId],
    queryFn: () => api.savings(engagementId),
  });
  // Separate query on purpose: an answer arriving should not make the report
  // itself flicker, and the report renders perfectly well before it lands.
  const asks = useQuery({
    queryKey: ['engagement-asks', engagementId],
    queryFn: () => api.engagementAsks(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  // The back link, then the report card taking shape under it.
  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-6 w-full max-w-96" />
          <Skeleton className="h-3.5 w-full max-w-2xl" />
        </div>
        <Card>
          {/* The placeholders wrap and reflow exactly as the figures they stand
              in for do. A skeleton that keeps a fixed three-across row is a
              promise about the shape arriving, and on a phone it was a false
              one: the third figure hung off the right edge, and the page it
              was previewing does not do that. */}
          <div className="flex flex-wrap gap-x-8 gap-y-4 border-b border-[var(--color-hairline)] px-5 py-5">
            {[0, 1, 2].map((figure) => (
              <div key={figure} className="space-y-2">
                <Skeleton className="h-2.5 w-28" />
                <Skeleton className="h-7 w-24" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((figure) => (
              <div key={figure} className="space-y-2 px-5 py-4">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-5 w-20" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <SavingsReportView
      report={data}
      asks={asks.data?.items ?? []}
      back={
        <BackLink href={`/clients/${clientId}/engagements/${engagementId}`}>
          Back to the engagement
        </BackLink>
      }
      // Committing sits with the title rather than at the foot of the report,
      // where a reader who scrolled the findings had to scroll back up to find
      // anything else — and where it was the one action on the page with no
      // header to belong to.
      // Two different acts, side by side on purpose. Committing records what
      // this office decided; publishing is what the client is allowed to read.
      // A report can be committed without ever being sent, and — after a
      // register lands — published without anyone having committed it.
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {data.findings.length > 0 ? (
            <CommitFindings clientId={clientId} engagementId={engagementId} source="savings" />
          ) : null}
          <PublishRun engagementId={engagementId} />
        </div>
      }
    />
  );
}
