import { VoidClaimRequestSchema } from '@tangible/types';
import { voidClaim } from '@/lib/recovery';
import { handle } from '@/lib/route';
import { requireFirm } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Take back a claim that should never have been recorded.
 *
 * A POST rather than a DELETE, and the path says `void` rather than naming the
 * claim alone, because nothing is removed. A claim is the prediction as it
 * stood when a position went to a district; deleting one would let a firm
 * quietly improve its own record after the answer came back, which is the exact
 * thing this table exists to make impossible. Voiding leaves the row, the
 * reason and the person on it, and takes it out of every total and out of the
 * training set.
 *
 * Firm-only, and it is not in the portal allowlist. The claim record is where
 * the firm's own predictions are scored, and a business editing what was
 * claimed on its behalf is not a workflow anybody asked for.
 *
 * The reason is required by the schema. It is the only thing that distinguishes
 * "recorded against the wrong account" from "this one did not go our way".
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ claimId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { claimId } = await params;
    await requireFirm();
    const parsed = VoidClaimRequestSchema.parse(await request.json());
    await voidClaim(claimId, parsed);
    return { ok: true };
  });
}
