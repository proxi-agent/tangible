import { desc, eq } from 'drizzle-orm';
import { UpdateClientRequestSchema, type ClientDetail } from '@tangible/types';
import { handle } from '@/lib/route';
import { requireClientScope, requireFirm } from '@/lib/viewer';
import {
  clientDto,
  engagementDto,
  fetchClient,
  filingProfileDto,
  locationDto,
} from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Params = { params: Promise<{ clientId: string }> };

export function GET(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<ClientDetail> => {
    const { clientId } = await params;
    // The client wing reads this for its own name and its own seasons. Anyone
    // else's id answers 404 here, the same as an id that does not exist.
    await requireClientScope(clientId);
    const client = await fetchClient(clientId);
    const db = requireDb();

    const [locations, engagements, profiles] = await Promise.all([
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
      db
        .select()
        .from(schema.clientFilingProfiles)
        .where(eq(schema.clientFilingProfiles.clientId, clientId)),
    ]);

    return {
      client: clientDto(client),
      locations: locations.map(locationDto),
      engagements: engagements.map(engagementDto),
      filingProfile: profiles[0] ? filingProfileDto(profiles[0]) : null,
    };
  });
}

export function PATCH(request: Request, { params }: Params): Promise<Response> {
  return handle(async () => {
    const { clientId } = await params;
    // Editing the business record is the firm's, not the client's: the name and
    // the entity details on it are what the rendition is signed under.
    await requireFirm();
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
