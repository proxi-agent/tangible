import type { Viewer } from '@tangible/types';
import { handle } from '@/lib/route';
import { currentViewer } from '@/lib/viewer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Who the browser is signed in as.
 *
 * The shell needs this before it can draw anything: a firm user gets the wing
 * toggle and eleven nav items, a client gets four and no toggle. Served as an
 * endpoint rather than read in the root layout because reading cookies in a
 * layout opts every route in the app out of static rendering, and because every
 * other piece of state in this app already arrives through the query client.
 *
 * Returning null rather than 401 for a signed-out browser: the shell renders on
 * `/login` too, and a 401 there would be an error state on the one page where
 * being signed out is the expected condition.
 */
export function GET(): Promise<Response> {
  return handle(async (): Promise<Viewer | null> => currentViewer());
}
