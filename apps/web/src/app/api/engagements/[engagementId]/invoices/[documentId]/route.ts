import { z } from 'zod';
import { currentActor } from '@/lib/actor';
import { acceptInvoice, loadInvoiceDetail, runInvoiceExtraction } from '@/lib/invoices';
import { HttpError, handle } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** One invoice: every line the model read, and what it has been linked to. */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string; documentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId, documentId } = await params;
    await fetchEngagement(engagementId);
    return loadInvoiceDetail(engagementId, documentId);
  });
}

const ActionSchema = z.object({ action: z.enum(['accept', 'reread']) });

/**
 * Two verbs, and the difference between them is who is standing behind the
 * reading.
 *
 * `reread` runs the model again — for a document that failed, or one uploaded
 * before a key was configured. `accept` is a person saying they have read the
 * invoice themselves, which is what lets its split be trusted without the
 * unreviewed discount the engine otherwise applies.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string; documentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId, documentId } = await params;
    const { engagement, client } = await fetchEngagement(engagementId);
    // Confirms the document belongs to this engagement before anything is
    // written against it — the id alone does not say whose invoice it is.
    await loadInvoiceDetail(engagementId, documentId);

    const body = ActionSchema.parse(await request.json().catch(() => ({})));
    const actor = await currentActor();

    if (body.action === 'accept') {
      const document = await acceptInvoice(documentId, actor);
      if (document.status !== 'accepted') {
        throw new HttpError(500, 'That invoice could not be marked as reviewed.');
      }
      return loadInvoiceDetail(engagementId, documentId);
    }

    await runInvoiceExtraction(documentId, {
      clientName: client.name,
      jurisdictionId: engagement.jurisdictionId,
    });
    return loadInvoiceDetail(engagementId, documentId);
  });
}
