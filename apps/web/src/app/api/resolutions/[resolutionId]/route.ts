import { VoidResolutionRequestSchema } from '@tangible/types';
import { voidResolution } from '@/lib/notices';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Take back a resolution recorded in error.
 *
 * The only thing that can be done to one after the fact. A correction is a
 * second POST to the notice, which supersedes this row rather than editing it —
 * the figure a client was already told stays recoverable either way.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ resolutionId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { resolutionId } = await params;
    const parsed = VoidResolutionRequestSchema.parse(await request.json());
    return voidResolution(resolutionId, parsed);
  });
}
