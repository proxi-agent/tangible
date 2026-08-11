import { getMarketOverview } from '@tangible/analytics';
import { handle, params } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Every segment's headline numbers for one jurisdiction/year. */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const { jurisdictionId, taxYear } = params(request);
    return getMarketOverview(await getWarehouse(), String(jurisdictionId), Number(taxYear));
  });
}
