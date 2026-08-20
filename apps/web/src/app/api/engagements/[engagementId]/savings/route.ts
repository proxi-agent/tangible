import { eq } from 'drizzle-orm';
import { getAccount } from '@tangible/analytics';
import { listAvailableYears } from '@tangible/ingest/catalog';
import { analyzeSavings, exemptionFor, type SavingsAsset } from '@tangible/savings';
import type { AssessedPosition, ClassificationStatus, SavingsReport } from '@tangible/types';
import { scheduleFor } from '@tangible/valuation';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { handle } from '@/lib/route';
import { getWarehouse } from '@/lib/warehouse';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The savings report, derived on read.
 *
 * Nothing here is stored: the report is a view of the classifications and the
 * published schedules at the moment it is asked for, so it cannot go stale
 * against the decisions it was built from. Settling one more row in the review
 * queue changes this number immediately, which is exactly the behaviour you
 * want from a document someone is about to put in front of a client.
 */

/**
 * The blended rate used to turn value into tax. A real figure per jurisdiction
 * lives in the warehouse; this is the fallback when that table has not been
 * populated, and it is a round approximation of a Harris County total levy.
 */
const FALLBACK_BLENDED_RATE = 0.025;

export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<SavingsReport> => {
    const { engagementId } = await params;
    const { engagement, client } = await fetchEngagement(engagementId);
    const db = requireDb();

    const rows = await db
      .select({ asset: schema.assetVersions, classification: schema.assetClassifications })
      .from(schema.assetVersions)
      .leftJoin(
        schema.assetClassifications,
        eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
      )
      .where(engagementAssetsWhere(engagementId));

    const assets: SavingsAsset[] = rows.map(({ asset, classification }) => ({
      id: asset.assetId,
      description: asset.description,
      acquisitionYear: asset.acquisitionYear,
      originalCost: asset.originalCost,
      isDisposed: asset.isDisposed,
      registerCategory: asset.category,
      categoryKey: classification?.categoryKey ?? null,
      lifeClassOverride: classification?.lifeClassOverride ?? null,
      status: (classification?.status as ClassificationStatus | undefined) ?? null,
    }));

    const schedule = engagement.jurisdictionId
      ? (scheduleFor(engagement.jurisdictionId, engagement.taxYear) ?? null)
      : null;

    const [assessed, blendedTaxRate] = await Promise.all([
      lookupAssessed(engagement.jurisdictionId, engagement.accountId, engagement.taxYear),
      lookupRate(engagement.jurisdictionId),
    ]);

    return analyzeSavings({
      engagementId,
      clientName: client.name,
      taxYear: engagement.taxYear,
      jurisdictionId: engagement.jurisdictionId,
      assets,
      schedule,
      assessed,
      blendedTaxRate,
      businessSic: engagement.sicCode,
      exemptionAmount: exemptionFor(engagement.jurisdictionId, engagement.taxYear),
      generatedAt: new Date().toISOString(),
    });
  });
}

/**
 * The client's current position on the public roll.
 *
 * Best-effort on purpose. The warehouse is a local DuckDB file that may hold no
 * years for this county, may be mid-ingest and locked, or may not exist at all
 * in a given deployment — and none of that should take down a report whose
 * other half is fully computable. A missing roll means the report says it has
 * no "before" rather than failing.
 */
async function lookupAssessed(
  jurisdictionId: string | null,
  accountId: string | null,
  taxYear: number,
): Promise<AssessedPosition | null> {
  if (!jurisdictionId || !accountId) return null;
  try {
    const warehouse = await getWarehouse();
    // The engagement is usually for a season the roll has not published yet —
    // a 2027 filing prepared in 2026 against a roll that ends at 2026. Asking
    // for a year the warehouse does not hold returns nothing, so fall back to
    // the most recent year it does and let the report label which year it
    // compared against.
    const years = await listAvailableYears(warehouse, jurisdictionId);
    if (years.length === 0) return null;
    const lookupYear = years.includes(taxYear) ? taxYear : Math.max(...years);
    const account = await getAccount(warehouse, jurisdictionId, lookupYear, accountId);
    if (!account) return null;
    // Prefer the engagement's own year; fall back to the most recent on the
    // roll, and say which — comparing a corrected 2027 position against a 2025
    // assessment without labelling the year would be quietly misleading.
    const year =
      account.history.find((point) => point.taxYear === taxYear) ?? account.history.at(-1);
    return {
      accountId: account.accountId,
      taxYear: year?.taxYear ?? taxYear,
      appraisedValue: year?.appraisedValue ?? null,
      assessedValue: year?.assessedValue ?? null,
      renditionFiled: year?.renditionFiled ?? null,
      ownerName: account.ownerName,
    };
  } catch (cause) {
    console.warn('[savings] roll lookup unavailable', cause);
    return null;
  }
}

async function lookupRate(jurisdictionId: string | null): Promise<number> {
  if (!jurisdictionId) return FALLBACK_BLENDED_RATE;
  try {
    const db = requireDb();
    const [row] = await db
      .select({ rate: schema.jurisdictions.blendedTaxRate })
      .from(schema.jurisdictions)
      .where(eq(schema.jurisdictions.id, jurisdictionId));
    return row?.rate ?? FALLBACK_BLENDED_RATE;
  } catch {
    return FALLBACK_BLENDED_RATE;
  }
}
