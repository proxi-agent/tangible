import { eq } from 'drizzle-orm';
import { buildRendition, type RenditionAsset } from '@tangible/filing';
import { RenditionRequestSchema, type ClassificationStatus, type Rendition } from '@tangible/types';
import { scheduleFor } from '@tangible/valuation';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { handle, params as queryParams } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Form 50-144 as the engagement currently stands.
 *
 * Derived on read like the savings report, and for a sharper reason: this is a
 * sworn document. It must reflect the classifications as they are at the moment
 * someone looks at it, never a snapshot taken before the last three review
 * decisions landed. When a filing is actually submitted, *that* gets frozen and
 * stored — but the working draft stays live.
 */
export function GET(
  request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<Rendition> => {
    const { engagementId } = await params;
    const { engagement, client } = await fetchEngagement(engagementId);

    const raw = queryParams(request);
    const { basis, filedByAgent } = RenditionRequestSchema.parse({
      basis: raw.basis ?? 'cost',
      // `z.coerce.boolean()` treats any non-empty string as true, so map it.
      filedByAgent: raw.filedByAgent === undefined ? true : raw.filedByAgent === 'true',
    });

    const db = requireDb();
    const rows = await db
      .select({ asset: schema.assetVersions, classification: schema.assetClassifications })
      .from(schema.assetVersions)
      .leftJoin(
        schema.assetClassifications,
        eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
      )
      .where(engagementAssetsWhere(engagementId));

    const assets: RenditionAsset[] = rows.map(({ asset, classification }) => ({
      id: asset.assetId,
      description: asset.description,
      acquisitionYear: asset.acquisitionYear,
      originalCost: asset.originalCost,
      isDisposed: asset.isDisposed,
      categoryKey: classification?.categoryKey ?? null,
      lifeClassOverride: classification?.lifeClassOverride ?? null,
      status: (classification?.status as ClassificationStatus | undefined) ?? null,
    }));

    return buildRendition({
      engagementId,
      clientName: client.name,
      taxYear: engagement.taxYear,
      jurisdictionId: engagement.jurisdictionId,
      accountId: engagement.accountId,
      sicCode: engagement.sicCode,
      assets,
      schedule: engagement.jurisdictionId
        ? (scheduleFor(engagement.jurisdictionId, engagement.taxYear) ?? null)
        : null,
      basis,
      filedByAgent,
      generatedAt: new Date().toISOString(),
    });
  });
}
