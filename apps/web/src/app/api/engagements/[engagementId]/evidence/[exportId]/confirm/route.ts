import { z } from 'zod';
import { EvidenceColumnMapSchema } from '@tangible/types';
import { confirmEvidence } from '@/lib/evidence';
import { handle } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BodySchema = z.object({
  sheetName: z.string().min(1),
  headerRow: z.number().int().nonnegative(),
  columns: EvidenceColumnMapSchema,
});

/**
 * Import the file under a mapping a person looked at.
 *
 * Separate from the upload for the same reason the register's confirm is: the
 * proposal is a guess off a header row, and the cost of an unreviewed guess
 * here is a source that appears to have searched for an asset it never held a
 * column for.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string; exportId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { engagementId, exportId } = await params;
    await fetchEngagement(engagementId);
    return confirmEvidence(exportId, BodySchema.parse(await request.json()));
  });
}
