import { DecideFindingRowsRequestSchema, type FindingRowPage } from '@tangible/types';
import { decideFindingRows, loadFindingRows, parseFilters } from '@/lib/finding-rows';
import { handle, HttpError } from '@/lib/route';
import { requireEngagementScope } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One finding's assets, filtered, with what has been decided about each.
 *
 * Reachable from the client wing, which is the point of it: the filtering and
 * the deciding are the client's work, not ours. `requireEngagementScope` is the
 * assertion that the engagement is theirs — the proxy has only checked that the
 * path is one a client may address at all.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<FindingRowPage> => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    const url = new URL(request.url);
    const findingKey = url.searchParams.get('finding');
    if (!findingKey) throw new HttpError(400, 'Which finding?');
    return loadFindingRows(engagementId, findingKey, parseFilters(url), {
      offset: Number(url.searchParams.get('offset') ?? 0) || 0,
      limit: Number(url.searchParams.get('limit') ?? 0) || undefined,
    });
  });
}

/**
 * Accept, reject, or ask about a batch of rows.
 *
 * The filter travels on the query string of the POST as well, so the page that
 * comes back describes the same view the decision was made in. Deciding twenty
 * rows and having the screen redraw around the whole population would be a
 * worse answer than no answer.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<FindingRowPage> => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    const body = DecideFindingRowsRequestSchema.parse(await request.json());
    return decideFindingRows(engagementId, body, parseFilters(new URL(request.url)));
  });
}
