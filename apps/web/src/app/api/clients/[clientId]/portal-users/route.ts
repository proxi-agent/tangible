import { GrantPortalAccessSchema, type PortalUser } from '@tangible/types';
import { handle } from '@/lib/route';
import { grantPortalAccess, listPortalUsers } from '@/lib/portal-users';
import { requireFirm } from '@/lib/viewer';
import { fetchClient } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ clientId: string }> };

/**
 * Who may sign in to this business's portal.
 *
 * Firm-only in both directions. A client reading its own access list is a
 * reasonable feature and not this one — it would need its own rules about who
 * can revoke whom, and the answer today is that the firm holds the grants.
 */
export function GET(_request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<PortalUser[]> => {
    const { clientId } = await params;
    await requireFirm();
    const client = await fetchClient(clientId);
    return listPortalUsers(clientId, client.name);
  });
}

export function POST(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<PortalUser> => {
    const { clientId } = await params;
    const viewer = await requireFirm();
    const client = await fetchClient(clientId);
    const body = GrantPortalAccessSchema.parse(await request.json());
    return grantPortalAccess(clientId, client.name, body, viewer.email);
  });
}
