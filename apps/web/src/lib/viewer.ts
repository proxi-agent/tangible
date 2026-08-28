import 'server-only';
import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { and, eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import type { PortalRole, Viewer } from '@tangible/types';
import { audienceFor } from '@/lib/portal-access';
import { HttpError } from '@/lib/route';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Who is asking, and what they are allowed to have.
 *
 * The proxy has already decided that the request may proceed and which wing of
 * the app it may address. This is the second half of the same question, and the
 * half the proxy cannot answer: a URL like `/api/engagements/<uuid>/savings`
 * says nothing about whose engagement it is. Every route that reaches client
 * data goes through one of the `require*` helpers below, and the check is a
 * join against the caller's own client rather than a comparison the caller
 * could influence.
 *
 * Two rules the helpers encode:
 *
 *   - **A client cannot address another client, by any route.** Not by editing
 *     a URL, not by holding a stale id, not by guessing a uuid. The assertion is
 *     always "does this row belong to *my* client", never "is this row's client
 *     the one the request claimed".
 *   - **A refusal reads as absence.** A client asking for somebody else's
 *     engagement gets the same 404 as one asking for an engagement that does not
 *     exist. A 403 would confirm the id is real, which is a slow enumeration of
 *     the firm's client list.
 *
 * The session is read here rather than trusted from a header the proxy set: a
 * header the proxy can set is a header a caller can set, and the whole tenancy
 * boundary would then rest on the matcher never missing a path.
 */

/**
 * Memoized for the request. Several helpers may run in one handler — a route
 * that asserts scope and also stamps an actor — and each would otherwise cost
 * a round-trip to Supabase auth plus a grant lookup.
 */
export const currentViewer = cache(async (): Promise<Viewer | null> => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  /**
   * Auth unconfigured is the local development mode, and the app runs open —
   * the same policy the proxy applies. It resolves to the firm rather than to
   * nobody, because a laptop with no Supabase project should behave like the
   * workspace it is, not like a locked-out client.
   */
  if (!url || !anonKey) {
    return { email: 'local', audience: 'firm', clientId: null, clientName: null, role: null };
  }

  const store = await cookies();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      // Read-only: the proxy already refreshed this session on the way in, and
      // a route handler cannot always write cookies anyway.
      setAll: () => {},
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const decided = await audienceFor(user.email);
  if (decided.audience === 'none') return null;
  if (decided.audience === 'firm') {
    return { email: user.email, audience: 'firm', clientId: null, clientName: null, role: null };
  }

  const db = requireDb();
  const [client] = await db
    .select({ name: schema.clients.name })
    .from(schema.clients)
    .where(eq(schema.clients.id, decided.clientId));

  return {
    email: user.email,
    audience: 'client',
    clientId: decided.clientId,
    clientName: client?.name ?? null,
    role: decided.role,
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await currentViewer();
  if (!viewer) throw new HttpError(401, 'Sign in required.');
  return viewer;
}

/** Routes that only ever belong to the workspace: every firm-side screen. */
export async function requireFirm(): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.audience !== 'firm') {
    throw new HttpError(404, 'No record with that id.');
  }
  return viewer;
}

/**
 * A client-side person who may act, not just read.
 *
 * Sending a register and answering a question both become tax positions — the
 * answer to "is any of this held outside Texas?" ends up on a signed rendition.
 * A viewer forwarding the report to a colleague should not thereby hand them
 * the ability to answer that.
 */
export async function requirePortalRole(...allowed: PortalRole[]): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.audience === 'firm') return viewer;
  if (!viewer.role || !allowed.includes(viewer.role)) {
    throw new HttpError(
      403,
      'Your access to this account is read-only. Ask whoever set it up to give you the ability to send files and answer questions.',
    );
  }
  return viewer;
}

/**
 * The client this request is allowed to work in.
 *
 * For a client viewer the answer is their own, and the id in the URL has to
 * match it. For the firm it is whatever was addressed — including a client
 * portal being previewed, which is why the firm branch accepts the argument
 * rather than refusing it.
 */
export async function requireClientScope(clientId: string): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.audience === 'firm') return viewer;
  if (viewer.clientId !== clientId) throw new HttpError(404, 'No record with that id.');
  return viewer;
}

/**
 * The engagement this request is allowed to work in.
 *
 * Resolved by asking for the engagement *and* the caller's client in one where
 * clause. Fetching it and then comparing `row.clientId` would be equivalent
 * today and one refactor away from a leak: any future code path that reads the
 * row before the comparison has already loaded another business's data into a
 * process that is about to serialize something.
 */
export async function requireEngagementScope(engagementId: string): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.audience === 'firm') return viewer;

  const db = requireDb();
  const [row] = await db
    .select({ id: schema.engagements.id })
    .from(schema.engagements)
    .where(
      and(
        eq(schema.engagements.id, engagementId),
        eq(schema.engagements.clientId, viewer.clientId!),
      ),
    );
  if (!row) throw new HttpError(404, 'No record with that id.');
  return viewer;
}

/**
 * The engagement behind a row addressed by its own id.
 *
 * `/api/asks/<uuid>` names an ask, not an engagement, so the URL carries no
 * scope at all — the join is what supplies it. Same shape as the engagement
 * check: one where clause, and a miss is indistinguishable from a row that was
 * never there.
 */
export async function requireAskScope(askId: string): Promise<Viewer> {
  const viewer = await requireViewer();
  if (viewer.audience === 'firm') return viewer;

  const db = requireDb();
  const [row] = await db
    .select({ id: schema.mappingAsks.id })
    .from(schema.mappingAsks)
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.mappingAsks.engagementId))
    .where(and(eq(schema.mappingAsks.id, askId), eq(schema.engagements.clientId, viewer.clientId!)));
  if (!row) throw new HttpError(404, 'No record with that id.');
  return viewer;
}

/**
 * The client whose portal is on screen.
 *
 * A client sees their own and nothing else — the parameter is ignored rather
 * than trusted, so a stale or edited `?client=` cannot move them. The firm
 * needs the parameter, because previewing a client's wing is how a preparer
 * answers "what does this look like to them"; without an explicit id the firm
 * has no portal scope at all, which is the correct default now that the
 * identity is no longer something a reader picks.
 */
export async function portalScope(requested: string | null): Promise<{
  viewer: Viewer;
  clientId: string | null;
  previewing: boolean;
}> {
  const viewer = await requireViewer();
  if (viewer.audience === 'client') {
    return { viewer, clientId: viewer.clientId, previewing: false };
  }
  return { viewer, clientId: requested, previewing: requested !== null };
}
