import { NextResponse } from 'next/server';
import { runHealthChecks } from '@/lib/health';
import { getWarehouseInfo } from '@/lib/warehouse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The contract an external uptime monitor reads.
 *
 * Deliberately not wrapped in `handle()`, and deliberately not always 200. A
 * monitor decides up or down from the status code, so an endpoint that answers
 * 200 with `{"ok": false}` is an endpoint that is never down — which is the
 * failure this whole floor exists to remove. A failing check answers 503.
 *
 * It says nothing about whether the app is reachable, because it *is* the app.
 * The only vantage point that can tell "unwell" from "not there" is outside the
 * deployment, which is why this exists to be called rather than to be mistaken
 * for monitoring on its own.
 *
 * **Unauthenticated, and therefore quiet.** A monitor cannot sign in, so this
 * is the one path past the gate in `proxy.ts`; a health check that needs a
 * session only ever tells you the session works. Anonymously it answers which
 * dependencies exist and whether each one replied, and nothing else — no row
 * counts, no bucket paths, no environment. Those are not client data, but "the
 * firm has three engagements" and "the parquet lives here" are both things a
 * stranger has no reason to be handed.
 *
 * The full form, with each check's detail and the warehouse's own diagnostics,
 * comes back for a caller presenting `CRON_SECRET` — the probe cron, and
 * whoever is reading `cache.durationMs` to choose a `PARQUET_CACHE` mode.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const trusted = Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;

  const report = await runHealthChecks();
  const status = report.ok ? 200 : 503;

  if (!trusted) {
    return NextResponse.json(
      { ...report, checks: report.checks.map(({ name, ok, ms }) => ({ name, ok, ms })) },
      { status },
    );
  }

  return NextResponse.json(
    { ...report, warehouse: await getWarehouseInfo().catch(() => null) },
    { status },
  );
}
