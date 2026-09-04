import type { PortalStage } from '@tangible/types';
import { portalStage } from '@/lib/portal-stage';
import { handle } from '@/lib/route';
import { requireEngagementScope } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How far along this season is, for the shell that has to decide what to draw.
 *
 * One endpoint rather than the four the rail would otherwise call — intake,
 * report, returns, recovery — because it runs on every portal page load and
 * three of those four build a document to answer a question about whether one
 * exists.
 *
 * Scoped like everything else in the wing: a client asking about somebody
 * else's engagement gets the same 404 they get from `/report`. Nothing here is
 * a secret the app was keeping — the counts describe the reader's own file —
 * but a route that skipped the check would confirm which engagement ids are
 * real, which is the reason the handlers answer 404 rather than 403.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<PortalStage> => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    return portalStage(engagementId);
  });
}
