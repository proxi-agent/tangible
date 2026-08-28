import { CapitalizationAdviceRequestSchema } from '@tangible/types';
import { adviseCapitalization } from '@/lib/precap';
import { handle } from '@/lib/route';
import { requireEngagementScope, requirePortalRole } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Price a purchase that has not been made.
 *
 * A POST that writes nothing, which is deliberate rather than lazy: the whole
 * value of asking before the money is spent is that asking costs nothing and
 * commits to nothing. It is a POST at all because the question is a body, not
 * because there is state behind it.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    // The advisor points the classification model at whatever wording is typed
    // into it, the same as the ask endpoint. A read-only viewer reads reports.
    await requirePortalRole('admin');
    const body = CapitalizationAdviceRequestSchema.parse(await request.json());
    return { advice: await adviseCapitalization(engagementId, body) };
  });
}
