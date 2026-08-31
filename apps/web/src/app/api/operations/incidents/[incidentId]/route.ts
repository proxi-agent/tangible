import { ResolveIncidentSchema } from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { resolveIncident } from '@/lib/incidents';
import { operationsView } from '@/lib/operations';
import { handle } from '@/lib/route';
import { requireFirm } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Close a fault, with the sentence that says why.
 *
 * Firm-only and not the client's business: an incident names the software that
 * failed them, which is ours to fix and not theirs to triage.
 */
export async function POST(request: Request, context: { params: Promise<{ incidentId: string }> }) {
  return handle(async () => {
    await requireFirm();
    const { incidentId } = await context.params;
    const { resolution } = ResolveIncidentSchema.parse(await request.json());
    await resolveIncident(incidentId, resolution, await currentActor());
    return operationsView();
  });
}
