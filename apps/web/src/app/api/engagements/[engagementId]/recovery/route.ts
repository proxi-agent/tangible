import { RecordSettlementRequestSchema } from '@tangible/types';
import { engagementRecovery, recordSettlement } from '@/lib/recovery';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What was claimed on this engagement, and what came back.
 *
 * Claims are not posted here. They are written when a position actually goes to
 * a district — a return recorded as filed, a motion recorded as filed — because
 * a claim that could be created by hand is a claim that can be created after
 * the fact, and the whole value of the table is that the prediction was written
 * down before the answer was known.
 *
 * What is posted here is the answer: either what the district allowed on each
 * position, or the single figure it agreed to take off the account.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    return engagementRecovery(engagementId);
  });
}

export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const parsed = RecordSettlementRequestSchema.parse(await request.json());
    return recordSettlement(engagementId, parsed);
  });
}
