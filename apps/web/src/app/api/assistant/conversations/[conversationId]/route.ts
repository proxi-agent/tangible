import type { AssistantConversationDetail } from '@tangible/types';
import { deleteConversation, getConversation } from '@/lib/assistant/store';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** One thread with every turn under it, oldest first — the transcript. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  return handle(async (): Promise<AssistantConversationDetail> => {
    const { conversationId } = await params;
    return getConversation(conversationId);
  });
}

/**
 * Delete a thread and its turns.
 *
 * The one destructive operation the assistant has, and it is about the
 * assistant's own record rather than the workspace's: a turn can hold register
 * figures that Tax Code 22.27 makes confidential, so a preparer has to be able
 * to remove one without asking anybody.
 */
export function DELETE(
  _request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  return handle(async (): Promise<{ deleted: true }> => {
    const { conversationId } = await params;
    await deleteConversation(conversationId);
    return { deleted: true };
  });
}
