import { draftBrief, latestBrief } from '@/lib/briefs';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The newest drafted brief for this notice, or `{ brief: null }`. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ noticeId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { noticeId } = await params;
    return { brief: await latestBrief(noticeId) };
  });
}

/**
 * Draft a brief from the record as it stands now.
 *
 * A new row every time, never an edit — redrafting after the record moved is
 * the point, and the older draft stays readable as what the record said then.
 */
export function POST(
  _request: Request,
  { params }: { params: Promise<{ noticeId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { noticeId } = await params;
    return { brief: await draftBrief(noticeId) };
  });
}
