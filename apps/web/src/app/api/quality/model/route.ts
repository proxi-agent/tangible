import { handle } from '@/lib/route';
import type { DetectionModel } from '@tangible/types';
import { detectionModelView } from '@/lib/model';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What the queue has taught the engine, and what it has not.
 *
 * Firm-only for the same reason as the acceptance board: the fit is pooled
 * across every client the practice has, so a coefficient is built partly out of
 * decisions somebody made about another taxpayer's register. Nothing
 * identifying survives the fit — signal codes, counts and log-odds — and it
 * stays on this side of the wall regardless.
 */
export function GET(): Promise<Response> {
  return handle(async (): Promise<DetectionModel> => detectionModelView());
}
