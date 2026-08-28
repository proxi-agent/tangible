import { DraftScheduleRequestSchema } from '@tangible/types';
import { draftScheduleForReview } from '@/lib/rule-drafts';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Draft a district's depreciation schedule from its published guide.
 *
 * Firm-only, and deliberately absent from the client wing's allowlist: this
 * writes nothing, but it decides what a whole county's clients get assessed
 * once somebody commits the output, and it is not a thing a client should be
 * able to run against our AI budget either.
 */
export function POST(request: Request): Promise<Response> {
  return handle(async () =>
    draftScheduleForReview(DraftScheduleRequestSchema.parse(await request.json())),
  );
}
