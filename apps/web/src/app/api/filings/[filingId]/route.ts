import { VoidFilingRequestSchema, type RenditionFilingRecord } from '@tangible/types';
import { filingRecord, voidFiling } from '@/lib/filings';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One filing, with the frozen rendition it froze. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ filingId: string }> },
): Promise<Response> {
  return handle(async (): Promise<RenditionFilingRecord> => {
    const { filingId } = await params;
    return filingRecord(filingId);
  });
}

/**
 * Void a filing recorded in error.
 *
 * PATCH rather than DELETE, and that is the whole design: the row stays, marked
 * void with a reason, because "recorded and then withdrawn" and "never
 * recorded" are different facts about an engagement.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ filingId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { filingId } = await params;
    const { reason } = VoidFilingRequestSchema.parse(await request.json());
    return voidFiling(filingId, reason);
  });
}
