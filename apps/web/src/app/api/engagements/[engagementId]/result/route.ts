import type { EngagementResult } from '@tangible/types';
import { engagementResult } from '@/lib/result';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What the engagement's year came to, per site and summed.
 *
 * Read-only by nature: every number in it is derived from records other
 * screens wrote — the filing, the notice, the resolution, the motion — and
 * the result is only trustworthy because nothing can be written to it
 * directly.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<EngagementResult> => {
    const { engagementId } = await params;
    return engagementResult(engagementId);
  });
}
