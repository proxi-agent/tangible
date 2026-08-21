import { RecordNoticeRequestSchema, type AssessmentNotice } from '@tangible/types';
import { engagementNotices, recordNotice } from '@/lib/notices';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Every notice of appraised value recorded on this engagement, newest first. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<AssessmentNotice[]> => {
    const { engagementId } = await params;
    return engagementNotices(engagementId);
  });
}

/**
 * Record a notice that arrived.
 *
 * Only the date on the notice is required. The clocks it starts come off that
 * date and the statute, and the checks against what we filed come off the
 * filing already on record — so a notice typed in from the envelope on the day
 * it lands is a complete row, which is the one worth having.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const parsed = RecordNoticeRequestSchema.parse(await request.json());
    return recordNotice(engagementId, parsed);
  });
}
