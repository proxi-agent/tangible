import { RenditionRequestSchema, type Rendition } from '@tangible/types';
import { buildEngagementRendition } from '@/lib/rendition';
import { handle, params as queryParams } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Form 50-144 as the engagement currently stands.
 *
 * Derived on read like the savings report, and for a sharper reason: this is a
 * sworn document. It must reflect the classifications as they are at the moment
 * someone looks at it, never a snapshot taken before the last three review
 * decisions landed. When a filing is actually submitted, *that* gets frozen and
 * stored — but the working draft stays live.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<Rendition> => {
    const { engagementId } = await params;
    const raw = queryParams(request);
    const { basis, filedByAgent } = RenditionRequestSchema.parse({
      basis: raw.basis ?? 'cost',
      // `z.coerce.boolean()` treats any non-empty string as true, so map it.
      filedByAgent: raw.filedByAgent === undefined ? true : raw.filedByAgent === 'true',
    });
    // Which return, where the engagement owes more than one. Absent means "the
    // only one", and the builder blocks rather than guessing when there isn't.
    return buildEngagementRendition(engagementId, {
      basis,
      filedByAgent,
      locationId: raw.location ?? null,
    });
  });
}
