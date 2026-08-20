import type { EngagementReturns } from '@tangible/types';
import { handle } from '@/lib/route';
import { engagementReturns } from '@/lib/sites';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How many returns this engagement owes.
 *
 * Separate from the rendition itself because the answer is needed before any
 * form can be built: with two sites there is no single draft to show, and the
 * screen has to offer a choice rather than quietly pick one. It is also the
 * cheap query — counts and labels, no schedules, no valuation — which is what
 * a picker at the top of a page should cost.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<EngagementReturns> => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);
    return engagementReturns(engagementId);
  });
}
