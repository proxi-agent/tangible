import type { ClientFilingStatement } from '@tangible/types';
import { clientFilingStatement } from '@/lib/portal-returns';
import { handle } from '@/lib/route';
import { requireEngagementScope } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Where a business's returns stand, for the business.
 *
 * A path of its own rather than a flag on `/season`, for the same reason
 * `/recovery/statement` is not a flag on `/recovery`: the client wing is
 * admitted by path and the allowlist cannot see what a handler would have done
 * with a query string. One route serving both audiences would be one forgotten
 * branch away from handing a client the firm's blocker list.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<ClientFilingStatement> => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    return clientFilingStatement(engagementId);
  });
}
