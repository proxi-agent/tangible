import { eq } from 'drizzle-orm';
import { UpdateAskRequestSchema } from '@tangible/types';
import { askDto } from '@/lib/asks';
import { handle, notFound } from '@/lib/route';
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
    return askDto(updated);
  });
}
