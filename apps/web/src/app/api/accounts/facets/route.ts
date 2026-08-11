import { getFilterFacets } from '@tangible/analytics';
import { handle, params } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Distinct cities/classes/value range present in the data, for the filter UI. */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const { jurisdictionId, taxYear } = params(request);
    return getFilterFacets(await getWarehouse(), String(jurisdictionId), Number(taxYear));
  });
}
