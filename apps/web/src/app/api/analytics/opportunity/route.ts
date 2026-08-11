import { getOpportunityModel } from '@tangible/analytics';
import { OpportunityModelInputSchema } from '@tangible/types';
import { handle, params } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Sizes a segment as a subscription business under stated assumptions. */
export function GET(request: Request): Promise<Response> {
  return handle(async () =>
    getOpportunityModel(await getWarehouse(), OpportunityModelInputSchema.parse(params(request))),
  );
}
