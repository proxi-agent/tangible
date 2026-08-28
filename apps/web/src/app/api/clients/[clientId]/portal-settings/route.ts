import { eq } from 'drizzle-orm';
import { UpdatePortalSettingsSchema, type PortalSettings } from '@tangible/types';
import { handle } from '@/lib/route';
import { currentViewer, requireClientScope } from '@/lib/viewer';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How much confidence the client wants to see by default.
 *
 * Read and written from the client wing, because it is theirs. A viewer can
 * read it — the setting explains what they are looking at, and a colleague who
 * cannot see why half the rows are missing has been left confused for no
 * reason — and the write is gated the same way every other client-side write
 * is, at the point of writing rather than by hiding the value.
 */
async function read(clientId: string): Promise<PortalSettings> {
  const db = requireDb();
  const [row] = await db
    .select()
    .from(schema.portalSettings)
    .where(eq(schema.portalSettings.clientId, clientId));
  // Absence is a default, not an error. A client who has never touched this
  // sees everything, which is the right thing to show somebody the first time.
  return row
    ? {
        clientId: row.clientId,
        confidenceFloor: row.confidenceFloor as PortalSettings['confidenceFloor'],
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt.toISOString(),
      }
    : {
        clientId,
        confidenceFloor: 'low',
        updatedBy: null,
        updatedAt: new Date(0).toISOString(),
      };
}

export function GET(
  _request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  return handle(async (): Promise<PortalSettings> => {
    const { clientId } = await params;
    await requireClientScope(clientId);
    return read(clientId);
  });
}

export function PATCH(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  return handle(async (): Promise<PortalSettings> => {
    const { clientId } = await params;
    await requireClientScope(clientId);
    const body = UpdatePortalSettingsSchema.parse(await request.json());
    const viewer = await currentViewer();
    const db = requireDb();
    await db
      .insert(schema.portalSettings)
      .values({
        clientId,
        confidenceFloor: body.confidenceFloor,
        updatedBy: viewer?.email ?? null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.portalSettings.clientId,
        set: {
          confidenceFloor: body.confidenceFloor,
          updatedBy: viewer?.email ?? null,
          updatedAt: new Date(),
        },
      });
    return read(clientId);
  });
}
