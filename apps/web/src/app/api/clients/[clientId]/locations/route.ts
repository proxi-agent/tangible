import { CreateLocationRequestSchema } from '@tangible/types';
import { handle } from '@/lib/route';
import { fetchClient, locationDto } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  return handle(async () => {
    const { clientId } = await params;
    await fetchClient(clientId);
    const body = CreateLocationRequestSchema.parse(await request.json());
    const db = requireDb();
    const [row] = await db
      .insert(schema.clientLocations)
      .values({
        clientId,
        label: body.label,
        addressLine1: body.addressLine1 ?? null,
        city: body.city ?? null,
        stateCode: body.stateCode ?? null,
        zip: body.zip ?? null,
        jurisdictionId: body.jurisdictionId ?? null,
        accountId: body.accountId ?? null,
        notes: body.notes ?? null,
      })
      .returning();
    return locationDto(row!);
  });
}
