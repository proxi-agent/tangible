'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { Card, ErrorState, Skeleton } from '@/components/ui/primitives';
import { FindingSetView } from '@/components/workspace/finding-set';

/**
 * One committed version, on its own route.
 *
 * The link is the artefact: "what did we send them in March" is a question with
 * a URL now, and the answer does not change when the register does.
 */
export default function FindingSetPage() {
  const { clientId, engagementId, setId } = useParams<{
    clientId: string;
    engagementId: string;
    setId: string;
  }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['finding-set', setId],
    queryFn: () => api.findingSet(setId),
  });

  if (error) return <ErrorState error={error} />;
  // The back link, then the finding-set card: header lines over finding rows.
  if (isLoading || !data) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-4 w-44" />
        <Card>
          <div className="space-y-2 p-5">
            <Skeleton className="h-5 w-72" />
            <Skeleton className="h-3.5 w-full max-w-lg" />
          </div>
          <ul className="divide-y divide-[var(--color-hairline)]">
            {[0, 1, 2].map((row) => (
              <li key={row} className="px-5 py-4">
                <Skeleton className="h-4 w-full max-w-md" />
              </li>
            ))}
          </ul>
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
      <FindingSetView set={data} />
    </div>
  );
}
