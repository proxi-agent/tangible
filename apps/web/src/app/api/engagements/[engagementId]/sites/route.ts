import { PlaceSiteRequestSchema, type EngagementSite } from '@tangible/types';
import { handle } from '@/lib/route';
import { engagementSites, placeSite } from '@/lib/sites';
import { requireEngagementScope, requireFirm } from '@/lib/viewer';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ engagementId: string }> };

export function GET(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<EngagementSite[]> => {
    const { engagementId } = await params;
    await requireEngagementScope(engagementId);
    await fetchEngagement(engagementId);
    return engagementSites(engagementId);
  });
}

/**
 * Place a whole location group, and hand back the sites as they now stand.
 *
 * Returning the recomputed list rather than a bare count because one placement
 * changes how the others read: the moment a second site is resolved, this
 * engagement is two returns rather than one, and the screen needs to say so
 * without a second round trip.
 */
export function POST(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<{ placed: number; sites: EngagementSite[] }> => {
    const { engagementId } = await params;
    // Reading which locations a register resolved to is something a client is
    // shown; deciding where a location sits is a situs call, and situs is what
    // decides which district assesses the property.
    await requireFirm();
    await fetchEngagement(engagementId);
    const body = PlaceSiteRequestSchema.parse(await request.json());
    const placed = await placeSite(engagementId, body.text, body.locationId);
    return { placed, sites: await engagementSites(engagementId) };
  });
}
