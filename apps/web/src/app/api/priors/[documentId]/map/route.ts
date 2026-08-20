import type { LineMappingRunResult } from '@tangible/types';
import { handle, params as queryParams } from '@/lib/route';
import { runLineMapping } from '@/lib/prior-mapping';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** One model call per 60 distinct wordings, on a document that may be long. */
export const maxDuration = 300;

/**
 * Decide what this return's own wording means.
 *
 * Runs automatically after extraction; this is the retry, and the way to pick
 * up a mapping once memory has learned something the first run had to ask a
 * model about.
 *
 * `?remap=true` re-decides lines that already carry a machine reading.
 * Confirmed lines are never touched either way.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  return handle(async (): Promise<LineMappingRunResult> => {
    const { documentId } = await params;
    const remap = queryParams(request).remap === 'true';
    return runLineMapping(documentId, { remap });
  });
}
