import type { CarryForward } from '@tangible/filing';
import { engagementCarryForward } from '@/lib/carry-forward';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * What changed between last season's returns and this season's register.
 *
 * Cheap by the standards of this app — two indexed queries and a set
 * subtraction, no rendition built and no model called — so it is its own read
 * rather than a field on the engagement, which keeps a first-season client from
 * paying for a comparison that has nothing to compare against.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<CarryForward> => {
    const { engagementId } = await params;
    return engagementCarryForward(engagementId);
  });
}
