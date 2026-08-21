import type { PracticeSeason } from '@tangible/types';
import { handle } from '@/lib/route';
import { practiceSeason } from '@/lib/practice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Longer than the per-engagement season, and for the obvious reason: this one
// builds every return in the book rather than one client's.
export const maxDuration = 300;

/**
 * The whole book for one tax year.
 *
 * Not under `/engagements` on purpose — the question is what crosses a deadline
 * next across every client, and there is no engagement it belongs to.
 */
export function GET(request: Request): Promise<Response> {
  return handle(async (): Promise<PracticeSeason> => {
    const asked = new URL(request.url).searchParams.get('taxYear');
    // A garbage year is treated as none rather than a 400: the year is a view
    // choice, and the endpoint's answer without one is the newest year on file.
    const year = asked && /^\d{4}$/.test(asked) ? Number(asked) : undefined;
    return practiceSeason(year);
  });
}
