import { CreateEngagementRequestSchema } from '@tangible/types';
import { handle } from '@/lib/route';
import { engagementDto, fetchClient } from '@/lib/workspace';
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
    const body = CreateEngagementRequestSchema.parse(await request.json());
    const db = requireDb();
    const [row] = await db
      .insert(schema.engagements)
      .values({
        clientId,
        taxYear: body.taxYear,
        jurisdictionId: body.jurisdictionId ?? null,
        notes: body.notes ?? null,
      })
      .returning();
    return engagementDto(row!);
  });
}
