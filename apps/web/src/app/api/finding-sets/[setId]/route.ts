import type { FindingSet } from '@tangible/types';
import { fetchFindingSet } from '@/lib/findings';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One committed set, with the report as it was produced and every finding's
 * current decision replayed onto it.
 *
 * The stored numbers are read back verbatim — this is a record of what was
 * said, so nothing here recomputes it. The one live figure is `isStale`, which
 * is the reader's warning that the workspace has moved on since.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ setId: string }> },
): Promise<Response> {
  return handle(async (): Promise<FindingSet> => {
    const { setId } = await params;
    return fetchFindingSet(setId);
  });
}
