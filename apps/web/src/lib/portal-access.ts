import { getDb, schema } from '@tangible/db';
import { eq } from 'drizzle-orm';
import type { PortalRole } from '@tangible/types';

/**
 * Deciding which of the two audiences an email belongs to.
 *
 * Kept apart from `viewer.ts` because the proxy imports it, and the proxy runs
 * before route handlers exist — it cannot reach anything that pulls in
 * `server-only` or `next/headers`. What is left here is the decision itself,
 * with no opinion about where the email came from.
 *
 * The two audiences are checked in order and the firm wins. A preparer whose
 * address also appears on a portal grant is a preparer: the alternative is that
 * adding somebody to a client's wing silently demotes them out of the
 * workspace, which is a support call nobody would diagnose.
 */

export type Audience =
  | { audience: 'firm' }
  | { audience: 'client'; grantId: string; clientId: string; role: PortalRole }
  /** Signed in, on neither list. */
  | { audience: 'none' };

/**
 * Who may use the firm workspace, by email.
 *
 * The gate fails closed: with auth configured but no allowlist, no firm account
 * gets in. Admitting every authenticated account would be a real hole rather
 * than a lenient default — the anon key ships to the browser by design and
 * Supabase projects allow email signup out of the box.
 *
 * Note this is now the *firm* list rather than the whole app's: a client signing
 * in is admitted by a `portal_users` row, not by this.
 */
export function firmEmails(): string[] {
  return (process.env.AUTH_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function isFirmEmail(email: string): boolean {
  return firmEmails().includes(email.toLowerCase());
}

/**
 * The portal grant for an email, if there is exactly one.
 *
 * Two grants for the same address cannot happen — a unique index forbids it —
 * so this returns the row or nothing. The index is the enforcement; this is the
 * read.
 */
export async function portalGrant(email: string): Promise<{
  id: string;
  clientId: string;
  role: PortalRole;
  authUserId: string | null;
} | null> {
  if (!process.env.DATABASE_URL) return null;
  const [row] = await getDb()
    .select({
      id: schema.portalUsers.id,
      clientId: schema.portalUsers.clientId,
      role: schema.portalUsers.role,
      authUserId: schema.portalUsers.authUserId,
    })
    .from(schema.portalUsers)
    .where(eq(schema.portalUsers.email, email.toLowerCase()));
  if (!row) return null;
  return { ...row, role: row.role as PortalRole };
}

export async function audienceFor(email: string): Promise<Audience> {
  if (isFirmEmail(email)) return { audience: 'firm' };
  const grant = await portalGrant(email);
  if (!grant) return { audience: 'none' };
  return {
    audience: 'client',
    grantId: grant.id,
    clientId: grant.clientId,
    role: grant.role,
  };
}

/**
 * Record that a grant was actually used, the first time it is.
 *
 * Fire-and-forget on the read path: this is an audit stamp, and a write that
 * fails should not stop somebody signing in. It answers "did this person ever
 * log in, and as whom" — the two questions asked when a client says they never
 * saw the report we sent.
 */
export async function claimGrant(grantId: string, authUserId: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  try {
    await getDb()
      .update(schema.portalUsers)
      .set({ authUserId, claimedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.portalUsers.id, grantId));
  } catch (error) {
    console.error('[portal] could not stamp the grant claim', error);
  }
}
