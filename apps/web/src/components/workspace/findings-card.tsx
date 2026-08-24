'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ScrollText } from 'lucide-react';
import Link from 'next/link';
import type { FindingSetSummary } from '@tangible/types';
import { api } from '@/lib/api';
import { count, moneyExact, plural } from '@/lib/format';
import { Badge, Card, CardHeader, ErrorState, Skeleton } from '@/components/ui/primitives';

/**
 * What has been committed on this engagement, and what is still undecided.
 *
 * The card only appears once something has been committed. An empty one would
 * be an invitation to commit early, and a report committed before the review
 * queue is settled is a claim nobody meant to make — the act belongs on the
 * report itself, at the point where somebody has just read it.
 */

const SOURCE_LABELS: Record<string, string> = {
  savings: 'Savings report',
  'register-comparison': 'Return vs. register',
};

export function FindingsCard({
  clientId,
  engagementId,
  empty,
}: {
  clientId: string;
  engagementId: string;
  /** Rendered instead of nothing where no set is committed — the card hides on
      the crowded page and explains itself on a tab of its own. */
  empty?: React.ReactNode;
}) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['finding-sets', engagementId],
    queryFn: () => api.findingSets(engagementId),
  });

  if (error) return <ErrorState error={error} />;
  if (isLoading) return <Skeleton className="h-24 w-full" />;

  const sets = data?.items ?? [];
  if (sets.length === 0) return empty ?? null;

  return (
    <Card>
      <CardHeader
        title="Committed versions"
        description="Dated records of the figures that went out, with what was decided about every line."
        help="Decisions carry forward; the numbers do not. A finding dispositioned once stays dispositioned when the analysis is committed again."
      />
      <ul className="divide-y divide-[var(--color-hairline)]">
        {sets.map((set) => (
          <li key={set.id}>
            <Link
              href={`/clients/${clientId}/engagements/${engagementId}/findings/${set.id}`}
              className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-plane)]"
            >
              <ScrollText
                size={15}
                strokeWidth={1.8}
                className="mt-0.5 shrink-0 text-[var(--color-ink-muted)]"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">
                    {set.label ?? SOURCE_LABELS[set.source] ?? set.source}
                  </span>
                  <Badge tone="neutral">{set.taxYear}</Badge>
                  {set.isStale ? (
                    // Not "behind the workspace" — that phrase is house
                    // vocabulary. The badge has to tell a first-time reader
                    // what happened: the work moved after this was committed.
                    <Badge tone="warning">
                      <AlertTriangle size={11} strokeWidth={2} className="mr-1" />
                      workspace has changed since
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-0.5 text-xs text-[var(--color-ink-secondary)]">
                  {new Date(set.committedAt).toLocaleDateString()}
                  {set.committedBy ? ` · ${set.committedBy}` : ''} · {progress(set)}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium tabular-nums">
                  {moneyExact(set.headline.value)}
                </div>
                <div className="text-[11px] text-[var(--color-ink-muted)]">
                  {set.headline.label.toLowerCase()}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** "4 of 9 decided" — the number an operator actually opens this list to see. */
function progress(set: FindingSetSummary): string {
  if (set.decidedCount === 0)
    return `${count(set.findingCount)} ${plural(set.findingCount, 'finding')}, none decided`;
  if (set.decidedCount >= set.findingCount) return 'every finding decided';
  return `${count(set.decidedCount)} of ${count(set.findingCount)} decided`;
}
