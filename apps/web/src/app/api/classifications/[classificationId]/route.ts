import {
  UpdateClassificationRequestSchema,
  type ClassificationDecisionResult,
} from '@tangible/types';
import { handle } from '@/lib/route';
import { recordDecision } from '@/lib/classification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * A reviewer settles one asset — and, by default, every other asset in the
 * engagement with the same description, plus every future engagement that ever
 * sees those words again.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ classificationId: string }> },
): Promise<Response> {
  return handle(async (): Promise<ClassificationDecisionResult> => {
    const { classificationId } = await params;
    const body = UpdateClassificationRequestSchema.parse(await request.json());
    // Auth is off in this deployment, so there is no signed-in reviewer to
    // record. When the gate is turned back on this reads the session instead;
    // attributing a decision to nobody is better than attributing it wrongly.
    return recordDecision(classificationId, body, null);
  });
}
