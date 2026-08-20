import { handle } from '@/lib/route';
import { fetchMappedDocument } from '@/lib/prior-mapping';
import { priorDocumentDto } from '@/lib/priors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One prior filing, read: every line with what its wording was taken to mean,
 * and the rollup those readings produce.
 *
 * The rollup is on this response rather than computed in the browser because it
 * is the thing that has to reconcile — placed plus unplaced equals reported —
 * and that property is worth proving in one place, next to its tests.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { documentId } = await params;
    const { document, lines, basis } = await fetchMappedDocument(documentId);
    return { document: priorDocumentDto(document, lines.length), lines, basis };
  });
}
