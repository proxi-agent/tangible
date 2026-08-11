import { listAccounts } from '@tangible/analytics';
import { handle, params, parseAccountQuery } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(request: Request): Promise<Response> {
  return handle(async () => listAccounts(await getWarehouse(), parseAccountQuery(params(request))));
}
