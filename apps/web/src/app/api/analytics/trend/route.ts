import { getYearTrend } from '@tangible/analytics';
import { handle, params } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Year-over-year shape of the roll — this is where the HB 9 cliff shows up. */
export function GET(request: Request): Promise<Response> {
  return handle(async () =>
    getYearTrend(await getWarehouse(), String(params(request).jurisdictionId)),
  );
}
