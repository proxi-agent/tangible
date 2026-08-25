'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Card, ErrorState, Skeleton } from '@/components/ui/primitives';
import { CommitFindings } from '@/components/workspace/commit-findings';
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

  if (error) return <ErrorState error={error} />;
  // The back link, then the report card taking shape under it.
  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-4 w-44" />
        <Card>
          <div className="space-y-2 p-5">
            <Skeleton className="h-5 w-80" />
            <Skeleton className="h-3.5 w-full max-w-lg" />
          </div>
          <div className="space-y-3 px-5 pb-5">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href={`/clients/${clientId}/engagements/${engagementId}`}
        className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
      >
        <ArrowLeft size={13} strokeWidth={2} />
        Back to the engagement
      </Link>
      <SavingsReportView report={data} />
      {data.findings.length > 0 ? (
        <div className="flex justify-end">
          <CommitFindings clientId={clientId} engagementId={engagementId} source="savings" />
        </div>
      ) : null}
    </div>
  );
}
