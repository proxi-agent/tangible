import { handle } from '@/lib/route';
import type { QualityView } from '@tangible/types';
import { qualityView } from '@/lib/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How well the engine is doing, and what stands behind each rule.
 *
 * Firm-only, and not in the client wing's allowlist. Precision on a detector is
 * a fact about the firm's own tooling, and a client reading "situs-error is
 * right 71% of the time" learns nothing they can act on and one thing that
 * would make them doubt a finding that happens to be right.
 */
export function GET(): Promise<Response> {
  return handle(async (): Promise<QualityView> => {
    // The day the gate is judged on, taken once here so every rule in the
    // response is asked about the same date.
    return qualityView(new Date().toISOString().slice(0, 10));
  });
}
