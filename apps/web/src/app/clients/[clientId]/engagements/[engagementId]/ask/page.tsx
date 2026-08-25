'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AskGraph } from '@/components/workspace/ask-graph';

/**
 * Questions to the record, on their own route.
 *
 * Separate from the engagement's tabs because it is the one screen that spans
 * all of them — the register, the findings, and the season answer one question
 * together — and because an exchange is worth linking to on its own.
 */
export default function AskPage() {
  const { clientId, engagementId } = useParams<{ clientId: string; engagementId: string }>();

  return (
    <div className="space-y-5">
      <Link
        href={`/clients/${clientId}/engagements/${engagementId}`}
        className="inline-flex items-center gap-1 text-xs text-[var(--color-ink-secondary)] hover:text-[var(--color-ink)]"
      >
        <ArrowLeft size={13} strokeWidth={2} />
        Back to the engagement
      </Link>
      <AskGraph clientId={clientId} engagementId={engagementId} />
    </div>
  );
}
