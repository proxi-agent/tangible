import { UpdatePortalAccessSchema, type PortalUser } from '@tangible/types';
import { handle } from '@/lib/route';
import { revokePortalAccess, updatePortalAccess } from '@/lib/portal-users';
import { requireFirm } from '@/lib/viewer';
import { fetchClient } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ clientId: string; grantId: string }> };

export function PATCH(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<PortalUser> => {
    const { clientId, grantId } = await params;
    await requireFirm();
    const client = await fetchClient(clientId);
    const body = UpdatePortalAccessSchema.parse(await request.json());
    return updatePortalAccess(clientId, grantId, body.role, client.name);
  });
}

export function DELETE(_request: Request, { params }: Params): Promise<Response> {
  return handle(async () => {
    const { clientId, grantId } = await params;
    await requireFirm();
    await fetchClient(clientId);
    await revokePortalAccess(clientId, grantId);
    return { ok: true } as const;
  });
}
