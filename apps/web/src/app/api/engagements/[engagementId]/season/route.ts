import type { FilingSeason } from '@tangible/types';
import { handle } from '@/lib/route';
import { filingSeason } from '@/lib/season';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Every return this engagement owes and where each one stands.
 *
 * Separate from `/returns`, which is the cheap query behind the draft's picker
 * — labels and counts, nothing built. This one builds a rendition per site to
 * answer whether each could actually be filed today, so it is the expensive
 * read and belongs on its own request rather than inside the engagement's.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<FilingSeason> => {
    const { engagementId } = await params;
    return filingSeason(engagementId);
  });
}
