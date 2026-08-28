import { CreateAskRequestSchema } from '@tangible/types';
import { createFindingAsk, engagementAsks } from '@/lib/asks';
import { fireAndLog, notifyQuestionsWaiting } from '@/lib/notify';
import { handle } from '@/lib/route';
import { requireEngagementScope, requirePortalRole } from '@/lib/viewer';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Everything being asked of this client, in one list.
 *
 * Both kinds of ask answer to the same person, so they answer at the same
 * place: the questions a register could not settle at import, and the ones a
 * screening finding turns on.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    await fetchEngagement(engagementId);
    return { items: await engagementAsks(engagementId) };
  });
}

/**
 * Put a screening finding's question on the record.
 *
 * A screening finding is unpriced because one fact is missing and only the
 * taxpayer has it. Until now the report could name that fact and nothing more:
 * there was nowhere to put the answer, so the largest positions on the page
 * were the ones nobody could move. This is the other half of that loop.
 *
 * Idempotent on the finding key — see `createFindingAsk`.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    await requirePortalRole('admin');
    const body = CreateAskRequestSchema.parse(await request.json());
    await fetchEngagement(engagementId);
    const ask = await createFindingAsk(engagementId, body);

    /**
     * Told, not left to be discovered. A question that only exists on a screen
     * the client has no reason to open is a question that goes unanswered, and
     * a screening finding stays unpriced for want of one fact.
     *
     * Detached and rate-limited inside `notifyQuestionsWaiting`: raising ten
     * asks in a row is one message, and a mail failure is not a reason to lose
     * the ask that was just recorded.
     */
    fireAndLog(notifyQuestionsWaiting(engagementId), 'question-waiting');
    return ask;
  });
}
