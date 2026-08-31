import { IssueFeeStatementSchema, SaveFeeTermsSchema } from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { feeView, issueFeeStatement, saveFeeTerms } from '@/lib/fees';
import { handle } from '@/lib/route';
import { requireFirm } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The firm's own billing, and firm-only throughout.
 *
 * A client's portal shows what their return came to; what the firm charges for
 * producing it is a different conversation, and one that happens on paper the
 * firm chooses to send rather than on a page they can refresh.
 */
export function GET(_request: Request, context: { params: Promise<{ engagementId: string }> }) {
  return handle(async () => {
    await requireFirm();
    const { engagementId } = await context.params;
    return feeView(engagementId);
  });
}

/** Record or amend the terms. Editable until a statement freezes its own copy. */
export function PUT(request: Request, context: { params: Promise<{ engagementId: string }> }) {
  return handle(async () => {
    await requireFirm();
    const { engagementId } = await context.params;
    await saveFeeTerms(engagementId, SaveFeeTermsSchema.parse(await request.json()));
    return feeView(engagementId);
  });
}

/** Issue the bill. Refuses on any blocker rather than billing a moving year. */
export function POST(request: Request, context: { params: Promise<{ engagementId: string }> }) {
  return handle(async () => {
    await requireFirm();
    const { engagementId } = await context.params;
    const input = IssueFeeStatementSchema.parse(await request.json().catch(() => ({})));
    await issueFeeStatement(engagementId, input, await currentActor());
    return feeView(engagementId);
  });
}
