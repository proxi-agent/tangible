import { FAR_UPLOAD_EXTENSIONS, FAR_UPLOAD_MAX_BYTES } from '@tangible/types';
import { HttpError, handle } from '@/lib/route';
import { ingestRegister } from '@/lib/ingest';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Upload a FAR file. The actual pipeline lives in {@link ingestRegister},
 * shared with multi-file intake routing; this route is the HTTP validation
 * in front of it.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new HttpError(400, "Send the register as multipart form-data under the 'file' field.");
    }
    if (file.size === 0) throw new HttpError(400, 'The uploaded file is empty.');
    if (file.size > FAR_UPLOAD_MAX_BYTES) {
      throw new HttpError(
        400,
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${FAR_UPLOAD_MAX_BYTES / 1024 / 1024} MB.`,
      );
    }
    const dot = file.name.lastIndexOf('.');
    const extension = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
    if (!(FAR_UPLOAD_EXTENSIONS as readonly string[]).includes(extension)) {
      throw new HttpError(
        400,
        `Unsupported file type "${extension || file.name}" — accepted: ${FAR_UPLOAD_EXTENSIONS.join(', ')}.`,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    return ingestRegister(engagementId, {
      filename: file.name,
      bytes,
      contentType: file.type || null,
    });
  });
}

