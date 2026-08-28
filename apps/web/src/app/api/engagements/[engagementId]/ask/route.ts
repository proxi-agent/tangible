import { AskGraphRequestSchema } from '@tangible/types';
import { askGraph, listGraphAsks } from '@/lib/ask-graph';
import { handle } from '@/lib/route';
import { requireEngagementScope, requirePortalRole } from '@/lib/viewer';

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
    await requireEngagementScope(engagementId);
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
    await requireEngagementScope(engagementId);
    // The digest this answers from is the whole engagement record. A read-only
    // viewer can read the report; they do not get a model pointed at the file.
    await requirePortalRole('admin');
    const { question } = AskGraphRequestSchema.parse(await request.json());
    return { ask: await askGraph(engagementId, question) };
  });
}
