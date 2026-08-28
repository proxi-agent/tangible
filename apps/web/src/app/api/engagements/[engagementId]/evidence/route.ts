import { EVIDENCE_SOURCES } from '@tangible/evidence';
import { currentActor } from '@/lib/actor';
import { evidenceBoard, ingestEvidence, isEvidenceKind } from '@/lib/evidence';
import { HttpError, handle } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The external systems consulted on this engagement.
 *
 * The upload carries the source kind because the kind is the meaning: the same
 * spreadsheet of serial numbers proves an asset exists if it came out of a
 * device manager and proves the client does not own it if it came out of a
 * lease schedule. It is a field on the form rather than something guessed from
 * the file, because guessing it wrong inverts the conclusion.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);
    return evidenceBoard(engagementId);
  });
}

export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);

    const form = await request.formData();
    const file = form.get('file');
    const kind = String(form.get('kind') ?? '');
    if (!(file instanceof File)) {
      throw new HttpError(400, "Send the export as multipart form-data under the 'file' field.");
    }
    if (!isEvidenceKind(kind)) {
      throw new HttpError(
        400,
        `Say which system this came out of — one of: ${Object.keys(EVIDENCE_SOURCES).join(', ')}.`,
      );
    }

    return ingestEvidence(
      engagementId,
      kind,
      {
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type || null,
      },
      await currentActor(),
    );
  });
}
