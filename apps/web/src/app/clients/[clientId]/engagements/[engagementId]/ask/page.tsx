'use client';

import { BackLink } from '@/components/ui/primitives';
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
    <AskGraph
      clientId={clientId}
      engagementId={engagementId}
      back={
        <BackLink href={`/clients/${clientId}/engagements/${engagementId}`}>
          Back to the engagement
        </BackLink>
      }
    />
  );
}
