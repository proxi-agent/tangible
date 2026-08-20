import { UpdateLineMappingRequestSchema } from '@tangible/types';
import { handle } from '@/lib/route';
import { recordLineMapping, type LineMappingDecisionResult } from '@/lib/prior-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * A reviewer settles what one line of the filer's wording means — and, by
 * default, every other line on the return using those same words, plus every
 * return that ever uses them again.
 *
 * Schedule E is why the middle one matters: one wording spans a decade of
 * year-acquired rows, and asking about each year separately would be the same
 * question ten times.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ lineId: string }> },
): Promise<Response> {
  return handle(async (): Promise<LineMappingDecisionResult> => {
    const { lineId } = await params;
    const body = UpdateLineMappingRequestSchema.parse(await request.json());
    // Auth is off in this deployment, so there is no signed-in reviewer to
    // record — the same as the asset queue.
    return recordLineMapping(lineId, body, null);
  });
}
