import { after } from 'next/server';
import { ConfirmMappingRequestSchema, type NormalizationResult } from '@tangible/types';
import { confirmMapping } from '@/lib/mapping';
import { handle } from '@/lib/route';
import { executeRun } from '@/lib/runs';
import { fetchFarFile } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Five minutes, not one.
 *
 * This handler re-parses the whole workbook, applies the mapping row by row,
 * and diffs the result against every asset the client's graph already holds —
 * work that scales with the register rather than with the request. A 4,065-row
 * register took 52 seconds on the rehearsal, which is inside a sixty-second
 * ceiling only by accident: the next register that is larger, or the same one
 * on a colder instance, times out *after* the assets have been written and
 * leaves the caller staring at a failure that actually succeeded.
 */
export const maxDuration = 300;

/**
 * A person confirms a mapping.
 *
 * The application of it is {@link confirmMapping}, shared with the autopilot;
 * what belongs to this entrance is the actor — the mapping is recorded as
 * settled by whoever uploaded the file — and the decision to run the report
 * after the response rather than making the mapping screen wait on it.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  return handle(async (): Promise<NormalizationResult> => {
    const { fileId } = await params;
    const { mapping } = ConfirmMappingRequestSchema.parse(await request.json());
    const file = await fetchFarFile(fileId);

    const { normalization, run } = await confirmMapping({
      file,
      mapping,
      actor: file.uploadedBy,
    });

    if (run && run.status === 'queued') after(() => executeRun(run.id));

    return normalization;
  });
}
