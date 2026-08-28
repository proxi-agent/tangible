import { topQueue, QUEUE_SIZE } from '@tangible/savings';
import type { FindingQueue, SavingsReport } from '@tangible/types';
import { allRowDecisions } from '@/lib/finding-rows';
import { handle, HttpError } from '@/lib/route';
import { publishedReport } from '@/lib/runs';
import { requireEngagementScope } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The next twenty-five things worth doing, across every finding at once.
 *
 * Built off the published run rather than the live analysis, for the same
 * reason every other client-facing screen is: a queue that reorders itself
 * between two sittings is not a queue. What does change between requests is the
 * decisions — a row accepted this morning drops out of the ranking this
 * afternoon, which is what makes the list finishable.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<FindingQueue> => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);

    const published = await publishedReport(engagementId);
    const report = published.report as SavingsReport | null;
    if (!report) {
      throw new HttpError(404, 'Nothing has been published for this engagement yet.');
    }

    const url = new URL(request.url);
    const queue = topQueue(report, {
      offset: Number(url.searchParams.get('offset') ?? 0) || 0,
      size: Number(url.searchParams.get('size') ?? 0) || QUEUE_SIZE,
      decided: await allRowDecisions(engagementId),
    });
    // The run stamp belongs to the caller rather than to the pure function: the
    // queue is arithmetic over a report and does not know which run stored it.
    return { ...queue, runId: published.runId, publishedAt: published.publishedAt };
  });
}
