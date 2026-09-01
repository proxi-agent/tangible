import { NextResponse } from 'next/server';
import { renderDigest } from '@tangible/eval';
import { DIGEST_DAYS, engineDigest } from '@/lib/engine-digest';
import { recordIncident } from '@/lib/incidents';
import { appUrl, firmRecipients, sendMail } from '@/lib/notify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The weekly telling.
 *
 * Everything this system learns, it learns quietly: a rate crosses its bar in
 * March and the firm finds out in August by opening a screen for an unrelated
 * reason. This is the one job whose entire output is a sentence somebody reads.
 *
 * **It sends nothing most weeks, and that is the design.** `material` is true
 * only when a fact crossed a bar, stopped clearing one, or moved by more than
 * the threshold — the changes that alter what the software does or what a
 * person has to commit. A weekly mail that arrives every week regardless is a
 * weekly mail nobody opens in the week it matters, so the quiet weeks stay
 * quiet and the board answers the same question on demand.
 *
 * **The window is the de-duplication.** Seven days here, seven days in
 * `vercel.json`: a crossing lands in exactly one window because the next one
 * begins after it. No `last_reported_at` column, and nothing to drift.
 *
 * Same `CRON_SECRET` discipline as the drainer and the probe, and the same
 * refusal when it is unset — a scheduler with no secret configured is a
 * deployment mistake, and a cron that visibly does not run is better than an
 * open endpoint that does.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { statusCode: 503, message: 'No CRON_SECRET is configured, so the digest will not run.' },
      { status: 503 },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ statusCode: 401, message: 'Sign in required.' }, { status: 401 });
  }

  try {
    const view = await engineDigest(DIGEST_DAYS);
    const { digest } = view;
    if (!digest.material) {
      return NextResponse.json({ sent: 0, changes: digest.changes.length, material: false });
    }

    const to = firmRecipients();
    if (to.length === 0) {
      console.warn('[digest] nobody to tell; set AUTH_ALLOWED_EMAILS');
      return NextResponse.json({ sent: 0, changes: digest.changes.length, material: true });
    }

    const acted = digest.changes.filter((change) => change.weight === 'act').length;
    const subject =
      acted > 0
        ? `[proxi] ${acted} change${acted === 1 ? '' : 's'} to what the engine does`
        : '[proxi] what the engine learned this week';
    const body = renderDigest(digest, appUrl());

    let sent = 0;
    for (const address of to) {
      /**
       * A send that fails is logged and the loop continues. One bad address
       * must not cost the other recipients the only notice they get, and there
       * is no row to write here — unlike a client notification, this mail is
       * about the software and has no season to be filed against.
       */
      const error = await sendMail(address, { subject, body });
      if (error) console.error('[digest] could not send', address, error);
      else sent += 1;
    }
    return NextResponse.json({ sent, changes: digest.changes.length, material: true });
  } catch (error) {
    /**
     * A digest that throws is an incident like any other job that throws. It is
     * recorded rather than swallowed, because the failure mode this whole file
     * exists to prevent is exactly "nobody was told" — and a digest that has
     * been failing silently for a month is the purest form of it.
     */
    await recordIncident({ surface: 'cron', label: '/api/quality/digest/send', error });
    return NextResponse.json(
      { statusCode: 500, message: 'The digest could not be built.' },
      { status: 500 },
    );
  }
}

/** Vercel Cron issues GET. Same work, same check. */
export function GET(request: Request): Promise<Response> {
  return POST(request);
}
