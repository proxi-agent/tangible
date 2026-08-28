import { FAR_UPLOAD_MAX_BYTES } from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { ingestInvoice, invoiceMediaTypeFor, loadInvoices } from '@/lib/invoices';
import { HttpError, handle } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Reading a multi-page invoice with a vision model is the slowest thing in the
// product. Same ceiling as the rendition pipeline, for the same reason.
export const maxDuration = 300;

/**
 * The invoices behind the register, and what has been read out of them.
 *
 * A firm-side route only. Decomposing a capitalized amount is a position taken
 * on a taxpayer's behalf, and the intermediate state — a line the rules did not
 * recognize, a link nobody has confirmed — is working paper rather than
 * something a client should be reading as a finding.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);
    return loadInvoices(engagementId);
  });
}

export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    const { engagement, client } = await fetchEngagement(engagementId);

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new HttpError(400, "Send the invoice as multipart form-data under the 'file' field.");
    }
    if (file.size === 0) throw new HttpError(400, 'The uploaded file is empty.');
    if (file.size > FAR_UPLOAD_MAX_BYTES) {
      throw new HttpError(
        400,
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${FAR_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`,
      );
    }
    if (!invoiceMediaTypeFor(file.name)) {
      throw new HttpError(
        400,
        `Unsupported file type for "${file.name}" — an invoice has to arrive as a PDF or an image.`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    return ingestInvoice(
      engagementId,
      { filename: file.name, bytes, contentType: file.type || null },
      {
        clientName: client.name,
        jurisdictionId: engagement.jurisdictionId,
        uploadedBy: await currentActor(),
      },
    );
  });
}
