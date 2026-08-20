import { RecordFilingRequestSchema, type RenditionFiling } from '@tangible/types';
import { engagementFilings, recordFiling } from '@/lib/filings';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Every return recorded against this engagement, newest first. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<RenditionFiling[]> => {
    const { engagementId } = await params;
    return engagementFilings(engagementId);
  });
}

/**
 * Record that a return went out.
 *
 * The request says which return and how it was sent; it does not say what was
 * on it. The rendition is rebuilt here from the engagement and frozen, so what
 * lands in the record is what this app would have produced and not what a
 * caller claimed.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const parsed = RecordFilingRequestSchema.parse(await request.json());
    return recordFiling(engagementId, parsed);
  });
}
