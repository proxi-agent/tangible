import type { RegisterComparison } from '@tangible/filing';
import { buildComparisonAnalysis } from '@/lib/analysis';
import { handle } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The prior return, held against the register.
 *
 * Derived on read like the savings report, and for the same reason: settling one
 * more line in the mapping queue or one more row in the classification queue
 * should change this immediately. A stored comparison would go stale against the
 * decisions it was built from, silently — which is why the stored kind is dated,
 * committed by name, and says so when its inputs have moved.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  return handle(async (): Promise<RegisterComparison> => {
    const { documentId } = await params;
    const { comparison } = await buildComparisonAnalysis(documentId);
    return comparison;
  });
}
