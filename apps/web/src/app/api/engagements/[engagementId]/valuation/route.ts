import { eq } from 'drizzle-orm';
import { classificationLabel, isExclusion, isValuable } from '@tangible/classification';
import type {
  CategoryValuation,
  ClassificationStatus,
  EngagementValuation,
  ValuationGap,
} from '@tangible/types';
import {
  appraise,
  CATEGORY_BY_KEY,
  lookupSicProfile,
  scheduleFor,
  type LifeClass,
} from '@tangible/valuation';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { handle } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The engagement run through the appraisal district's own arithmetic.
 *
 * Everything is derived on read — no stored totals — so this can never drift
 * from the classifications and schedules it came from. Three rules decide what
 * counts, and each of them is a refusal to flatter the number:
 *
 *   - an asset still queued for review is not priced, because a savings figure
 *     built on unreviewed guesses is the one number this product cannot afford
 *     to get wrong;
 *   - an asset with no cost or no year returns a typed gap rather than a zero,
 *     because zero would silently lower the total and look like good news;
 *   - disposed and excluded assets are reported separately rather than netted
 *     into a total, because they are the *findings*, and a finding folded into
 *     an average stops being one.
 */
export function GET(
  _request: Request,
  { params }: { params: Promise<{ engagementId: string }> },
): Promise<Response> {
  return handle(async (): Promise<EngagementValuation> => {
    const { engagementId } = await params;
    const { engagement } = await fetchEngagement(engagementId);

    const db = requireDb();
    const rows = await db
      .select({ asset: schema.assetVersions, classification: schema.assetClassifications })
      .from(schema.assetVersions)
      .leftJoin(
        schema.assetClassifications,
        eq(schema.assetClassifications.assetId, schema.assetVersions.assetId),
      )
      .where(engagementAssetsWhere(engagementId));

    const schedule = engagement.jurisdictionId
      ? scheduleFor(engagement.jurisdictionId, engagement.taxYear)
      : undefined;

    // Which line of business the machinery life came from, if any. Reported so
    // a reader can tell a published life from the placeholder standing in for
    // it — and so this card and the savings report say the same thing.
    const found =
      schedule && engagement.sicCode ? lookupSicProfile(schedule, engagement.sicCode) : null;

    const result: EngagementValuation = {
      jurisdictionId: engagement.jurisdictionId,
      taxYear: engagement.taxYear,
      sic: found
        ? {
            code: found.sic,
            description: found.profile.description,
            machineryLife: found.profile.machineryLife,
            defaultLife: CATEGORY_BY_KEY['machinery-equipment']?.schedule as number,
          }
        : null,
      schedule: schedule
        ? {
            taxYear: schedule.taxYear,
            title: schedule.source.title,
            url: schedule.source.url,
            pages: schedule.source.pages,
            isFallbackYear: schedule.taxYear !== engagement.taxYear,
          }
        : null,
      assetCount: rows.length,
      valuedCount: 0,
      needsReviewCount: 0,
      unclassifiedCount: 0,
      originalCost: 0,
      marketValue: 0,
      flooredCount: 0,
      flooredMarketValue: 0,
      disposedCount: 0,
      disposedOriginalCost: 0,
      excludedCount: 0,
      excludedOriginalCost: 0,
      byCategory: [],
      gaps: [],
    };

    const categories = new Map<string, CategoryValuation>();
    const gaps = new Map<string, ValuationGap>();

    const bucket = (key: string, kind: 'schedule' | 'exclusion'): CategoryValuation => {
      let entry = categories.get(key);
      if (!entry) {
        entry = {
          categoryKey: key,
          label: classificationLabel(key),
          kind,
          assetCount: 0,
          originalCost: 0,
          marketValue: 0,
          flooredCount: 0,
        };
        categories.set(key, entry);
      }
      return entry;
    };

    const noteGap = (reason: string, cost: number) => {
      const entry = gaps.get(reason) ?? { reason, count: 0, originalCost: 0 };
      entry.count += 1;
      entry.originalCost += cost;
      gaps.set(reason, entry);
    };

    for (const { asset, classification } of rows) {
      const cost = asset.originalCost ?? 0;

      // A register that still carries a disposed asset is the ghost-asset
      // finding, so it is counted and named rather than valued.
      if (asset.isDisposed) {
        result.disposedCount += 1;
        result.disposedOriginalCost += cost;
        continue;
      }

      if (!classification) {
        result.unclassifiedCount += 1;
        continue;
      }
      if (
        !isValuable({
          categoryKey: classification.categoryKey,
          status: classification.status as ClassificationStatus,
        })
      ) {
        result.needsReviewCount += 1;
        continue;
      }

      const categoryKey = classification.categoryKey!;
      if (isExclusion(categoryKey)) {
        const entry = bucket(categoryKey, 'exclusion');
        entry.assetCount += 1;
        entry.originalCost += cost;
        result.excludedCount += 1;
        result.excludedOriginalCost += cost;
        continue;
      }

      if (!schedule) {
        noteGap(
          engagement.jurisdictionId
            ? `No published schedule for ${engagement.jurisdictionId}`
            : 'This engagement has no jurisdiction set, so no schedule applies',
          cost,
        );
        continue;
      }

      const appraisal = appraise(
        {
          originalCost: asset.originalCost ?? Number.NaN,
          acquisitionYear: asset.acquisitionYear ?? Number.NaN,
          categoryKey,
          lifeClassOverride: (classification.lifeClassOverride ?? undefined) as
            LifeClass | undefined,
          // Texas keys the machinery life to what the business does, not to the
          // machine. Omitting this valued machinery on the category's ten-year
          // placeholder while the savings report used the SIC-derived life, so
          // the working view and the document handed to the client disagreed
          // about the same engagement by $108,178.
          businessSic: engagement.sicCode,
        },
        schedule,
      );

      if (!appraisal.ok) {
        noteGap(appraisal.gap.detail, cost);
        continue;
      }

      const entry = bucket(categoryKey, 'schedule');
      entry.assetCount += 1;
      entry.originalCost += cost;
      entry.marketValue += appraisal.value.marketValue;
      result.valuedCount += 1;
      result.originalCost += cost;
      result.marketValue += appraisal.value.marketValue;
      if (appraisal.value.atFloor) {
        entry.flooredCount += 1;
        result.flooredCount += 1;
        result.flooredMarketValue += appraisal.value.marketValue;
      }
    }

    // Largest first: the categories that decide the rendition lead the table.
    result.byCategory = [...categories.values()].sort((a, b) => b.originalCost - a.originalCost);
    result.gaps = [...gaps.values()].sort((a, b) => b.originalCost - a.originalCost);

    return result;
  });
}
