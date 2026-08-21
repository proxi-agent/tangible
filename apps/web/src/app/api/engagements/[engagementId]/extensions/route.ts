import { RecordExtensionRequestSchema, type RenditionExtension } from '@tangible/types';
import { engagementExtensions, recordExtension } from '@/lib/extensions';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Every extension requested on this engagement, newest request first. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<RenditionExtension[]> => {
    const { engagementId } = await params;
    return engagementExtensions(engagementId);
  });
}

/**
 * Record that an extension request went out.
 *
 * The date a standard request buys is not accepted from the caller — it is
 * May 15 observed, off the same statutory calendar every other deadline on the
 * engagement comes from. Only an additional request names its own date, because
 * that day is the district's answer rather than a calculation.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const parsed = RecordExtensionRequestSchema.parse(await request.json());
    return recordExtension(engagementId, parsed);
  });
}
