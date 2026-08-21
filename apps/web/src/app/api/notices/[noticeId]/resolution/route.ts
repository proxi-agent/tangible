import { RecordResolutionRequestSchema } from '@tangible/types';
import { recordResolution } from '@/lib/notices';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Write down how the protest on this notice ended.
 *
 * Under the notice rather than under the engagement because a resolution is an
 * answer to one particular piece of mail. Where a corrected notice superseded
 * an earlier one, the ending belongs to the notice that was actually argued.
 *
 * Returns the notice rather than the resolution: what the resolution is worth
 * depends on what the notice said — the reduction, whether 22.28's penalty
 * survived it — so the row on its own is not a complete answer to anything.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ noticeId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { noticeId } = await params;
    const parsed = RecordResolutionRequestSchema.parse(await request.json());
    return recordResolution(noticeId, parsed);
  });
}
