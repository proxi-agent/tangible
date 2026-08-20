import type { ClassificationRunResult } from '@tangible/types';
import { handle, params as queryParams } from '@/lib/route';
import { runClassification } from '@/lib/classification';
import { fetchEngagement } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * A large register is several model calls deep even after deduplication, and
 * the default 60s ceiling would cut a legitimate run off mid-way.
 */
export const maxDuration = 300;

/**
 * Classify this engagement's assets: memory first, then the model for what
 * memory could not answer.
 *
 * `?reclassify=true` re-decides rows that carry a machine decision — worth
 * doing once memory has grown, or after a mapping was corrected. Confirmed
 * rows are never touched, so a re-run can never cost a reviewer their work.
 */
export function POST(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<ClassificationRunResult> => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);
    const reclassify = queryParams(request).reclassify === 'true';
    return runClassification(engagementId, { reclassify });
  });
}
