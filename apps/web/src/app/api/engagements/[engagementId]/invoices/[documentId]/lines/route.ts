import { z } from 'zod';
import { AssessabilityTreatmentSchema } from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { correctInvoiceLine, loadInvoiceDetail } from '@/lib/invoices';
import { handle } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CorrectionSchema = z.object({
  lineId: z.string().uuid(),
  treatment: AssessabilityTreatmentSchema,
  reason: z.string().trim().min(1).max(500).nullable().default(null),
});

/**
 * A preparer overruling the rule table on one line.
 *
 * The answer is the whole document rather than the line, because changing one
 * line changes the split, the document's own confidence, and whether it is
 * still trusted — and a screen that redrew only the row it edited would show a
 * total that no longer follows from the lines above it.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ engagementId: string; documentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId, documentId } = await params;
    await fetchEngagement(engagementId);
    const detail = await loadInvoiceDetail(engagementId, documentId);

    const body = CorrectionSchema.parse(await request.json());
    // The line has to be on *this* document. Without it a line id from another
    // engagement's invoice would be editable through this address.
    if (!detail.lines.some((line) => line.id === body.lineId)) {
      return loadInvoiceDetail(engagementId, documentId);
    }

    await correctInvoiceLine(body.lineId, {
      treatment: body.treatment,
      reason: body.reason,
      by: await currentActor(),
    });
    return loadInvoiceDetail(engagementId, documentId);
  });
}
