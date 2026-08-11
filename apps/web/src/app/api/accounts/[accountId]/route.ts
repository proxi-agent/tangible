import { getAccount } from '@tangible/analytics';
import { handle, notFound, params } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(
  request: Request,
  { params: routeParams }: { params: Promise<{ accountId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { accountId } = await routeParams;
    const { jurisdictionId, taxYear } = params(request);
    const account = await getAccount(
      await getWarehouse(),
      String(jurisdictionId),
      Number(taxYear),
      accountId,
    );
    return account ?? notFound(`Unknown account: ${accountId}`);
  });
}
