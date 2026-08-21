import { AnswerExtensionRequestSchema } from '@tangible/types';
import { answerExtension } from '@/lib/extensions';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What the district said, or a row taken back.
 *
 * PATCH rather than DELETE for the same reason a filing is voided rather than
 * deleted: "the chief appraiser refused this", "we never sent it" and "no
 * answer yet" are three different facts, and only the row can tell them apart.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ extensionId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { extensionId } = await params;
    const parsed = AnswerExtensionRequestSchema.parse(await request.json());
    return answerExtension(extensionId, parsed);
  });
}
