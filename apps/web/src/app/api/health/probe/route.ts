import { NextResponse } from 'next/server';
import { recordProbe } from '@/lib/health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The scheduled sweep, written down whether or not anything is wrong.
 *
 * Its output is a row, not a status code — that is what separates it from
 * `/api/health` beside it. The endpoint answers a monitor's question, "are you
 * up right now"; this one builds the trail that makes silence mean something,
 * because without it a system that has stopped running its jobs and a system
 * with nothing to do produce the same calm screen.
 *
 * A failing check raises an incident, which mails the firm the first time and
 * then only counts. Same `CRON_SECRET` discipline as the run drainer, for the
 * same reason and with the same refusal when it is unset: a scheduler with no
 * secret configured is a deployment mistake, and a cron that visibly does not
 * run is better than an open endpoint that does.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { statusCode: 503, message: 'No CRON_SECRET is configured, so the probe will not run.' },
      { status: 503 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ statusCode: 401, message: 'Sign in required.' }, { status: 401 });
  }

  /**
   * 200 even when the sweep failed. The cron is reporting on whether it *ran*,
   * and answering 503 for a warehouse that is down would have the platform
   * retry a probe whose whole job was to record that the warehouse is down.
   */
  return NextResponse.json(await recordProbe('cron'));
}

/** Vercel Cron issues GET. Same work, same check. */
export function GET(request: Request): Promise<Response> {
  return POST(request);
}
