import { DraftMotionRequestSchema } from '@tangible/types';
import { draftMotion, latestMotionDraft } from '@/lib/motion-drafts';
import { handle, HttpError } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** The newest drafted motion for one open year, or `{ draft: null }`. */
export function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const key = new URL(request.url).searchParams.get('key');
    if (!key) throw new HttpError(400, 'Pass the open-years key as ?key=.');
    return { draft: await latestMotionDraft(engagementId, key) };
  });
}

/**
 * Draft a motion for one open year, from the outlook as it stands now plus
 * the two facts only the firm can assert: the claimed correct value and the
 * ground of the error. A new row every time, never an edit — the person
 * signs and files it, then records the filing through the motions step.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const parsed = DraftMotionRequestSchema.parse(await request.json());
    return { draft: await draftMotion(engagementId, parsed) };
  });
}
