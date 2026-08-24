import { RunRolloverRequestSchema } from '@tangible/types';
import { rolloverPlan, runRollover } from '@/lib/rollover';
import { handle, HttpError } from '@/lib/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Who would roll from ?year= into the next season. Creates nothing. */
export function GET(request: Request): Promise<Response> {
  return handle(async () => {
    const asked = new URL(request.url).searchParams.get('year');
    if (!asked || !/^\d{4}$/.test(asked)) {
      throw new HttpError(400, 'Pass the season being left as ?year=.');
    }
    return rolloverPlan(Number(asked));
  });
}

/**
 * Open the next season for every ready client.
 *
 * The plan is re-derived inside the run, so a stale screen cannot create a
 * duplicate: a client whose next year was opened elsewhere since the page
 * loaded is found already open and skipped. Running twice creates nothing
 * the second time.
 */
export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const parsed = RunRolloverRequestSchema.parse(await request.json());
    return runRollover(parsed.fromYear);
  });
}
