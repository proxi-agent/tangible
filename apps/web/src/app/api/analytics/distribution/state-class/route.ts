import { getStateClassDistribution } from '@tangible/analytics';
import { handle, params } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const { jurisdictionId, taxYear } = params(request);
    return getStateClassDistribution(await getWarehouse(), String(jurisdictionId), Number(taxYear));
  });
}
