import { handle } from '@/lib/route';
import type { EngineDigestView } from '@tangible/types';
import { DIGEST_DAYS, engineDigest } from '@/lib/engine-digest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What the engine learned lately, for any window somebody asks about.
 *
 * `days` is a query parameter rather than a constant because the scheduled
 * digest has one recovery and this is it: a week the cron did not run is a week
 * whose crossings were never mailed, and the answer is to widen the window and
 * look. Clamped at a year — past that the earlier reading is empty for most
 * firms and every fact reads as new, which is not a digest, it is the board.
 *
 * Firm-only, on the same footing as the rest of `/api/quality/*`: it names
 * finding keys and register phrases drawn from every client the firm has, and
 * `CLIENT_ROUTES` in `proxy.ts` carries no entry for this wing.
 */
export function GET(request: Request): Promise<Response> {
  return handle(async (): Promise<EngineDigestView> => {
    const asked = Number(new URL(request.url).searchParams.get('days'));
    const days =
      Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), 365) : DIGEST_DAYS;
    return engineDigest(days);
  });
}
