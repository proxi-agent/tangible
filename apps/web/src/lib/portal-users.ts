import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { getSupabaseAdmin } from '@tangible/db';
import type { GrantPortalAccessRequest, PortalRole, PortalUser } from '@tangible/types';
import { HttpError } from '@/lib/http';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Who, on the client's side, may sign in to a business's portal.
 *
 * A grant is a row here, and an account is a row in Supabase auth. They are
 * deliberately separate and joined by email: the firm grants access before the
 * person has ever signed in, and a business that never claims its invitation
 * should still show on this list as somebody who was invited and did not come.
 *
 * The invitation itself is best-effort and reported as such. A grant that
 * exists with no account behind it is a recoverable state — the firm re-sends,
 * or creates the account by hand — whereas an invitation that went out with no
 * grant behind it is a person who signs in successfully and sees nothing, which
 * reads to them as us having lost their account.
 */

type Row = typeof schema.portalUsers.$inferSelect;

export function portalUserDto(row: Row, clientName: string): PortalUser {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName,
    email: row.email,
    role: row.role as PortalRole,
    claimedAt: row.claimedAt?.toISOString() ?? null,
    invitedBy: row.invitedBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPortalUsers(clientId: string, clientName: string): Promise<PortalUser[]> {
  const rows = await requireDb()
    .select()
    .from(schema.portalUsers)
    .where(eq(schema.portalUsers.clientId, clientId))
    .orderBy(asc(schema.portalUsers.createdAt));
  return rows.map((row) => portalUserDto(row, clientName));
}

/**
 * Grant access, and say plainly when the address already belongs elsewhere.
 *
 * One email reaches one business — the unique index says so. The refusal names
 * the other business rather than saying "already exists", because the case that
 * actually happens is a controller who works for two entities the firm holds
 * separately, and the answer there is a second address, not a support ticket.
 */
export async function grantPortalAccess(
  clientId: string,
  clientName: string,
  body: GrantPortalAccessRequest,
  invitedBy: string,
): Promise<PortalUser> {
  const db = requireDb();
  const email = body.email.trim().toLowerCase();

  const [existing] = await db
    .select({ clientId: schema.portalUsers.clientId })
    .from(schema.portalUsers)
    .where(eq(schema.portalUsers.email, email));

  if (existing) {
    if (existing.clientId === clientId) {
      throw new HttpError(409, `${email} already has access to ${clientName}.`);
    }
    const [other] = await db
      .select({ name: schema.clients.name })
      .from(schema.clients)
      .where(eq(schema.clients.id, existing.clientId));
    throw new HttpError(
      409,
      `${email} already reaches ${other?.name ?? 'another business'}. One address signs in to one ` +
        `business — give them a second address for ${clientName}, or move the grant.`,
    );
  }

  const [row] = await db
    .insert(schema.portalUsers)
    .values({ clientId, email, role: body.role, invitedBy })
    .returning();

  await invite(email);
  return portalUserDto(row!, clientName);
}

export async function updatePortalAccess(
  clientId: string,
  grantId: string,
  role: PortalRole,
  clientName: string,
): Promise<PortalUser> {
  const db = requireDb();
  const [row] = await db
    .update(schema.portalUsers)
    .set({ role, updatedAt: new Date() })
    .where(eq(schema.portalUsers.id, grantId))
    .returning();
  if (!row || row.clientId !== clientId) throw new HttpError(404, 'No record with that id.');
  return portalUserDto(row, clientName);
}

/**
 * Revoke the grant.
 *
 * The Supabase account is deliberately left alone. Deleting it would be the
 * app reaching outside its own tables to destroy something the firm may have
 * created by hand, and the grant is what confers reach — without a row here,
 * `audienceFor` returns `none` and the session cannot address anything.
 */
export async function revokePortalAccess(clientId: string, grantId: string): Promise<void> {
  const db = requireDb();
  const [row] = await db
    .delete(schema.portalUsers)
    .where(eq(schema.portalUsers.id, grantId))
    .returning();
  if (!row || row.clientId !== clientId) throw new HttpError(404, 'No record with that id.');
}

/**
 * Ask Supabase to send the invitation.
 *
 * Swallowed on failure, and the reason is in the docblock above: the grant is
 * the durable half. An address that already has an account comes back as an
 * error here and is the ordinary case for a second grant to the same person's
 * colleague, so it is not worth surfacing either.
 */
async function invite(email: string): Promise<void> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    await getSupabaseAdmin().auth.admin.inviteUserByEmail(email);
  } catch (error) {
    console.error('[portal] could not send the invitation', error);
  }
}
