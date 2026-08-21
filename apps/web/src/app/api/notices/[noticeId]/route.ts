import { UpdateNoticeRequestSchema } from '@tangible/types';
import { updateNotice } from '@/lib/notices';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Write down that a protest went in, or take back a notice recorded in error.
 *
 * Those are the only two things about a notice that are ours to say. Everything
 * else on the row is the district's own statement, and a correction to it
 * arrives as a corrected notice — a new row that supersedes this one.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ noticeId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { noticeId } = await params;
    const parsed = UpdateNoticeRequestSchema.parse(await request.json());
    return updateNotice(noticeId, parsed);
  });
}
