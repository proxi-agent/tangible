import { RecordMotionRequestSchema } from '@tangible/types';
import { recordMotion } from '@/lib/motions';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Record a motion under 25.25 that has gone in.
 *
 * Posted to the engagement the work was done under, and carrying the year it is
 * about — which is almost never the engagement's own year. That separation is
 * the point of the table: a 2027 engagement filing a (c) motion on 2022 is the
 * ordinary case, not the exception.
 *
 * There is no GET here. A motion is read as part of the year it belongs to, on
 * the open-years board, because a motion on its own does not answer anything —
 * what it is worth is what it left of 25.25 for that year.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const parsed = RecordMotionRequestSchema.parse(await request.json());
    return recordMotion(engagementId, parsed);
  });
}
