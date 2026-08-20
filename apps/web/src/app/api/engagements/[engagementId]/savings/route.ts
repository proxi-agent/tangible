import type { SavingsReport } from '@tangible/types';
import { buildSavingsAnalysis } from '@/lib/analysis';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The savings report, derived on read.
 *
 * Nothing here is stored: the report is a view of the classifications and the
 * published schedules at the moment it is asked for, so it cannot go stale
 * against the decisions it was built from. Settling one more row in the review
 * queue changes this number immediately, which is exactly the behaviour you
 * want from a document someone is about to put in front of a client.
 *
 * Committing a copy is a separate, deliberate act — see the findings routes.
 * Asking for the report never commits one.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<SavingsReport> => {
    const { engagementId } = await params;
    const { report } = await buildSavingsAnalysis(engagementId);
    return report;
  });
}
