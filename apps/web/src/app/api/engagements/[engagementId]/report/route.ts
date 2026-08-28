import { handle } from '@/lib/route';
import { publishedReport } from '@/lib/runs';
import { requireEngagementScope } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The report as the client is entitled to see it: the last published run.
 *
 * Deliberately not `/savings`, which derives the report on read. That endpoint
 * is right for the preparer who is causing the numbers to move and indefensible
 * for the taxpayer who is not — a business that reads $84,000 on Tuesday and
 * $61,000 on Thursday, with nothing in between they did or were told about, has
 * been given two answers and no way to tell which was real.
 *
 * `inFlight` is what a client sees when there is no published run yet: the
 * progress of the one that is coming, so an empty portal says "we are reading
 * your register" instead of nothing at all.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    return publishedReport(engagementId);
  });
}
