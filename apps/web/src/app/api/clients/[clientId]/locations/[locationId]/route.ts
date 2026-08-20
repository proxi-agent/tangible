import { and, eq } from 'drizzle-orm';
import { UpdateLocationRequestSchema, type ClientLocation } from '@tangible/types';
import { handle } from '@/lib/route';
import { fetchClient, locationDto } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ clientId: string; locationId: string }> };

/**
 * Fill in a location after the fact.
 *
 * A site is first recorded as whatever label the operator recognises it by, and
 * the address the district needs arrives later — off a lease, a notice, or the
 * client. Scoped by client id as well as location id so a location cannot be
 * edited through a client that does not own it.
 */
export function PATCH(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<ClientLocation> => {
    const { clientId, locationId } = await params;
    await fetchClient(clientId);
    const body = UpdateLocationRequestSchema.parse(await request.json());
    const db = requireDb();
    const [row] = await db
      .update(schema.clientLocations)
      .set(body)
      .where(
        and(eq(schema.clientLocations.id, locationId), eq(schema.clientLocations.clientId, clientId)),
      )
      .returning();
    if (!row) throw new Error('No such location on this client.');
    return locationDto(row);
  });
}
