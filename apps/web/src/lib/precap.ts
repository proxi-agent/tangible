import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { aiUnavailableReason, classifyBatch, isAiConfigured } from '@tangible/ai';
import {
  bundledComponents,
  classificationLabel,
  classificationOptions,
  decideFromAi,
  decideFromMemory,
  decideUnclassifiable,
  fingerprint,
  hasSomethingToClassify,
  includedComponents,
  isExclusion,
  type Decision,
} from '@tangible/classification';
import type {
  AdviceLever,
  CapitalizationAdvice,
  CapitalizationAdviceRequest,
} from '@tangible/types';
import {
  LIFE_CLASSES,
  categoryFor,
  project,
  scheduleFor,
  type LifeClass,
} from '@tangible/valuation';
import { lookupRate } from '@/lib/analysis';
import { notFound } from '@/lib/http';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Advice on a purchase before it is booked.
 *
 * The doc calls this the pre-capitalization advisor and puts it past its own
 * horizon, and it is the one item out there that needs no data the product does
 * not already hold. Everything it runs on — the classification engine, the
 * district's published schedule, the blended rate — is what a savings report is
 * made of. The only difference is the direction: a report argues about a line
 * booked in 2019, and this answers the same question about a line somebody is
 * looking at right now, when changing the answer costs a coding decision rather
 * than an amended rendition and a protest.
 *
 * Three rules hold the whole thing together.
 *
 * Nothing is written. No asset, no finding, no classification row, and in
 * particular nothing written back to classification memory — a question about a
 * purchase that may never happen must not teach the engine anything, and a
 * hypothetical that quietly became a remembered decision would be the worst
 * kind of bug to find later.
 *
 * The classification is the engine's, not a second opinion. Memory first, then
 * the model, exactly as `runClassification` does it, because advice that
 * disagreed with what the register pipeline would say about the same wording is
 * worse than no advice.
 *
 * A lever that cannot be priced says so. The split lever is the valuable one
 * and it is unpriceable by construction — nobody knows what share of the
 * invoice is software until somebody reads the invoice — so it carries the
 * per-thousand rate instead of a total somebody would quote back to us.
 */

/** How close to year end before the January 1 question is worth raising. */
const YEAR_END_MONTH = 10;

interface Engagement {
  id: string;
  taxYear: number;
  jurisdictionId: string | null;
  sicCode: string | null;
}

async function loadEngagement(engagementId: string): Promise<Engagement> {
  const db = requireDb();
  const [row] = await db
    .select({
      id: schema.engagements.id,
      taxYear: schema.engagements.taxYear,
      jurisdictionId: schema.engagements.jurisdictionId,
      sicCode: schema.engagements.sicCode,
    })
    .from(schema.engagements)
    .where(eq(schema.engagements.id, engagementId));
  if (!row) notFound('No such engagement');
  return row;
}

/**
 * The engine's answer for one description, without recording anything.
 *
 * Memory is read across every engagement, the same as the register run: a
 * decision somebody made about "Dell Latitude 5540" last season is the right
 * answer for the one being quoted today, and it is free.
 */
async function classifyOne(input: {
  description: string;
  registerCategory: string | null;
  glAccount: string | null;
  usefulLife: number | null;
  acquisitionYear: number;
}): Promise<Decision> {
  const asInput = {
    description: input.description,
    registerCategory: input.registerCategory,
    glAccount: input.glAccount,
    usefulLife: input.usefulLife === null ? null : String(input.usefulLife),
  };
  if (!hasSomethingToClassify(asInput)) {
    return decideUnclassifiable('Nothing to classify on.');
  }

  const key = fingerprint(input.description);
  if (key) {
    const db = requireDb();
    const rows = await db
      .select()
      .from(schema.classificationMemory)
      .where(inArray(schema.classificationMemory.fingerprint, [key]));
    const remembered = rows[0];
    if (remembered) {
      return decideFromMemory({
        fingerprint: remembered.fingerprint,
        categoryKey: remembered.categoryKey,
        lifeClassOverride: remembered.lifeClassOverride,
        confirmations: remembered.confirmations,
        conflicted: remembered.conflicted,
        conflictingCategoryKey: remembered.conflictingCategoryKey,
        lastConfirmedAt: remembered.lastConfirmedAt,
      });
    }
  }

  if (!isAiConfigured()) {
    return decideUnclassifiable(
      `AI classification is off in this deployment. ${aiUnavailableReason()} A remembered decision about this exact wording would still have answered; there is none.`,
    );
  }

  const batch = await classifyBatch([
    {
      ref: 0,
      description: asInput.description,
      registerCategory: asInput.registerCategory,
      glAccount: asInput.glAccount,
      usefulLife: asInput.usefulLife,
      acquisitionYear: input.acquisitionYear,
    },
  ]);
  const answer = batch.answers[0];
  if (!answer) {
    return decideUnclassifiable('The model returned no answer for this description.');
  }
  return decideFromAi(answer, key);
}

const optionFor = (key: string | null) =>
  key === null ? undefined : classificationOptions().find((option) => option.key === key);

const isLifeClass = (life: number | null): life is LifeClass =>
  life !== null && (LIFE_CLASSES as readonly number[]).includes(life);

export async function adviseCapitalization(
  engagementId: string,
  request: CapitalizationAdviceRequest,
): Promise<CapitalizationAdvice> {
  const engagement = await loadEngagement(engagementId);
  const [decision, taxRate] = await Promise.all([
    classifyOne({
      description: request.description,
      registerCategory: request.registerCategory,
      glAccount: request.glAccount,
      usefulLife: request.usefulLife,
      acquisitionYear: request.acquisitionYear,
    }),
    lookupRate(engagement.jurisdictionId),
  ]);

  const categoryKey = decision.categoryKey;
  const excluded = isExclusion(categoryKey);
  const levers: AdviceLever[] = [];
  const caveats: string[] = [];

  // The schedule is looked up for the year the purchase will first be assessed
  // rather than for the engagement's season, because that is the table the
  // stream is actually read off. A district that has not published that year
  // yet falls back to its most recent, which `scheduleFor` does and the caveat
  // below reports.
  const firstAssessed = request.acquisitionYear + 1;
  const schedule = engagement.jurisdictionId
    ? scheduleFor(engagement.jurisdictionId, firstAssessed)
    : undefined;

  let stream: CapitalizationAdvice['stream'] = null;
  let gap: CapitalizationAdvice['gap'] = null;

  if (!engagement.jurisdictionId) {
    gap = {
      reason: 'no-schedule',
      detail:
        'This engagement names no county, so there is no published schedule to price against.',
    };
  } else if (!schedule) {
    gap = {
      reason: 'no-schedule',
      detail: `No depreciation schedule is loaded for ${engagement.jurisdictionId}, so this purchase cannot be priced.`,
    };
  } else if (excluded) {
    // Not a gap. The answer is that the district never values this, which is
    // the most valuable answer the advisor can give and would be thrown away by
    // reporting it as something that could not be computed.
    const option = optionFor(categoryKey);
    levers.push({
      kind: 'exclusion',
      title: 'Not taxable personal property at all',
      detail: `Coded this way the purchase never reaches a rendition, so it is assessed nothing in any year. That holds only if the coding survives the district's questions, which is what the basis below is for.`,
      worth: null,
      basis: option?.description ?? null,
    });
  } else if (categoryKey === null) {
    gap = {
      reason: 'unknown-category',
      detail: decision.rationale,
    };
  } else {
    const projected = project(
      {
        originalCost: request.cost,
        acquisitionYear: request.acquisitionYear,
        categoryKey,
        ...(isLifeClass(decision.lifeClassOverride)
          ? { lifeClassOverride: decision.lifeClassOverride }
          : {}),
        businessSic: engagement.sicCode,
      },
      schedule,
      taxRate,
    );

    if (!projected.ok) {
      gap = { reason: projected.gap.reason, detail: projected.gap.detail };
    } else {
      const value = projected.value;
      stream = {
        firstTaxYear: value.firstTaxYear,
        years: value.years,
        lifetimeTax: value.lifetimeTax,
        firstYearTax: value.firstYearTax,
        perThousand: value.perThousand,
        truncated: value.truncated,
      };

      // --- the split lever ------------------------------------------------
      const bundled = bundledComponents(request.description);
      for (const signal of bundled) {
        levers.push({
          kind: 'split',
          title: `Split the ${signal.phrase} onto its own line`,
          detail: `This description mentions ${signal.phrase}, which belongs in "${signal.label}" and is assessed nothing. Nobody knows the split until the invoice is read, so the number to carry into that conversation is the rate: every $1,000 left on the equipment line costs ${value.perThousand.toFixed(2)} dollars in property tax over the asset's assessed life.`,
          worth: null,
          basis: signal.basis,
        });
      }

      // --- the life lever ---------------------------------------------------
      // Only where the district reads the life off the taxpayer's line of
      // business, because that is the one case where the same machine on two
      // registers is two different numbers.
      const category = categoryFor(schedule, categoryKey);
      if (category?.sicDriven && !engagement.sicCode) {
        levers.push({
          kind: 'life',
          title: 'The county has not been told what this business does',
          detail: `${schedule.jurisdictionName} sets the life for this category from the taxpayer's SIC code, and this engagement carries none — so the stream above is the category default. Setting the SIC on the engagement reprices every machinery purchase, this one included.`,
          worth: null,
          basis: null,
        });
      } else if (value.first.sicProfile && value.first.lifeSource === 'sic') {
        const asDefault = project(
          {
            originalCost: request.cost,
            acquisitionYear: request.acquisitionYear,
            categoryKey,
            lifeClassOverride: value.first.sicProfile.defaultLife,
            businessSic: engagement.sicCode,
          },
          schedule,
          taxRate,
        );
        if (asDefault.ok) {
          const difference = asDefault.value.lifetimeTax - value.lifetimeTax;
          if (Math.abs(difference) > 1) {
            levers.push({
              kind: 'life',
              title:
                difference > 0
                  ? "The line of business already works in this purchase's favour"
                  : 'The line of business costs more here than the category default',
              detail: `${schedule.jurisdictionName} depreciates this category on the taxpayer's SIC — ${value.first.sicProfile.sic}, ${value.first.sicProfile.description} — which is a ${String(value.first.schedule)}-year life rather than the category's ${value.first.sicProfile.defaultLife}. Over the stream that is a difference of ${Math.abs(difference).toFixed(0)} dollars, ${difference > 0 ? 'in the client’s favour' : 'against them'}.`,
              worth: difference > 0 ? difference : null,
              basis: `${schedule.source.title}, pages ${schedule.source.pages}`,
            });
          }
        }
      }

      // --- the timing lever -------------------------------------------------
      // Business personal property is assessed on what was owned on January 1,
      // which the schedules themselves encode: the youngest row any of them
      // publishes is age one. So a purchase in December and the same purchase in
      // January are one whole assessment apart, and the one removed is the
      // first — the largest year in the stream.
      const month = request.acquisitionMonth;
      if (month !== null && month >= YEAR_END_MONTH) {
        levers.push({
          kind: 'timing',
          title: `Placing it in service after January 1 removes one assessment`,
          detail: `Property is assessed on what was owned on January 1, so a purchase in month ${month} of ${request.acquisitionYear} is first rendered for ${value.firstTaxYear}. Moving it across the year end removes exactly one January from the ownership span, and it is the first and largest one. The rest of the stream is unchanged, a calendar year later.`,
          worth: value.firstYearTax,
          basis: null,
        });
      }

      if (value.truncated) {
        caveats.push(
          'The schedule never reaches a floor for this class, so the stream stops at the projection horizon rather than at the end of the asset’s assessed life. The lifetime figure is a floor, not a total.',
        );
      }
      if (schedule.taxYear !== firstAssessed) {
        caveats.push(
          `${schedule.jurisdictionName} has not published a schedule for ${firstAssessed}, so this is priced on its ${schedule.taxYear} tables. Index factors drift a point or two a year; the shape of the stream does not.`,
        );
      }
      caveats.push(
        `Priced at a blended rate of ${(taxRate * 100).toFixed(2)}% and on the assumption that the district republishes tables of the same shape. This is an estimate for a coding decision, not a quotation.`,
      );
    }
  }

  const included = includedComponents(request.description);

  if (categoryKey !== null && decision.source === 'ai') {
    caveats.push(
      'The category here is the model’s, not a person’s. It is the same answer the register pipeline would give the same wording, and on a purchase this size it is worth a look before anybody codes to it.',
    );
  }

  return {
    engagementId: engagement.id,
    jurisdictionId: engagement.jurisdictionId,
    jurisdictionName: schedule?.jurisdictionName ?? null,
    scheduleTaxYear: schedule?.taxYear ?? null,
    taxRate,
    classification: {
      categoryKey,
      label: categoryKey ? classificationLabel(categoryKey) : 'Not classified',
      // An unclassifiable answer comes back through the same shape as a model
      // answer — it *is* the model layer declining — so the wire reports the
      // absence of a category rather than the source that failed to produce one.
      source: categoryKey === null ? 'none' : decision.source === 'memory' ? 'memory' : 'ai',
      confidence: categoryKey === null ? null : decision.confidence,
      rationale: decision.rationale,
      excluded,
    },
    stream,
    gap,
    levers,
    included,
    caveats,
  };
}
