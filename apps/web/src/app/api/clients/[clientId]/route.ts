import { desc, eq } from 'drizzle-orm';
import { UpdateClientRequestSchema, type ClientDetail } from '@tangible/types';
import { handle } from '@/lib/route';
import { clientDto, engagementDto, fetchClient, locationDto } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ clientId: string }> };

export function GET(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<ClientDetail> => {
    const { clientId } = await params;
    const client = await fetchClient(clientId);
    const db = requireDb();

    const [locations, engagements] = await Promise.all([
      db
        .select()
        .from(schema.clientLocations)
        .where(eq(schema.clientLocations.clientId, clientId))
        .orderBy(schema.clientLocations.label),
      db
        .select()
        .from(schema.engagements)
        .where(eq(schema.engagements.clientId, clientId))
        .orderBy(desc(schema.engagements.taxYear), desc(schema.engagements.createdAt)),
    ]);

    return {
      client: clientDto(client),
      locations: locations.map(locationDto),
      engagements: engagements.map(engagementDto),
    };
  });
}

export function PATCH(request: Request, { params }: Params): Promise<Response> {
  return handle(async () => {
    const { clientId } = await params;
    await fetchClient(clientId);
    const body = UpdateClientRequestSchema.parse(await request.json());
    const db = requireDb();
    const [row] = await db
      .update(schema.clients)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.clients.id, clientId))
      .returning();
    return clientDto(row!);
  });
}
