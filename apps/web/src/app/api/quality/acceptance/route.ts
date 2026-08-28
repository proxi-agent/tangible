import { handle } from '@/lib/route';
import type { AcceptanceBoard } from '@tangible/types';
import { acceptanceBoard } from '@/lib/acceptance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What districts have actually conceded, and what the engine now assumes.
 *
 * Firm-only, and for a sharper reason than the rest of the quality page. This
 * is the practice's own record pooled across every client it has: a rate that
 * says Harris County allows 41% of misclassification arguments is built partly
 * out of what happened to other people's returns. The numbers that come out are
 * finding keys and fractions with nothing identifying in them, and they stay on
 * this side of the wall anyway.
 */
export function GET(): Promise<Response> {
  return handle(async (): Promise<AcceptanceBoard> => acceptanceBoard());
}
