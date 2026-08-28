import { z } from 'zod';
import { currentActor } from '@/lib/actor';
import { loadInvoiceDetail, removeInvoiceLink, setInvoiceLink } from '@/lib/invoices';
import { HttpError, handle } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LinkSchema = z.object({
  assetId: z.string().uuid(),
  status: z.enum(['suggested', 'confirmed']).default('confirmed'),
  /** How much of this invoice belongs to that asset. One invoice, one asset: 1. */
  share: z.number().min(0).max(1).optional(),
});

/**
 * Which register lines this invoice paid for.
 *
 * The matcher proposes and a person disposes: only a confirmed link reaches the
 * engine, because a misattributed invoice moves money from one asset to another
 * and produces a finding that looks exactly like a correct one. This route is
 * where that confirmation happens, and it is the reason the suggestion step is
 * allowed to be generous.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string; documentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId, documentId } = await params;
    await fetchEngagement(engagementId);
    await loadInvoiceDetail(engagementId, documentId);

    const body = LinkSchema.parse(await request.json());
    await setInvoiceLink(documentId, body.assetId, {
      status: body.status,
      share: body.share,
      linkedBy: await currentActor(),
    });
    return loadInvoiceDetail(engagementId, documentId);
  });
}

export function DELETE(
  request: Request,
  { params }: { params: Promise<{ engagementId: string; documentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId, documentId } = await params;
    await fetchEngagement(engagementId);
    await loadInvoiceDetail(engagementId, documentId);

    const assetId = new URL(request.url).searchParams.get('assetId');
    if (!assetId) throw new HttpError(400, 'Name the asset to unlink with ?assetId=.');
    await removeInvoiceLink(documentId, assetId);
    return loadInvoiceDetail(engagementId, documentId);
  });
}
