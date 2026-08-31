import { NextResponse } from 'next/server';
import { recordIncident } from '@/lib/incidents';
import { drainRuns } from '@/lib/runs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * The reaper. Picks up what is queued, and requeues what was abandoned.
 *
 * A run is normally started inside the request that queued it, after the
 * response. That covers the ordinary case and nothing else: an invocation torn
 * down mid-analysis, a deploy landing between the queue and the claim, or a row
 * queued by something that could not start it leaves work nobody holds. This is
 * what finds it, and the only reason a client's report is not lost by a restart.
 *
 * Called on a schedule. It authenticates with `CRON_SECRET` — the header Vercel
 * Cron sends automatically — because an open endpoint that starts analyses is a
 * way to make this app do unbounded work for free. Unset, it refuses rather
 * than running open: a scheduler with no secret configured is a deployment
 * mistake, and the failure mode of guessing wrong here is worse than a cron job
 * that visibly does not run.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { statusCode: 503, message: 'No CRON_SECRET is configured, so the runner will not start.' },
      { status: 503 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ statusCode: 401, message: 'Sign in required.' }, { status: 401 });
  }

  try {
    return NextResponse.json(await drainRuns());
  } catch (error) {
    console.error('[runs] drain failed', error);
    /**
     * The reaper failing is worse than any single run failing: nothing is
     * requeued after it, so every abandoned run stays abandoned and the only
     * symptom is reports that never arrive.
     */
    await recordIncident({ surface: 'cron', label: 'runs · drain', error });
    return NextResponse.json({ statusCode: 500, message: 'The runner failed.' }, { status: 500 });
  }
}

/** Vercel Cron issues GET. Same work, same check. */
export function GET(request: Request): Promise<Response> {
  return POST(request);
}
