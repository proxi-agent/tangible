import { isExclusion, isValuable } from '@tangible/classification';
import type {
  AssessedPosition,
  ClassificationStatus,
  FindingEvidence,
  LeakageJurisdiction,
  SavingsCoverage,
  SavingsFinding,
  SavingsReport,
} from '@tangible/types';
import {
  appraise,
  CATEGORY_BY_KEY,
  lookupSicProfile,
  type DepreciationSchedule,
  type LifeClass,
} from '@tangible/valuation';

/**
 * Turn a classified register into a report a client can act on.
 *
 * Pure: assets in, findings out. No database, no network, no clock — the
 * caller passes `generatedAt`. That is deliberate, because this is the code
 * that produces the number in the pitch, and a number in a pitch has to be
 * reproducible from its inputs and testable without standing anything up.
 */

export interface SavingsAsset {
  id: string;
  description: string | null;
  acquisitionYear: number | null;
  originalCost: number | null;
  isDisposed: boolean;
  /** The register's own label, used only to explain findings, never to value. */
  registerCategory: string | null;
  categoryKey: string | null;
  lifeClassOverride: number | null;
  /** Null when the asset has no classification row at all. */
  status: ClassificationStatus | null;
  /**
   * Where the asset is placed, for the per-jurisdiction leakage rollup.
   * Optional so the engine stays callable from tests and callers that do not
   * track situs; null or absent means "not placed at a site", which is its own
   * honest bucket rather than a guess.
   */
  site?: { label: string; jurisdictionId: string | null; jurisdictionName: string | null } | null;
}

export interface SavingsInput {
  engagementId: string;
  clientName: string;
  taxYear: number;
  jurisdictionId: string | null;
  assets: SavingsAsset[];
  schedule: DepreciationSchedule | null;
  assessed: AssessedPosition | null;
  /**
   * The taxpayer's SIC code, which decides the machinery life. Resolved by the
   * caller so the report can say where it came from — the engagement, the roll,
   * or nowhere.
   */
  businessSic: string | null;
  blendedTaxRate: number;
  exemptionAmount: number;
  generatedAt: string;
}

/**
 * The schedule an excluded asset would have been valued on had it been
 * rendered — needed to say what removing it is worth, and unknowable exactly,
 * because we are describing a rendition the client has not shown us.
 *
 * Ten-year indexed machinery is the reference because it is where a preparer
 * without a classification step puts everything: it is the district's own
 * general default and the single most common bucket on a filed rendition. The
 * finding built on it is labelled `modeled` and states this, so a reader can
 * disagree with the assumption rather than the arithmetic.
 */
const REFERENCE_CATEGORY = 'machinery-equipment';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

function scheduleValue(
  asset: SavingsAsset,
  schedule: DepreciationSchedule,
  categoryKey: string,
  businessSic: string | null,
): number | null {
  const result = appraise(
    {
      originalCost: asset.originalCost ?? Number.NaN,
      acquisitionYear: asset.acquisitionYear ?? Number.NaN,
      categoryKey,
      lifeClassOverride: (asset.lifeClassOverride ?? undefined) as LifeClass | undefined,
      businessSic,
    },
    schedule,
  );
  return result.ok ? result.value.marketValue : null;
}

function evidenceFor(asset: SavingsAsset, value: number | null): FindingEvidence {
  return {
    assetId: asset.id,
    description: asset.description,
    acquisitionYear: asset.acquisitionYear,
    originalCost: asset.originalCost,
    scheduleValue: value,
    categoryKey: asset.categoryKey,
  };
}

/**
 * The identity fingerprint, folded the way `@tangible/graph` folds it: case,
 * whitespace and punctuation are export noise, a model number is signal. Two
 * settled lines sharing description, cost and acquisition year are either a
 * genuine multiple purchase or the same asset capitalized twice — and the
 * register alone cannot say which, which is what makes the finding built on
 * this a screening question rather than a priced adjustment.
 */
function duplicateKey(asset: SavingsAsset): string | null {
  const description = asset.description?.trim();
  if (!description || !asset.originalCost) return null;
  const folded = description
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!folded) return null;
  return `${folded}|${Math.round(asset.originalCost * 100)}|${asset.acquisitionYear ?? '~'}`;
}

/** Biggest first, and capped: a report is read, not scrolled. */
const EVIDENCE_SHOWN = 25;
const byCost = (a: FindingEvidence, b: FindingEvidence) =>
  (b.originalCost ?? 0) - (a.originalCost ?? 0);

export function analyzeSavings(input: SavingsInput): SavingsReport {
  const { schedule } = input;
  const settled = (a: SavingsAsset) =>
    a.status !== null && isValuable({ categoryKey: a.categoryKey, status: a.status });

  const coverage: SavingsCoverage = {
    assetCount: input.assets.length,
    valuedCount: 0,
    inFindingsCount: 0,
    needsReviewCount: 0,
    unclassifiedCount: 0,
    unvaluableCount: 0,
  };

  // --- The corrected position: settled, in-service, taxable property --------
  let farImpliedValue = 0;
  let farOriginalCost = 0;

  const ghosts: FindingEvidence[] = [];
  const excluded: FindingEvidence[] = [];
  const floored: FindingEvidence[] = [];
  const leasehold: FindingEvidence[] = [];
  const inventory: FindingEvidence[] = [];

  // The per-jurisdiction leakage rollup, accumulated in the same walk as the
  // findings so the split can never disagree with them. Evidence lists are
  // capped for reading; this is the only place the full per-asset attribution
  // exists, which is why the rollup is computed here and not in a view.
  const byJurisdiction = new Map<
    string,
    LeakageJurisdiction & { siteSet: Set<string>; leadKeys: Set<string> }
  >();
  const tally = (
    asset: SavingsAsset,
    patch: { measured?: number; modeled?: number; lead?: { key: string; cost: number } },
  ) => {
    const key = asset.site?.jurisdictionId ?? '(unplaced)';
    let row = byJurisdiction.get(key);
    if (!row) {
      row = {
        jurisdictionId: asset.site?.jurisdictionId ?? null,
        jurisdictionName: asset.site?.jurisdictionName ?? null,
        siteLabels: [],
        measuredValue: 0,
        modeledValue: 0,
        leadCount: 0,
        leadCost: 0,
        siteSet: new Set(),
        leadKeys: new Set(),
      };
      byJurisdiction.set(key, row);
    }
    if (asset.site) row.siteSet.add(asset.site.label);
    row.measuredValue += patch.measured ?? 0;
    row.modeledValue += patch.modeled ?? 0;
    if (patch.lead) {
      row.leadKeys.add(patch.lead.key);
      row.leadCost += patch.lead.cost;
    }
  };

  let ghostValue = 0;
  let excludedValue = 0;
  let ghostCost = 0;
  let excludedCost = 0;
  let flooredCost = 0;
  let flooredValue = 0;
  let leaseholdValue = 0;
  let leaseholdCost = 0;
  let inventoryCost = 0;

  // Valued lines grouped by identity fingerprint, for the duplicate check.
  // Only lines that made the corrected position: a duplicate among disposed or
  // excluded rows is already coming off the rendition for its own reason.
  const dupCandidates = new Map<string, { asset: SavingsAsset; value: number }[]>();

  for (const asset of input.assets) {
    if (asset.status === null) {
      coverage.unclassifiedCount += 1;
      continue;
    }
    if (!settled(asset)) {
      coverage.needsReviewCount += 1;
      continue;
    }

    const cost = asset.originalCost ?? 0;
    const key = asset.categoryKey!;

    // A disposed asset is valued on its *own* classification, not a reference:
    // it was real property of a real class until it left, so what it would
    // carry if still rendered is a computed number rather than an assumption.
    if (asset.isDisposed) {
      const value = schedule
        ? isExclusion(key)
          ? scheduleValue(asset, schedule, REFERENCE_CATEGORY, input.businessSic)
          : scheduleValue(asset, schedule, key, input.businessSic)
        : null;
      ghosts.push(evidenceFor(asset, value));
      ghostCost += cost;
      ghostValue += value ?? 0;
      tally(asset, { measured: value ?? 0 });
      coverage.inFindingsCount += 1;
      continue;
    }

    if (isExclusion(key)) {
      const value = schedule
        ? scheduleValue(asset, schedule, REFERENCE_CATEGORY, input.businessSic)
        : null;
      excluded.push(evidenceFor(asset, value));
      excludedCost += cost;
      excludedValue += value ?? 0;
      tally(asset, { modeled: value ?? 0 });
      coverage.inFindingsCount += 1;
      continue;
    }

    if (!schedule) {
      coverage.unvaluableCount += 1;
      continue;
    }

    const result = appraise(
      {
        originalCost: asset.originalCost ?? Number.NaN,
        acquisitionYear: asset.acquisitionYear ?? Number.NaN,
        categoryKey: key,
        lifeClassOverride: (asset.lifeClassOverride ?? undefined) as LifeClass | undefined,
        businessSic: input.businessSic,
      },
      schedule,
    );
    if (!result.ok) {
      coverage.unvaluableCount += 1;
      continue;
    }

    coverage.valuedCount += 1;
    farOriginalCost += cost;
    farImpliedValue += result.value.marketValue;

    if (result.value.atFloor) {
      floored.push(evidenceFor(asset, result.value.marketValue));
      flooredCost += cost;
      flooredValue += result.value.marketValue;
      tally(asset, { lead: { key: 'fully-depreciated', cost } });
    }
    if (key === 'leasehold-improvements') {
      leasehold.push(evidenceFor(asset, result.value.marketValue));
      leaseholdCost += cost;
      leaseholdValue += result.value.marketValue;
      tally(asset, { lead: { key: 'leasehold-double-tax', cost } });
    }
    if (key === 'inventory') {
      inventory.push(evidenceFor(asset, result.value.marketValue));
      inventoryCost += cost;
      tally(asset, { lead: { key: 'freeport', cost } });
    }

    const fingerprint = duplicateKey(asset);
    if (fingerprint) {
      const group = dupCandidates.get(fingerprint) ?? [];
      group.push({ asset, value: result.value.marketValue });
      dupCandidates.set(fingerprint, group);
    }
  }

  // --- Duplicate capitalization: groups of identical valued lines -----------
  // The excess is everything past one copy per group — what the rendition
  // carries twice if each group turns out to be one asset entered repeatedly.
  const dupGroups = [...dupCandidates.values()].filter((group) => group.length > 1);
  const dupEvidence: FindingEvidence[] = [];
  let dupCost = 0;
  let dupExcessCost = 0;
  let dupExcessValue = 0;
  for (const group of dupGroups) {
    group.forEach(({ asset, value }, index) => {
      dupEvidence.push(evidenceFor(asset, value));
      dupCost += asset.originalCost ?? 0;
      if (index > 0) {
        dupExcessCost += asset.originalCost ?? 0;
        dupExcessValue += value;
      }
      tally(asset, {
        lead: { key: 'duplicate-capitalization', cost: asset.originalCost ?? 0 },
      });
    });
  }

  // Which line of business the machinery life came from, if any. Reported so a
  // reader can tell a published life from the placeholder that stands in for it.
  const found =
    schedule && input.businessSic ? lookupSicProfile(schedule, input.businessSic) : null;
  const resolvedSic = found
    ? {
        code: found.sic,
        description: found.profile.description,
        machineryLife: found.profile.machineryLife,
        defaultLife: CATEGORY_BY_KEY['machinery-equipment']?.schedule as number,
      }
    : null;

  // --- Findings ------------------------------------------------------------
  const findings: SavingsFinding[] = [];

  if (ghosts.length > 0) {
    findings.push({
      key: 'ghost-assets',
      title: 'Disposed assets still on the register',
      kind: 'measured',
      valueRemoved: ghostValue,
      originalCost: ghostCost,
      assetCount: ghosts.length,
      summary: `${ghosts.length} asset${ghosts.length === 1 ? '' : 's'} the register marks as sold, scrapped, or retired ${ghosts.length === 1 ? 'is' : 'are'} still listed, carrying ${money(ghostCost)} of original cost. Valued on their own schedules they would add ${money(ghostValue)} to the rendition.`,
      basis:
        'Only property owned and in place on January 1 is renderable. A disposal recorded in the fixed asset register is the evidence, and this is the least arguable adjustment on the list.',
      assumption: null,
      evidence: ghosts.sort(byCost).slice(0, EVIDENCE_SHOWN),
    });
  }

  if (excluded.length > 0) {
    findings.push({
      key: 'non-taxable',
      title: 'Property that does not belong on this rendition',
      kind: 'modeled',
      valueRemoved: excludedValue,
      originalCost: excludedCost,
      assetCount: excluded.length,
      summary: `${money(excludedCost)} of cost across ${excluded.length} line${excluded.length === 1 ? '' : 's'} is not the client's taxable tangible personal property — software and capitalized implementation, real property carried in the register, or equipment leased in from a lessor who renders it themselves.`,
      basis:
        'Texas ad valorem tax reaches tangible personal property (Tax Code 11.02). Real property is appraised on its own account; a lessor renders what it owns. These lines are in the register because it is a book record kept for depreciation, not a tax schedule.',
      assumption: `Value shown is what these would carry if rendered as ten-year machinery — the district's general default and where a rendition without a classification step puts everything. If the client rendered them on a shorter life, the saving is smaller.`,
      evidence: excluded.sort(byCost).slice(0, EVIDENCE_SHOWN),
    });
  }

  if (floored.length > 0) {
    findings.push({
      key: 'fully-depreciated',
      title: 'Assets already at the schedule floor',
      kind: 'screening',
      valueRemoved: null,
      originalCost: flooredCost,
      assetCount: floored.length,
      summary: `${floored.length} asset${floored.length === 1 ? '' : 's'} older than the published schedule carr${floored.length === 1 ? 'ies' : 'y'} ${money(flooredCost)} of original cost but only ${money(flooredValue)} of schedule value — the district's own tables treat them as fully depreciated.`,
      basis:
        'Each life class stops depreciating at a floor. An asset past the last published year sits at that floor however old it is, which is a much smaller number than cost.',
      assumption: `Worth money only if the client is rendering these above the floor. Ask for last year's rendition to find out — the gap would be up to ${money(flooredCost - flooredValue)} of value.`,
      evidence: floored.sort(byCost).slice(0, EVIDENCE_SHOWN),
    });
  }

  if (leasehold.length > 0) {
    findings.push({
      key: 'leasehold-double-tax',
      title: 'Leasehold improvements possibly taxed twice',
      kind: 'screening',
      valueRemoved: null,
      originalCost: leaseholdCost,
      assetCount: leasehold.length,
      summary: `${money(leaseholdCost)} of tenant build-out is carried as personal property, worth ${money(leaseholdValue)} on the schedules. If the landlord's real property was appraised by a method that already reflects these improvements, they are being taxed twice.`,
      basis:
        'Tax Code 23.24 bars appraising an improvement as personal property when the real property assessment already includes it.',
      assumption:
        "Settled by pulling the landlord's real property account and its appraisal method. Worth doing: this is usually the second-largest line after ghost assets, and it recurs every year it goes unchallenged.",
      evidence: leasehold.sort(byCost).slice(0, EVIDENCE_SHOWN),
    });
  }

  if (inventory.length > 0) {
    findings.push({
      key: 'freeport',
      title: 'Freeport exemption on inventory',
      kind: 'screening',
      valueRemoved: null,
      originalCost: inventoryCost,
      assetCount: inventory.length,
      summary: `${money(inventoryCost)} of inventory is rendered at full cost. Any of it that leaves Texas within 175 days of acquisition is exempt — and the exemption is claimed, not granted automatically.`,
      basis:
        'Tax Code 11.251 exempts goods detained in Texas for 175 days or less for assembly, storage, manufacturing, or fabrication before moving out of state. Application is annual, and a late application still captures part of the benefit.',
      assumption:
        'Settled by asking one question: what share of inventory ships out of state, and how fast? A shipping report answers it.',
      evidence: inventory.sort(byCost).slice(0, EVIDENCE_SHOWN),
    });
  }

  if (dupGroups.length > 0) {
    findings.push({
      key: 'duplicate-capitalization',
      title: 'Possibly the same asset capitalized twice',
      kind: 'screening',
      valueRemoved: null,
      originalCost: dupCost,
      assetCount: dupEvidence.length,
      summary: `${dupGroups.length} group${dupGroups.length === 1 ? '' : 's'} of identical lines — same description, cost, and acquisition year — carr${dupGroups.length === 1 ? 'ies' : 'y'} ${money(dupCost)} of cost across ${dupEvidence.length} rows. If each group is one asset entered more than once, ${money(dupExcessCost)} of cost, about ${money(dupExcessValue)} of schedule value, is on the rendition twice.`,
      basis:
        'A project capitalized once as a total and again as its components, or a batch imported twice, puts the same property on the rendition more than once — and the district values every line it is given. The register alone cannot tell a double entry from a genuine multiple purchase; identity is exactly what an invoice adds.',
      assumption:
        'Ten identical desks on one purchase order are ten real assets; one lathe entered by two teams is one. The purchase order or invoice behind each group settles it, line by line.',
      evidence: dupEvidence.sort(byCost).slice(0, EVIDENCE_SHOWN),
    });
  }

  // Only measured and modeled findings carry a number into the total. A
  // screening finding is a question, and a question is not a saving.
  const totalValueRemoved = findings.reduce((sum, f) => sum + (f.valueRemoved ?? 0), 0);

  // The headline is derived from the findings list itself so the three numbers
  // can never drift from the rows printed beneath them.
  const sumKind = (kind: SavingsFinding['kind']) =>
    findings.filter((f) => f.kind === kind).reduce((sum, f) => sum + (f.valueRemoved ?? 0), 0);
  const screeningFindings = findings.filter((f) => f.kind === 'screening');
  const leakage = {
    measuredValue: sumKind('measured'),
    modeledValue: sumKind('modeled'),
    leadCount: screeningFindings.length,
    leadCost: screeningFindings.reduce((sum, f) => sum + f.originalCost, 0),
    byJurisdiction: [...byJurisdiction.values()]
      .map(({ siteSet, leadKeys, ...row }) => ({
        ...row,
        siteLabels: [...siteSet].sort(),
        leadCount: leadKeys.size,
      }))
      .sort(
        (a, b) =>
          b.measuredValue + b.modeledValue - (a.measuredValue + a.modeledValue) ||
          b.leadCost - a.leadCost,
      ),
  };

  const applied = Math.min(input.exemptionAmount, farImpliedValue);
  const proposedTaxableValue = Math.max(0, farImpliedValue - applied);
  const proposedTax = proposedTaxableValue * input.blendedTaxRate;

  const assessedValue = input.assessed?.appraisedValue ?? input.assessed?.assessedValue ?? null;
  const valueReduction = assessedValue === null ? null : assessedValue - proposedTaxableValue;
  const estimatedAnnualSaving =
    valueReduction === null ? null : valueReduction * input.blendedTaxRate;

  return {
    engagementId: input.engagementId,
    clientName: input.clientName,
    taxYear: input.taxYear,
    jurisdictionId: input.jurisdictionId,
    jurisdictionName: schedule?.jurisdictionName ?? null,
    generatedAt: input.generatedAt,
    schedule: schedule
      ? {
          taxYear: schedule.taxYear,
          title: schedule.source.title,
          url: schedule.source.url,
          pages: schedule.source.pages,
          isFallbackYear: schedule.taxYear !== input.taxYear,
        }
      : null,
    assessed: input.assessed,
    sic: resolvedSic,
    farImpliedValue,
    farOriginalCost,
    findings,
    totalValueRemoved,
    leakage,
    exemption: {
      label: 'Business personal property exemption',
      basis: 'Texas Tax Code 11.145, as raised by HB 9 (2025) and Proposition 9, effective 2026.',
      amount: input.exemptionAmount,
      applied,
      caveat:
        'Granted per taxing unit against that unit’s own levy; applied once here against a blended rate, which understates it slightly. Verify the current amount before this reaches a client.',
    },
    proposedTaxableValue,
    blendedTaxRate: input.blendedTaxRate,
    proposedTax,
    valueReduction,
    estimatedAnnualSaving,
    coverage,
  };
}
