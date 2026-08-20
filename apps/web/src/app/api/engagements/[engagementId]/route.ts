import { desc, eq } from 'drizzle-orm';
import {
  UpdateEngagementRequestSchema,
  type Engagement,
  type EngagementDetail,
} from '@tangible/types';
import { handle } from '@/lib/route';
import {
  clientDto,
  engagementAssetStats,
  engagementClassificationStats,
  engagementDto,
  farFileDto,
  fetchEngagement,
} from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<EngagementDetail> => {
    const { engagementId } = await params;
    const { engagement, client } = await fetchEngagement(engagementId);
    const db = requireDb();

    const [files, stats, classification] = await Promise.all([
      db
        .select()
        .from(schema.farFiles)
        .where(eq(schema.farFiles.engagementId, engagementId))
        .orderBy(desc(schema.farFiles.createdAt)),
      engagementAssetStats(engagementId),
      engagementClassificationStats(engagementId),
    ]);

    return {
      engagement: engagementDto(engagement),
      client: clientDto(client),
      files: files.map(farFileDto),
      stats,
      classification,
    };
  });
}

/**
 * Set the situs jurisdiction (or correct the year) after the fact. Nothing can
 * be valued until the jurisdiction is known, and it usually is not known until
 * the register turns up and says where the property sits.
 */
export function PATCH(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<Engagement> => {
    const { engagementId } = await params;
    await fetchEngagement(engagementId);
    const body = UpdateEngagementRequestSchema.parse(await request.json());

    const db = requireDb();
    const [updated] = await db
      .update(schema.engagements)
      .set({
        // An empty string from a cleared select means "unknown", not "".
        ...(body.jurisdictionId !== undefined
          ? { jurisdictionId: body.jurisdictionId || null }
          : {}),
        ...(body.sicCode !== undefined ? { sicCode: body.sicCode || null } : {}),
        ...(body.taxYear !== undefined ? { taxYear: body.taxYear } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.engagements.id, engagementId))
      .returning();

    return engagementDto(updated!);
  });
}
