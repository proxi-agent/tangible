import { after } from 'next/server';
import { RequestRunSchema } from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { handle } from '@/lib/route';
import { executeRun, listRuns, requestRun } from '@/lib/runs';
import { requireEngagementScope, requirePortalRole } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * The ceiling on the work started by `after()`, not on the response. The
 * response goes out as soon as the row is queued; this is how long the analysis
 * that follows it is allowed to take before the platform tears the invocation
 * down — at which point the run is left `running` and the reaper requeues it.
 */
export const maxDuration = 300;

/** Every run this season has had, newest first. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    return listRuns(engagementId);
  });
}

/**
 * Ask for a report, and get the queued row back immediately.
 *
 * The analysis itself runs in `after()`: the response is already sent, so a
 * register that takes four minutes to price is not four minutes of a browser
 * holding a connection open, and a client that closes the tab still gets their
 * report. What the caller receives is the run — a row they can poll, which is
 * the whole reason it is a row.
 *
 * This is not a queue service, and does not pretend to be. The guarantee it
 * gives is the reaper's: a run whose invocation dies is picked up again by
 * `/api/runs/drain`, bounded by attempts. Moving to a real worker later changes
 * only what calls `executeRun`.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    // Pricing a register is not a read. A viewer forwarded the report by a
    // colleague should not be able to make a new one of it.
    await requirePortalRole('admin');

    const body = RequestRunSchema.parse(await request.json().catch(() => ({})));
    const run = await requestRun(engagementId, body.trigger, await currentActor());

    // Only the run this request created. An already-open row is being worked by
    // whoever queued it, and claiming is conditional anyway — this just avoids
    // a pointless second attempt.
    if (run.status === 'queued') after(() => executeRun(run.id));

    return run;
  });
}
