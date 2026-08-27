import type { AssistantConversation } from '@tangible/types';
import { listConversations } from '@/lib/assistant/store';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Threads, most recently active first. The sidebar's whole query. */
export function GET(): Promise<Response> {
  return handle(async (): Promise<{ conversations: AssistantConversation[] }> => ({
    conversations: await listConversations(),
  }));
}
