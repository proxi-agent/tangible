import { handle } from '@/lib/route';
import type { BundleVocabularyBoard } from '@tangible/types';
import { bundleVocabularyBoard } from '@/lib/bundle-vocabulary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Firm-only, and the reason is stronger here than on the rest of the quality
 * wing. The board prints sample register lines to show what a phrase is doing,
 * and those lines are drawn from every client the firm has ever settled a row
 * for. A client reading this screen would be reading other people's registers.
 * `/api/quality/*` is absent from `CLIENT_ROUTES` in `proxy.ts`; that absence
 * is what this file rests on.
 */
export function GET(): Promise<Response> {
  return handle(async (): Promise<BundleVocabularyBoard> => bundleVocabularyBoard());
}
