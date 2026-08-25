import { AskGraphRequestSchema } from '@tangible/types';
import { askGraph, listGraphAsks } from '@/lib/ask-graph';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Everything asked of this engagement's record, newest first. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    return { asks: await listGraphAsks(engagementId) };
  });
}

/**
 * Ask the record a question.
 *
 * The digest is reassembled per question and frozen on the row beside the
 * answer, so an exchange stays readable as what the record said that day —
 * ask again after the register moves and you get a new row, not an edit.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const { question } = AskGraphRequestSchema.parse(await request.json());
    return { ask: await askGraph(engagementId, question) };
  });
}
