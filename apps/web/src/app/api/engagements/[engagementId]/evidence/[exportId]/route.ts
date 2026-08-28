import { removeEvidence } from '@/lib/evidence';
import { handle } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Remove an export and everything it was proving.
 *
 * A real delete rather than a status flip. An evidence export holds a copy of
 * another system's records, and a firm that has been asked to remove a client's
 * maintenance data has been asked to remove it — a soft-deleted row that still
 * carries 14,000 records would be the wrong answer to that request. The
 * findings it moved are recomputed on the next run, from the sources that are
 * actually there.
 */
export function DELETE(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string; exportId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId, exportId } = await params;
    await fetchEngagement(engagementId);
    return removeEvidence(exportId);
  });
}
