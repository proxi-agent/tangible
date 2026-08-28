import type { ClientRecoveryStatement } from '@tangible/types';
import { clientRecovery } from '@/lib/recovery';
import { handle } from '@/lib/route';
import { requireEngagementScope } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What came back, for the business it came back to.
 *
 * A separate path from `/recovery` rather than a shape flag on it, because the
 * client wing is allowed in by path and the allowlist cannot see methods. One
 * route that both read and recorded settlements would hand a client the write
 * as well, and the friction of a second file is the price of that not being
 * possible by accident.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<ClientRecoveryStatement> => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    return clientRecovery(engagementId);
  });
}
