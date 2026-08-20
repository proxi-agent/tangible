import { eq } from 'drizzle-orm';
import { UpdateFilingProfileRequestSchema, type ClientFilingProfile } from '@tangible/types';
import { handle } from '@/lib/route';
import { fetchClient, filingProfileDto } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ clientId: string }> };

/**
 * PUT rather than PATCH, and an upsert rather than an update.
 *
 * The profile is one screen that saves as one, and the row may not exist yet —
 * a client acquires a filing profile the first time somebody fills any of it
 * in, not when the client is created. Sending the whole shape also means a box
 * cleared on screen clears in the database, which a merge of only the present
 * keys would silently refuse to do.
 */
export function PUT(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<ClientFilingProfile> => {
    const { clientId } = await params;
    await fetchClient(clientId);
    const body = UpdateFilingProfileRequestSchema.parse(await request.json());
    const db = requireDb();

    const [row] = await db
      .insert(schema.clientFilingProfiles)
      .values({ clientId, ...body })
      .onConflictDoUpdate({
        target: schema.clientFilingProfiles.clientId,
        set: { ...body, updatedAt: new Date() },
      })
      .returning();

    return filingProfileDto(row!);
  });
}

export function GET(request: Request, { params }: Params): Promise<Response> {
  return handle(async (): Promise<ClientFilingProfile | null> => {
    const { clientId } = await params;
    await fetchClient(clientId);
    const db = requireDb();
    const [row] = await db
      .select()
      .from(schema.clientFilingProfiles)
      .where(eq(schema.clientFilingProfiles.clientId, clientId));
    return row ? filingProfileDto(row) : null;
  });
}
