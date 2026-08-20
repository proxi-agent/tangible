import {
  UpdateFindingDispositionRequestSchema,
  type FindingDecisionResult,
} from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { decideFinding } from '@/lib/findings';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Accept, reject or park a finding — or clear the decision entirely by sending
 * a null status, which deletes the record rather than storing "undecided".
 *
 * The decision is recorded against the engagement and the finding's key, not
 * against this row, so it survives the next commit. The set comes back with it
 * because the decided count on the header moves with every one of these.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ findingId: string }> },
): Promise<Response> {
  return handle(async (): Promise<FindingDecisionResult> => {
    const { findingId } = await params;
    const body = UpdateFindingDispositionRequestSchema.parse(await request.json());
    return decideFinding(findingId, body, await currentActor());
  });
}
