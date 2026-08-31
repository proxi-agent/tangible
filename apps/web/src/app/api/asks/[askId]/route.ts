import { eq } from 'drizzle-orm';
import { UpdateAskRequestSchema } from '@tangible/types';
import { askDto } from '@/lib/asks';
import { fireAndLog, notifyAnswerReceived } from '@/lib/notify';
import { unscoped } from '@/lib/db-scope';
import { handle, notFound } from '@/lib/route';
import { requireAskScope, requirePortalRole } from '@/lib/viewer';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Record what came back from the client, or that nobody needs to ask.
 *
 * All three statuses are reachable from all three: an answer can be corrected,
 * a dismissal reconsidered, an answer withdrawn back to open. The one rule is
 * in the schema — 'answered' without an answer is not a state.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ askId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { askId } = await params;
    // The answer to "is any of this held outside Texas?" ends up on a signed
    // rendition, so the two checks are separate questions: whose ask is this,
    // and may this person answer one at all.
    await requireAskScope(askId);
    await requirePortalRole('admin');
    const body = UpdateAskRequestSchema.parse(await request.json());
    const db = requireDb();
    const [updated] = await db
      .update(schema.mappingAsks)
      .set({
        status: body.status,
        answer: body.status === 'answered' ? body.answer : null,
        answeredAt: body.status === 'answered' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.mappingAsks.id, askId))
      .returning();
    if (!updated) return notFound(`Unknown ask: ${askId}`);

    // The one message that goes to us rather than to them. An answer is what
    // unblocks a screening finding, and nobody on our side watches this table.
    if (updated.status === 'answered') {
      // Detached, so it outlives the request's scoped transaction — and it
      // is addressed to the firm, whose own notification row a client
      // connection could not write even if the timing worked.
      fireAndLog(
        unscoped(() => notifyAnswerReceived(updated.id)),
        'answer-received',
      );
    }
    return askDto(updated);
  });
}
