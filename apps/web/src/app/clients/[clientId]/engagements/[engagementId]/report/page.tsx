'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { ErrorState, Skeleton } from '@/components/ui/primitives';
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
  if (isLoading || !data) return <Skeleton className="h-96 w-full" />;

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
    </div>
  );
}
