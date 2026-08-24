import { draftPlan, latestUnblockPlan } from '@/lib/unblock';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The newest drafted unblock plan, or `{ plan: null }`. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    return { plan: await latestUnblockPlan(engagementId) };
  });
}

/**
 * Draft a plan from the season as it stands now.
 *
 * A new row every time, never an edit — clearing a blocker and redrafting is
 * the normal loop, and the older plan stays readable as what was blocked then.
 */
export function POST(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    return { plan: await draftPlan(engagementId) };
  });
}
