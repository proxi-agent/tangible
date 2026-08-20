import { desc, eq, sql } from 'drizzle-orm';
import { CreateClientRequestSchema, type ClientListItem } from '@tangible/types';
import { handle } from '@/lib/route';
import { clientDto } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(): Promise<Response> {
  return handle(async () => {
    const db = requireDb();
    const rows = await db
      .select({
        client: schema.clients,
        engagementCount: sql<number>`count(${schema.engagements.id})::int`,
      })
      .from(schema.clients)
      .leftJoin(schema.engagements, eq(schema.engagements.clientId, schema.clients.id))
      .groupBy(schema.clients.id)
      .orderBy(desc(schema.clients.updatedAt));

    return rows.map((row): ClientListItem => ({
      ...clientDto(row.client),
      engagementCount: row.engagementCount,
    }));
  });
}

export function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const body = CreateClientRequestSchema.parse(await request.json());
    const db = requireDb();
    const [row] = await db
      .insert(schema.clients)
      .values({ name: body.name, status: body.status, notes: body.notes ?? null })
      .returning();
    return clientDto(row!);
  });
}
