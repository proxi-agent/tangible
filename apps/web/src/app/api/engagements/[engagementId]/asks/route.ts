import { CreateAskRequestSchema } from '@tangible/types';
import { createFindingAsk, engagementAsks } from '@/lib/asks';
import { handle } from '@/lib/route';
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
    const body = CreateAskRequestSchema.parse(await request.json());
    await fetchEngagement(engagementId);
    return await createFindingAsk(engagementId, body);
  });
}
