import { eq } from 'drizzle-orm';
import { compareRegister, type RegisterAsset, type RegisterComparison } from '@tangible/filing';
import type { ClassificationStatus } from '@tangible/types';
import { scheduleFor } from '@tangible/valuation';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { fetchMappedDocument } from '@/lib/prior-mapping';
import { handle, HttpError } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The prior return, held against the register.
 *
 * Derived on read like the savings report, and for the same reason: settling one
 * more line in the mapping queue or one more row in the classification queue
 * should change this immediately. A stored comparison would go stale against the
 * decisions it was built from, silently.
 *
 * The one thing worth stating twice: everything here is valued on the *return's*
 * own tax year, not the engagement's. A 2025 rendition reviewed inside a 2027
 * engagement is a statement about January 1, 2025, and pricing it on 2027 index
 * factors would quietly compare two different years' arithmetic.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  return handle(async (): Promise<RegisterComparison> => {
    const { documentId } = await params;
    const { document, lines } = await fetchMappedDocument(documentId);
    if (document.kind !== 'rendition')
      throw new HttpError(400, 'Only a rendition can be compared against the register.');

    const { engagement } = await fetchEngagement(document.engagementId);
    const db = requireDb();

    const rows = await db
      .select({ asset: schema.assetVersions, classification: schema.assetClassifications })
      .from(schema.assetVersions)
      .leftJoin(
        schema.assetClassifications,
        eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
      )
      .where(engagementAssetsWhere(document.engagementId));

    const assets: RegisterAsset[] = rows.map(({ asset, classification }) => ({
      id: asset.assetId,
      description: asset.description,
      acquisitionYear: asset.acquisitionYear,
      originalCost: asset.originalCost,
      isDisposed: asset.isDisposed,
      disposalDate: asset.disposalDate,
      categoryKey: classification?.categoryKey ?? null,
      lifeClassOverride: classification?.lifeClassOverride ?? null,
      status: (classification?.status as ClassificationStatus | undefined) ?? null,
    }));

    const taxYear = document.documentTaxYear ?? engagement.taxYear;
    const schedule = engagement.jurisdictionId
      ? (scheduleFor(engagement.jurisdictionId, taxYear) ?? null)
      : null;

    return compareRegister({
      taxYear,
      assets,
      lines: lines.map((line) => ({
        schedule: line.schedule,
        type: line.type,
        yearAcquired: line.yearAcquired,
        historicalCost: line.historicalCost,
        goodFaithEstimate: line.goodFaithEstimate,
        categoryKey: line.mapping.categoryKey,
        mappingStatus: line.mapping.status,
      })),
      schedule,
      businessSic: engagement.sicCode,
    });
  });
}
