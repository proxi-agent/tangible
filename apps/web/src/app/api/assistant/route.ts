import { AssistantAskRequestSchema, type AssistantAskResponse } from '@tangible/types';
import { runAssistantTurn } from '@/lib/assistant/runner';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * A research loop plus a composing call, over a warehouse that may have to page
 * in remote Parquet. The default sixty seconds is not enough for a question
 * that walks a whole book.
 */
export const maxDuration = 300;

/**
 * Ask the assistant.
 *
 * One request, one turn, one row. The conversation is created on the first ask
 * and named after it; every later ask in the same thread carries its id.
 */
export function POST(request: Request): Promise<Response> {
  return handle(async (): Promise<AssistantAskResponse> => {
    const body = AssistantAskRequestSchema.parse(await request.json());
    return runAssistantTurn(body);
  });
}
