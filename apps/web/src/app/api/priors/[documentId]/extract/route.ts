import { eq } from 'drizzle-orm';
import { handle, notFound } from '@/lib/route';
import { runExtraction } from '@/lib/priors';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';
import { engagementAccounts } from '@/lib/sites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Re-read a stored document.
 *
 * The retry path, and the reason upload stores before it extracts. A document
 * that failed because no API key was set, or because the first read timed out,
 * is re-read from the bucket without anyone hunting for the original file.
 */
export function POST(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { documentId } = await params;
    const db = requireDb();
    const [row] = await db
      .select()
      .from(schema.priorDocuments)
      .where(eq(schema.priorDocuments.id, documentId));
    if (!row) return notFound(`Unknown prior document: ${documentId}`);

    const { engagement, client } = await fetchEngagement(row.engagementId);
    return runExtraction({
      documentId,
      clientName: client.name,
      expectedTaxYear: engagement.taxYear,
      expectedAccountIds: await engagementAccounts(engagement.id),
    });
  });
}
