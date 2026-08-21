import { UpdateMotionRequestSchema, VoidMotionRequestSchema } from '@tangible/types';
import { updateMotion, voidMotion } from '@/lib/motions';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Record what has happened to a motion: a hearing date, a payment, an ending.
 *
 * A POST rather than a PATCH because nothing is patched. Each of these inserts
 * a new row carrying the whole motion and supersedes the one before it, so what
 * the firm believed about a live motion in March survives being wrong in June.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ motionId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { motionId } = await params;
    const parsed = UpdateMotionRequestSchema.parse(await request.json());
    return updateMotion(motionId, parsed);
  });
}

/**
 * Take back a motion recorded in error.
 *
 * Worth more here than on most tables. A recorded motion with an ending closes
 * 25.25(c-1) for the property and year under (c-1)(3), so a motion typed
 * against the wrong year does not just sit there — it takes a live route off a
 * year that still has one. Voiding is how that is undone.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ motionId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { motionId } = await params;
    const parsed = VoidMotionRequestSchema.parse(await request.json());
    return voidMotion(motionId, parsed);
  });
}
