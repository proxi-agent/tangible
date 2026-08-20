import { CommitFindingsRequestSchema, type FindingSet, type FindingSetSummary } from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { commitFindings, listFindingSets } from '@/lib/findings';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Every set committed on this engagement, newest first. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<{ items: FindingSetSummary[] }> => {
    const { engagementId } = await params;
    return { items: await listFindingSets(engagementId) };
  });
}

/**
 * Commit the current analysis as a dated set.
 *
 * A POST, and never a side effect of a GET, because that is the whole
 * distinction this table is built on: looking at the report is free and always
 * current, and saying "this is what we told them" is a deliberate act with a
 * name and a timestamp on it. The analysis is re-run here rather than accepted
 * from the browser — what gets stored has to be what the engines produced.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<FindingSet> => {
    const { engagementId } = await params;
    const body = CommitFindingsRequestSchema.parse(await request.json());
    return commitFindings(engagementId, body, await currentActor());
  });
}
