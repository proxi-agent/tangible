import { classificationLabel, isExclusion, isValuable } from '@tangible/classification';
import { evidenceSignals, type EvidenceResult } from '@tangible/evidence';
import type {
  AssessedPosition,
  ClassificationStatus,
  DetectionBasis,
  DetectionSignal,
  FindingEvidence,
  FindingRow,
  LeakageJurisdiction,
  RateBasis,
  SavingsCoverage,
  SavingsFinding,
  SavingsReport,
  TaxChain,
} from '@tangible/types';
import {
  appraise,
  CATEGORY_BY_KEY,
  lookupSicProfile,
  taxForAccount,
  type AccountRate,
  type Appraisal,
  type DepreciationSchedule,
  type LifeClass,
} from '@tangible/valuation';
import { confidenceFor, signal } from './confidence.js';
import { modelScore, type DetectionModelFit } from './model.js';
import { liftFor, type SignalLift } from './signal-acceptance.js';
import {
  carryForwardPlans,
  classLife,
  deMinimisGroups,
  fuzzyDuplicatePlans,
  idlePlans,
  leasedPlans,
  misclassificationPlans,
  nonAssessablePlans,
  purchaseSiblings,
  retirementDiscipline,
  situsPlans,
  suspectedRetiredPlans,
  type Candidate,
  type DetectorContext,
  type InvoiceSplit,
  type PriorFiling,
  type RowPlan,
} from './detectors.js';
import {
  basisFromBlendedRate,
  chainFrom,
  expectedRecovery,
  recoveryModel,
  recoverySignal,
  removedChain,
  type AcceptanceEvidenceLine,
} from './recovery.js';
import { foldLocation } from './signals.js';

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
  /** The register's own identifier for the row, for evidence a client can check. */
  assetTag?: string | null;
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
  /** The site row itself, so a client can filter their own report by location. */
  locationId?: string | null;
  /**
   * The rest of the register's own row, carried for two jobs: filtering (a
   * controller wants their Houston plant, or one cost centre) and corroboration
   * (a serial number is the difference between "two identical lines" and "two
   * identical machines"). Every one of these already lands in `asset_versions`
   * on import — none of them is new plumbing, and all of them are optional here
   * so the engine stays callable from a test with four fields.
   */
  disposalDate?: string | null;
  serialNumber?: string | null;
  vendor?: string | null;
  glAccount?: string | null;
  /** The register's own cost centre — `department` on the imported row. */
  costCenter?: string | null;
  /** What the classifier scored, and which of the four routes decided it. */
  classificationConfidence?: number | null;
  classificationSource?: string | null;

  /**
   * The rest of the imported row, read by the cross-asset detectors in
   * `detectors.ts` and by nothing else.
   *
   * All of it already lands in `asset_versions` and none of it has ever been
   * looked at: the register's own book life is what tells us the client thinks
   * a thing is five-year property while we render it over fifteen; a net book
   * value written down early is an impairment; a free-text location is the only
   * thing on the row that knows the asset moved. Optional, because every one of
   * them is missing from some real register, and a detector that needs one
   * simply does not fire on that client.
   */
  registerLife?: string | null;
  netBookValue?: number | null;
  accumulatedDepreciation?: number | null;
  /** The register's own location text, which is not the same as a placed site. */
  registerLocation?: string | null;
  /** The full date, where the register gives one — the year is too coarse for
   *  a duplicate window or a lien-date question. */
  acquisitionDate?: string | null;
  depreciationMethod?: string | null;
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
  /**
   * The taxing units that actually levy on this engagement's accounts, with the
   * share of value each one taxes and the rate it adopted.
   *
   * Optional. Without it the report runs on `blendedTaxRate` — the
   * jurisdiction's single county-wide constant — and says so on its face. With
   * it the report prices off the account's own units, which is both a truer
   * rate and the only way to grant the exemption the way the statute does:
   * separately, by each unit, against its own levy.
   *
   * It also carries the assessment ratio, which is 1 in Texas and 0.15 the
   * moment a Louisiana register lands; a report that folded the two into one
   * number would be out by nearly seven times, in the direction that overstates
   * the saving.
   *
   * Where its `taxYear` differs from the year being reported, the caller priced
   * against the most recent adopted table because the reported year's had not
   * been adopted yet, and the report says so rather than presenting a borrowed
   * year as this year's.
   */
  accountRate?: AccountRate;
  exemptionAmount: number;
  /**
   * How many times the exemption is granted in each taxing unit, by unit code.
   * One where a unit is not named, which is the ordinary single-site case.
   *
   * 11.145(c) grants the exemption to each separate location in a unit, so a
   * client with four Houston sites claims it four times against Houston ISD.
   * Only counted for locations the caller could actually place in a unit;
   * omitting a location it could not place leaves the exemption smaller than
   * the client is entitled to, which is the direction that understates the
   * client's position rather than overstating it.
   */
  exemptionGrants?: Readonly<Record<string, number>>;
  /**
   * The sites the client says they operate, folded. A register location that
   * matches none of them is the closest this product gets to knowing an asset
   * sits at a closed plant.
   */
  knownLocations?: string[];
  /** Last year's return as filed, for the carry-forward comparison. */
  priorFiling?: PriorFiling | null;
  /** What reading the invoices behind capitalized lines turned up. */
  invoiceSplits?: InvoiceSplit[];
  /**
   * The firm's own acceptance rates, once it has enough closed engagements to
   * have them. Absent, the report says plainly that the built-in numbers are
   * judgement rather than measurement.
   */
  acceptanceOverrides?: Record<string, number>;
  /**
   * How each of those rates was arrived at. Carried separately from the rates
   * themselves because it is reporting rather than arithmetic: nothing in the
   * engine reads it, and the report prints it so that a rate learned from six
   * closed positions cannot be mistaken for one learned from sixty.
   */
  acceptanceEvidence?: AcceptanceEvidenceLine[];
  /**
   * What each piece of evidence turned out to be worth to a district, measured
   * on the firm's closed positions. See `signal-acceptance.ts`.
   *
   * A plain array rather than a prepared lookup, deliberately: this input is
   * checkpointed and replayed, and a `Map` survives neither. The lookup is
   * rebuilt per row, which is a filter over a list a dozen long.
   */
  signalLifts?: SignalLift[];
  /**
   * Coefficients fitted from the firm's own decisions, for the findings that
   * have enough of them.
   *
   * Absent is the normal state and the honest one: with no adopted model every
   * row is scored by the authored weights, exactly as it was, and each row says
   * so in `confidence.basis`. Passed in rather than fitted here because fitting
   * needs every decision the firm has ever made — across clients, across
   * seasons — and this function is given one engagement.
   */
  model?: DetectionModelFit | null;
  /**
   * What the client's other systems say about these assets, already matched.
   *
   * One result per asset that any source had something to say about, produced
   * by `@tangible/evidence` from exports the firm collected — a maintenance
   * system, an asset-management tool, an insurance schedule, a lease
   * subledger, the real property record. Matched outside this function because
   * matching is expensive, is worth caching against the register, and is the
   * kind of thing a person needs to be able to inspect before it moves a
   * number.
   *
   * These are the first signals in the product capable of *clearing* an asset,
   * and they arrive at the row builder rather than at the detectors on
   * purpose: what a work order is worth depends on the finding being argued,
   * not on which rule raised it, and a detector that appended its own would
   * eventually append them differently.
   */
  evidence?: EvidenceResult[];
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

/**
 * The whole appraisal rather than its last number.
 *
 * It used to return the market value alone, which was enough while the report
 * printed one figure per row. It is not enough now: the chain a row prints —
 * cost, index factor, percent good, market value, ratio, millage, tax — is
 * exactly the intermediate steps that were being thrown away here.
 */
function appraiseAs(
  asset: SavingsAsset,
  schedule: DepreciationSchedule,
  categoryKey: string,
  businessSic: string | null,
): Appraisal | null {
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
  return result.ok ? result.value : null;
}

/**
 * One asset under one finding, priced.
 *
 * The report used to stop at the category: a client was told $410,000 of
 * disposed assets and shown twenty-five of them, with no way to accept some and
 * argue about the rest. Everything a reviewer needs to do that is per-asset —
 * what this row is presumed to carry today, what it should carry, what the
 * difference is worth, and how sure we are — so the row is where it now lives,
 * and the category total is the sum of its rows rather than a parallel figure.
 *
 * Two dollar fields, deliberately, rather than one net number. `assessedAsFiled`
 * is a *presumption* about a return we mostly have not seen; `correctedValue`
 * is our position. Printing both lets a controller who does have last year's
 * return correct the first without touching the second.
 */
function rowFor(args: {
  findingKey: string;
  asset: SavingsAsset;
  scheduleValue: number | null;
  assessedAsFiled: number | null;
  correctedValue: number | null;
  signals: DetectionSignal[];
  basis: RateBasis;
  taxYear: number;
  /** The appraisal the schedule value came from, where there was one. */
  appraisal?: Appraisal | null;
  /** Cost less anything an invoice identified as not tangible property. */
  assessableCost?: number | null;
  /** The oldest year this same error would already have been on the roll. */
  firstExposedYear?: number | null;
  /** Whose correction statute the prior years run on. */
  jurisdictionId?: string | null;
  acceptanceOverrides?: Record<string, number>;
  signalLifts?: SignalLift[];
  model?: DetectionModelFit | null;
}): FindingRow {
  const { asset, assessedAsFiled, correctedValue, basis } = args;
  const valueRemoved =
    assessedAsFiled === null || correctedValue === null
      ? null
      : Math.max(0, assessedAsFiled - correctedValue);
  const rate = basis.assessmentRatio * basis.millage;
  const taxAtRisk = valueRemoved === null ? null : valueRemoved * rate;
  const confidence = confidenceFor(args.findingKey, args.signals, (findingKey, signals) =>
    modelScore(args.model, findingKey, signals),
  );
  const recovery = expectedRecovery({
    findingKey: args.findingKey,
    taxYear: args.taxYear,
    taxAtRisk,
    confidence: confidence.score,
    firstExposedYear: args.firstExposedYear ?? null,
    jurisdictionId: args.jurisdictionId ?? null,
    acceptanceOverrides: args.acceptanceOverrides,
    // The signals the row was *actually* flagged on, including anything an
    // external source added, because that is the set a future outcome will be
    // attributed to. Asking the lift model about a smaller set than the claim
    // will freeze would price the row on evidence it is not making.
    acceptanceLift: liftFor(args.signalLifts ?? [], args.findingKey, confidence.signals),
  });
  const prior = recovery === null ? null : recoverySignal(recovery);
  return {
    // FindingEvidence, unchanged — every existing reader of `evidence` keeps
    // working, because a row *is* one of those with more on it.
    assetId: asset.id,
    assetTag: asset.assetTag ?? null,
    description: asset.description,
    acquisitionYear: asset.acquisitionYear,
    originalCost: asset.originalCost,
    scheduleValue: args.scheduleValue,
    categoryKey: asset.categoryKey,

    findingKey: args.findingKey,
    // Stable across re-analysis, because a disposition recorded against this
    // row has to survive the next run of the engine. Asset ids are durable and
    // finding keys are constants, so the pair is too.
    rowKey: `${args.findingKey}:${asset.id}`,
    categoryLabel: asset.categoryKey === null ? null : classificationLabel(asset.categoryKey),
    assessedAsFiled,
    correctedValue,
    valueRemoved,
    taxAtRisk,
    expectedRecovery: recovery?.expected ?? null,
    recovery,
    chain: chainPair(args, basis),
    // The prior-year signal is appended rather than passed in, because it is
    // derived from the confidence the other signals produced. It carries no
    // weight of its own — it explains the number without moving it, which is
    // the only safe way to show a reader something that came after the scoring.
    confidence:
      prior === null ? confidence : { ...confidence, signals: [...confidence.signals, prior] },
    locationId: asset.locationId ?? null,
    siteLabel: asset.site?.label ?? null,
    jurisdictionName: asset.site?.jurisdictionName ?? null,
    costCenter: asset.costCenter ?? null,
    evidencePresent: hasCorroboration(asset),
  };
}

/**
 * The same asset priced twice: as the return has it, and as we say it should be.
 *
 * Printed as a waterfall rather than as two totals because the argument with a
 * district is almost never about the total. It is about one step — the index
 * factor for that year, whether the thing is ten-year or fifteen-year property,
 * whether the cost includes the freight. A reader who can see the steps can
 * point at the one they disagree with.
 *
 * The intermediate steps are filled only where they are genuinely known. A
 * floored asset's presumed as-filed value is *cost*, which did not come off any
 * schedule, so its chain shows a market value and nulls above it rather than
 * borrowing the corrected side's factors and implying an arithmetic that never
 * happened.
 */
function chainPair(
  args: {
    asset: SavingsAsset;
    assessedAsFiled: number | null;
    correctedValue: number | null;
    appraisal?: Appraisal | null;
    assessableCost?: number | null;
  },
  basis: RateBasis,
): { asFiled: TaxChain; asCorrected: TaxChain } | null {
  const { appraisal, assessedAsFiled, correctedValue } = args;
  if (assessedAsFiled === null && correctedValue === null) return null;
  const at = (marketValue: number | null, cost: number | null): TaxChain => {
    if (marketValue === 0) return removedChain(basis);
    // Only claim the factors when this value is the one they produced.
    const derived =
      appraisal != null &&
      marketValue !== null &&
      Math.abs(marketValue - appraisal.marketValue) < 0.5;
    return chainFrom({
      assessableCost: derived ? appraisal!.replacementCostNew / appraisal!.indexFactor : cost,
      indexFactor: derived ? appraisal!.indexFactor : null,
      percentGood: derived ? appraisal!.percentGood : null,
      marketValue,
      basis,
    });
  };
  return {
    asFiled: at(assessedAsFiled, args.asset.originalCost ?? null),
    asCorrected: at(correctedValue, args.assessableCost ?? args.asset.originalCost ?? null),
  };
}

/**
 * Whether the register row carries something you could check against a
 * document — a serial number, a vendor, a GL account, a disposal date.
 *
 * Not "a document is attached": nothing in this product attaches documents to
 * individual assets yet. This is the honest version of the same question, and
 * it is the one that changes what a reviewer does. A $90,000 line with a serial
 * number and a vendor can be tied to an invoice in a minute; the same line with
 * only "EQUIPMENT" on it cannot be tied to anything, and that is worth being
 * able to filter for.
 */
function hasCorroboration(asset: SavingsAsset): boolean {
  return Boolean(
    asset.serialNumber?.trim() ||
    asset.vendor?.trim() ||
    asset.glAccount?.trim() ||
    asset.disposalDate?.trim(),
  );
}

/**
 * The signals every finding shares: what the register says about the row
 * itself, before anything about the particular position.
 *
 * These are mostly negative, which is intentional. A row is flagged because it
 * matched a rule; what should move confidence off that rule is the evidence
 * that the row is *thin* — no description, no cost, no year — because a thin
 * row is exactly the one a district will ask about first.
 */
function corroboration(asset: SavingsAsset): DetectionSignal[] {
  const out: DetectionSignal[] = [];
  if (asset.status === 'confirmed') {
    out.push(signal('confirmed-classification', 'A person confirmed the classification', 0.08));
  } else if (asset.classificationSource === 'ai') {
    out.push(
      signal(
        'model-classified',
        'The class came from the model rather than a rule or a person',
        -0.04,
        asset.classificationConfidence === null || asset.classificationConfidence === undefined
          ? null
          : `scored ${Math.round(asset.classificationConfidence * 100)}%`,
      ),
    );
  } else if (asset.classificationSource === 'memory' || asset.classificationSource === 'rule') {
    out.push(
      signal('replayed-classification', 'The class replays a decision already made', 0.04, null),
    );
  }

  const identifiers = [
    asset.serialNumber?.trim() ? 'serial number' : null,
    asset.vendor?.trim() ? 'vendor' : null,
    asset.glAccount?.trim() ? 'GL account' : null,
  ].filter(Boolean) as string[];
  if (identifiers.length > 0) {
    out.push(
      signal(
        'identified-row',
        'The register identifies this row well enough to tie to a document',
        0.05,
        identifiers.join(', '),
      ),
    );
  }

  if (!asset.description?.trim()) {
    out.push(signal('no-description', 'The register gives this row no description', -0.12));
  }
  if (asset.acquisitionYear === null) {
    out.push(signal('no-acquisition-year', 'No acquisition year, so no schedule year', -0.08));
  }
  if (!asset.originalCost) {
    out.push(signal('no-cost', 'The register carries no cost for this row', -0.1));
  }
  return out;
}

/**
 * A disposal is the least arguable finding on the list, and these are the two
 * things that make one row of it more or less arguable than another.
 *
 * The date matters twice over. Its presence is corroboration — a register that
 * recorded *when* is a register that was maintained. Its value is the position:
 * property is rendered as of January 1, so an asset disposed of in March was
 * owned on the lien date and belongs on that year's return however plainly the
 * register says it is gone. That row is not a saving, and the signal that says
 * so is the largest single weight in this file.
 */
function ghostSignals(asset: SavingsAsset, lienDate: string): DetectionSignal[] {
  const out: DetectionSignal[] = [];
  const disposed = asset.disposalDate?.trim();
  if (!disposed) {
    out.push(
      signal('no-disposal-date', 'Marked disposed by a flag, with no date recorded', -0.12, null),
    );
    return out;
  }
  out.push(signal('disposal-date', 'The register records a disposal date', 0.15, disposed));
  if (disposed < lienDate) {
    out.push(
      signal(
        'gone-before-january',
        'Disposed of before January 1, the day value attaches',
        0.1,
        null,
      ),
    );
  } else {
    out.push(
      signal(
        'owned-on-january-1',
        'Still owned on January 1, so it belongs on this year’s return',
        // Decisive on its own: this is not a weak disposal, it is the wrong
        // year for one. The row still prints — a reviewer holding a register
        // that spans two years needs to see it — but no filter set to
        // high-confidence work will ever surface it.
        -0.55,
        `disposed ${disposed}, after the lien date`,
      ),
    );
  }
  return out;
}

/**
 * Not every exclusion is equally safe. Software is a statement about what the
 * tax reaches; a leased-in copier is a statement about who owns it, and only
 * the lease settles that.
 */
function exclusionSignals(key: string): DetectionSignal[] {
  switch (key) {
    case 'excluded-intangible':
      return [
        signal(
          'intangible',
          'Software or another cost the tax does not reach (Tax Code 11.02)',
          0.12,
          null,
        ),
      ];
    case 'excluded-real-property':
      return [
        signal('real-property', 'Appraised on the real property account instead', 0.08, null),
      ];
    case 'excluded-leased-in':
      return [
        signal(
          'leased-in',
          'Owned by a lessor who renders it themselves',
          0.02,
          'the lease is what settles it',
        ),
      ];
    default:
      return [];
  }
}

/**
 * The floor finding is worth money only if the client rendered these above the
 * floor — which the register cannot say. So the signals are about how far past
 * the floor the asset is, and whether we have anything at all about what was
 * filed.
 */
function flooredSignals(
  asset: SavingsAsset,
  taxYear: number,
  assessedKnown: boolean,
): DetectionSignal[] {
  const out: DetectionSignal[] = [
    signal('at-floor', 'Past the last published year on the district’s schedule', 0.1, null),
  ];
  const age = asset.acquisitionYear === null ? null : taxYear - asset.acquisitionYear;
  if (age !== null && age >= 20) {
    out.push(
      signal(
        'long-past-floor',
        'Bought a generation ago and still carried at cost',
        0.08,
        `${age} years old`,
      ),
    );
  }
  out.push(
    assessedKnown
      ? signal(
          'assessed-on-file',
          'The district’s own assessed total is on file to compare',
          0.05,
          null,
        )
      : signal(
          'rendition-unknown',
          'No prior return on file to say how these were reported',
          -0.15,
          null,
        ),
  );
  return out;
}

/**
 * The year a disposal was recorded in, where the register gives a date.
 *
 * Wanted for one purpose only: the asset was correctly on the roll for the
 * January 1 of the year it was disposed in, so exposure to a prior-year claim
 * starts the year *after*. Getting this backwards would put a correction motion
 * in front of a district for a year the taxpayer genuinely owed.
 */
function disposalYear(asset: SavingsAsset): number | null {
  const parsed = Date.parse(asset.disposalDate ?? '');
  if (!Number.isNaN(parsed)) return new Date(parsed).getUTCFullYear();
  const match = /(19|20)\d{2}/.exec(asset.disposalDate ?? '');
  return match ? Number(match[0]) : null;
}

/** Biggest first, and capped: the printed sample is read, not scrolled. */
const EVIDENCE_SHOWN = 25;
const byCost = (a: FindingEvidence, b: FindingEvidence) =>
  (b.originalCost ?? 0) - (a.originalCost ?? 0);

/**
 * The three per-asset fields on a finding, all derived from one sorted array.
 *
 * `evidence` is literally the first page of `rows`, not a separately assembled
 * list, so the sample a reader sees and the population they can filter cannot
 * disagree. `rows` is uncapped: a cap here would be a silent limit on which of
 * their own assets a client is allowed to review, which is the opposite of the
 * point.
 */
function perAsset(
  rows: FindingRow[],
): Pick<SavingsFinding, 'evidence' | 'rows' | 'detection' | 'confidenceMix'> {
  const sorted = [...rows].sort(byCost);
  return {
    rows: sorted,
    evidence: sorted.slice(0, EVIDENCE_SHOWN),
    detection: detectionBasis(sorted),
    confidenceMix: confidenceMix(sorted),
  };
}

/**
 * Which signals fired across the category, with counts and cost.
 *
 * The header of a category page used to be a paragraph somebody wrote once and
 * had to keep true. This is the same claim as a group-by over the rows that are
 * printed underneath it, so it cannot go stale — and it prints the signals that
 * argue *against* the finding alongside the ones that support it, which a
 * paragraph written to sell the finding never did.
 */
function detectionBasis(rows: FindingRow[]): DetectionBasis[] {
  const byCode = new Map<string, DetectionBasis>();
  for (const row of rows) {
    for (const fired of row.confidence.signals) {
      const seen = byCode.get(fired.code) ?? {
        code: fired.code,
        label: fired.label,
        assetCount: 0,
        originalCost: 0,
      };
      seen.assetCount += 1;
      seen.originalCost += row.originalCost ?? 0;
      byCode.set(fired.code, seen);
    }
  }
  return [...byCode.values()].sort(
    (a, b) => b.assetCount - a.assetCount || b.originalCost - a.originalCost,
  );
}

function confidenceMix(rows: FindingRow[]): SavingsFinding['confidenceMix'] {
  const mix = { high: 0, medium: 0, low: 0 };
  for (const row of rows) mix[row.confidence.tier] += 1;
  return mix;
}

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

  const ghosts: FindingRow[] = [];
  const excluded: FindingRow[] = [];
  const floored: FindingRow[] = [];
  const leasehold: FindingRow[] = [];
  const inventory: FindingRow[] = [];

  // What every row prices its own tax at, split into the assessment ratio and
  // the millage rather than folded into one number. Multiplied back together it
  // is the same blended rate the headline uses, so a controller who adds up the
  // rows they accepted still lands on the figure the report leads with.
  const basis = input.accountRate?.basis ?? basisFromBlendedRate(input.blendedTaxRate);
  /**
   * Passing `accountRate` means the caller assembled the rate from the units
   * that actually tax this account. Not passing it means the report is running
   * on the jurisdiction's single county-wide constant, and that has to reach
   * the page rather than stopping here.
   */
  const borrowedYear =
    input.accountRate && input.accountRate.taxYear !== input.taxYear
      ? input.accountRate.taxYear
      : null;
  const rateSource = !input.accountRate
    ? {
        kind: 'estimated' as const,
        label: 'county-wide estimate',
        detail:
          'A single blended rate for the whole county, not this account’s own units. Two accounts in the same county pay different rates — across the 2025 Harris roll the real rate runs from 0.63% to 3.62% — and this estimate is above the true rate for most accounts, which overstates rather than understates the position. Treat every figure here as an order of magnitude until the account’s units are loaded.',
      }
    : borrowedYear
      ? {
          kind: 'prior-year' as const,
          label: `${borrowedYear} adopted rates`,
          detail: `Assembled from the taxing units that levy on this account, weighted by the value each unit taxes — but at the rates adopted for ${borrowedYear}, because ${input.taxYear} rates are not adopted yet. Each unit sets its own rate every autumn, after this return is prepared, so treat the tax figures as close rather than final.`,
        }
      : {
          kind: 'adopted' as const,
          label: 'adopted rates',
          detail:
            'Assembled from the taxing units that levy on this account, at the rates their governing bodies adopted for the year, weighted by the value each unit taxes.',
        };
  const lienDate = `${input.taxYear}-01-01`;

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

  /**
   * Every line that made the corrected position, with the appraisal that put it
   * there. This is what the cross-asset detectors run over — and only these,
   * because a duplicate among disposed or excluded rows is already coming off
   * the rendition for its own reason, and finding it twice would double-count.
   */
  const candidates: Candidate[] = [];

  /**
   * `rowFor` with the four things every row in this run shares already bound.
   * Wrapped rather than repeated because the rate basis and tax year are what
   * the whole report's arithmetic hangs off, and a call site that quietly
   * passed a different one would be a very quiet bug.
   */
  const evidenceByAsset = new Map((input.evidence ?? []).map((result) => [result.assetId, result]));

  const row = (args: {
    findingKey: string;
    asset: SavingsAsset;
    scheduleValue: number | null;
    assessedAsFiled: number | null;
    correctedValue: number | null;
    signals: DetectionSignal[];
    appraisal?: Appraisal | null;
    assessableCost?: number | null;
    firstExposedYear?: number | null;
  }) => {
    // Appended last, so the reviewer reads the register's case first and then
    // what the other systems said about it — including, and especially, when
    // what they said is that the asset is still being maintained.
    const found = evidenceByAsset.get(args.asset.id);
    const signals = found
      ? [...args.signals, ...evidenceSignals(found, args.findingKey)]
      : args.signals;
    return rowFor({
      ...args,
      signals,
      basis,
      taxYear: input.taxYear,
      jurisdictionId: input.jurisdictionId,
      acceptanceOverrides: input.acceptanceOverrides,
      signalLifts: input.signalLifts,
      model: input.model ?? null,
    });
  };

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
      const appraisal = schedule
        ? isExclusion(key)
          ? appraiseAs(asset, schedule, REFERENCE_CATEGORY, input.businessSic)
          : appraiseAs(asset, schedule, key, input.businessSic)
        : null;
      const value = appraisal?.marketValue ?? null;
      ghosts.push(
        row({
          findingKey: 'ghost-assets',
          asset,
          scheduleValue: value,
          appraisal,
          // On the return as filed it carries its schedule value; owned by
          // nobody on January 1, it should carry nothing.
          assessedAsFiled: value,
          correctedValue: 0,
          signals: [...ghostSignals(asset, lienDate), ...corroboration(asset)],
          // It was correctly on the roll for the year it was disposed in — the
          // owner held it on that January 1 — so exposure starts the year after.
          firstExposedYear: disposalYear(asset) === null ? null : disposalYear(asset)! + 1,
        }),
      );
      ghostCost += cost;
      ghostValue += value ?? 0;
      tally(asset, { measured: value ?? 0 });
      coverage.inFindingsCount += 1;
      continue;
    }

    if (isExclusion(key)) {
      const appraisal = schedule
        ? appraiseAs(asset, schedule, REFERENCE_CATEGORY, input.businessSic)
        : null;
      const value = appraisal?.marketValue ?? null;
      excluded.push(
        row({
          findingKey: 'non-taxable',
          asset,
          scheduleValue: value,
          appraisal,
          assessedAsFiled: value,
          correctedValue: 0,
          signals: [...exclusionSignals(key), ...corroboration(asset)],
          // Never taxable, so wrong on every return it has appeared on.
          firstExposedYear: asset.acquisitionYear,
        }),
      );
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
      floored.push(
        row({
          findingKey: 'fully-depreciated',
          asset,
          scheduleValue: result.value.marketValue,
          appraisal: result.value,
          // The screening premise, stated as arithmetic: *if* this was
          // rendered at cost, cost is what it carries, and the floor is what it
          // should carry. Both numbers are contingent on the answer to the
          // question, which is why the finding above them stays unpriced.
          assessedAsFiled: cost,
          correctedValue: result.value.marketValue,
          signals: [
            ...flooredSignals(asset, input.taxYear, input.assessed !== null),
            ...corroboration(asset),
          ],
          // Whether it was rendered above the floor last year is the question
          // this finding asks. Claiming prior years on an unanswered question
          // is exactly the overreach the model exists to prevent.
          firstExposedYear: null,
        }),
      );
      flooredCost += cost;
      flooredValue += result.value.marketValue;
      tally(asset, { lead: { key: 'fully-depreciated', cost } });
    }
    if (key === 'leasehold-improvements') {
      leasehold.push(
        row({
          findingKey: 'leasehold-double-tax',
          asset,
          scheduleValue: result.value.marketValue,
          appraisal: result.value,
          assessedAsFiled: result.value.marketValue,
          correctedValue: 0,
          signals: [
            signal(
              'leasehold-class',
              'Classified as tenant build-out rather than equipment',
              0.1,
              null,
            ),
            signal(
              'landlord-unknown',
              'Nothing on file about the landlord or the lease',
              -0.1,
              null,
            ),
            ...corroboration(asset),
          ],
          firstExposedYear: null,
        }),
      );
      leaseholdCost += cost;
      leaseholdValue += result.value.marketValue;
      tally(asset, { lead: { key: 'leasehold-double-tax', cost } });
    }
    if (key === 'inventory') {
      inventory.push(
        row({
          findingKey: 'freeport',
          asset,
          scheduleValue: result.value.marketValue,
          appraisal: result.value,
          // Inventory is rendered at cost, and the best case is that all of it
          // qualifies. Nothing in the register says what share does, so this is
          // the ceiling on the answer rather than the answer.
          assessedAsFiled: cost,
          correctedValue: 0,
          signals: [
            signal('inventory-class', 'Classified as inventory or supplies', 0.08, null),
            signal(
              'shipping-unknown',
              'Nothing on file about where the inventory goes, or how fast',
              -0.12,
              null,
            ),
            ...corroboration(asset),
          ],
          // The exemption is claimed annually and a late application captures
          // part of the benefit — but that is 11.4391, not a 25.25 correction.
          firstExposedYear: null,
        }),
      );
      inventoryCost += cost;
      tally(asset, { lead: { key: 'freeport', cost } });
    }

    candidates.push({ asset, appraisal: result.value });
  }

  // --- The cross-asset pass ------------------------------------------------
  // Everything above decided one asset at a time. The seven detectors below
  // are comparisons — between two rows, between a row and its peers, between a
  // location's total and a statutory threshold — and none of them can be
  // answered while standing on a single asset, which is why five of the twelve
  // leakage types had no detector until now.
  const ctx: DetectorContext = {
    taxYear: input.taxYear,
    schedule,
    businessSic: input.businessSic,
    knownLocations: new Set((input.knownLocations ?? []).map(foldLocation).filter(Boolean)),
    jurisdictionId: input.jurisdictionId,
    jurisdictionName: schedule?.jurisdictionName ?? null,
    exemptionAmount: input.exemptionAmount,
  };

  const appraisalOf = new Map(candidates.map((c) => [c.asset.id, c.appraisal]));
  const rowsFrom = (findingKey: string, plans: RowPlan[]): FindingRow[] =>
    plans.map((plan) =>
      row({
        findingKey,
        asset: plan.asset,
        scheduleValue: plan.scheduleValue,
        appraisal: appraisalOf.get(plan.asset.id) ?? null,
        assessedAsFiled: plan.assessedAsFiled,
        correctedValue: plan.correctedValue,
        assessableCost: plan.assessableCost ?? null,
        signals: [...plan.signals, ...corroboration(plan.asset)],
        firstExposedYear: plan.firstExposedYear,
      }),
    );

  // Removal findings are mutually exclusive per asset, and the order below is
  // the order of how well the record supports them. A machine that is both a
  // duplicate and at a closed site should be argued as a duplicate once, not
  // removed twice — and the totals would otherwise double-count it.
  const claimed = new Set<string>();
  const unclaimed = (plans: RowPlan[]) => plans.filter((plan) => !claimed.has(plan.asset.id));
  const claim = (plans: RowPlan[]) => {
    for (const plan of plans) if (plan.correctedValue === 0) claimed.add(plan.asset.id);
    return plans;
  };

  const duplicates = fuzzyDuplicatePlans(candidates);
  const dupRows = rowsFrom('duplicate-capitalization', claim(duplicates.plans));
  const dupCost = duplicates.plans.reduce((sum, p) => sum + (p.asset.originalCost ?? 0), 0);
  for (const plan of duplicates.plans) {
    // The kept copy of a group removes nothing, so it contributes nothing to
    // the jurisdiction rollup either — otherwise a two-line group would show as
    // twice the money it is actually worth.
    tally(plan.asset, {
      modeled: Math.max(0, (plan.assessedAsFiled ?? 0) - (plan.correctedValue ?? 0)),
    });
  }

  const situs = claim(unclaimed(situsPlans(candidates, ctx)));
  const situsRows = rowsFrom('situs-error', situs);
  const situsCost = situs.reduce((sum, p) => sum + (p.asset.originalCost ?? 0), 0);
  const situsValue = situs.reduce((sum, p) => sum + (p.scheduleValue ?? 0), 0);
  for (const plan of situs) tally(plan.asset, { modeled: plan.scheduleValue ?? 0 });

  const leased = claim(unclaimed(leasedPlans(candidates)));
  const leasedRows = rowsFrom('leased-double-report', leased);
  const leasedCost = leased.reduce((sum, p) => sum + (p.asset.originalCost ?? 0), 0);
  const leasedValue = leased.reduce((sum, p) => sum + (p.scheduleValue ?? 0), 0);
  for (const plan of leased)
    tally(plan.asset, {
      lead: { key: 'leased-double-report', cost: plan.asset.originalCost ?? 0 },
    });

  const deMinimis = deMinimisGroups(candidates, ctx);
  const deMinimisPlans = claim(unclaimed(deMinimis.flatMap((group) => group.plans)));
  const deMinimisRows = rowsFrom('de-minimis', deMinimisPlans);
  const deMinimisCost = deMinimisPlans.reduce((sum, p) => sum + (p.asset.originalCost ?? 0), 0);
  const deMinimisValue = deMinimisPlans.reduce((sum, p) => sum + (p.scheduleValue ?? 0), 0);
  for (const plan of deMinimisPlans) tally(plan.asset, { modeled: plan.scheduleValue ?? 0 });

  // The three that reduce a value rather than remove one. They can coexist with
  // each other and with a removal — an asset argued off the return entirely and
  // also over-classified is not double-counted, because the removal took the
  // whole value and the reduction is a smaller claim on the same money — so
  // they run against the unclaimed set too.
  const discipline = retirementDiscipline(input.assets, input.taxYear, (asset) => {
    const appraisal = appraisalOf.get(asset.id);
    return appraisal ? classLife(appraisal) : (asset.lifeClassOverride ?? null);
  });
  const siblings = purchaseSiblings(input.assets);

  const splits = new Map((input.invoiceSplits ?? []).map((split) => [split.assetId, split]));
  const nonAssessable = unclaimed(nonAssessablePlans(candidates, ctx, splits));
  const nonAssessableRows = rowsFrom('non-assessable-cost', nonAssessable);
  const nonAssessableCost = nonAssessable.reduce((sum, p) => sum + (p.asset.originalCost ?? 0), 0);
  const nonAssessableValue = nonAssessable.reduce(
    (sum, p) => sum + Math.max(0, (p.assessedAsFiled ?? 0) - (p.correctedValue ?? 0)),
    0,
  );
  for (const plan of nonAssessable) {
    tally(plan.asset, {
      measured: Math.max(0, (plan.assessedAsFiled ?? 0) - (plan.correctedValue ?? 0)),
    });
  }

  const misclassified = unclaimed(misclassificationPlans(candidates, ctx));
  const misclassifiedRows = rowsFrom('misclassification', misclassified);
  const misclassifiedCost = misclassified.reduce((sum, p) => sum + (p.asset.originalCost ?? 0), 0);
  const misclassifiedValue = misclassified.reduce(
    (sum, p) => sum + Math.max(0, (p.assessedAsFiled ?? 0) - (p.correctedValue ?? 0)),
    0,
  );
  for (const plan of misclassified) {
    tally(plan.asset, {
      modeled: Math.max(0, (plan.assessedAsFiled ?? 0) - (plan.correctedValue ?? 0)),
    });
  }

  const carried = unclaimed(carryForwardPlans(candidates, input.priorFiling ?? null));
  const carriedRows = rowsFrom('carryforward-error', carried);
  const carriedCost = carried.reduce((sum, p) => sum + (p.asset.originalCost ?? 0), 0);
  const carriedValue = carried.reduce(
    (sum, p) => sum + Math.max(0, (p.assessedAsFiled ?? 0) - (p.correctedValue ?? 0)),
    0,
  );
  for (const plan of carried) {
    tally(plan.asset, {
      measured: Math.max(0, (plan.assessedAsFiled ?? 0) - (plan.correctedValue ?? 0)),
    });
  }

  // The two that stay questions, and so stay off the removal ledger entirely.
  const suspected = unclaimed(suspectedRetiredPlans(candidates, ctx, discipline, siblings));
  const suspectedRows = rowsFrom('suspected-retired', suspected);
  const suspectedCost = suspected.reduce((sum, p) => sum + (p.asset.originalCost ?? 0), 0);
  const suspectedValue = suspected.reduce((sum, p) => sum + (p.scheduleValue ?? 0), 0);
  for (const plan of suspected)
    tally(plan.asset, { lead: { key: 'suspected-retired', cost: plan.asset.originalCost ?? 0 } });

  const idle = unclaimed(idlePlans(candidates, ctx));
  const idleRows = rowsFrom('idle-obsolete', idle);
  const idleCost = idle.reduce((sum, p) => sum + (p.asset.originalCost ?? 0), 0);
  const idleValue = idle.reduce((sum, p) => sum + (p.scheduleValue ?? 0), 0);
  for (const plan of idle)
    tally(plan.asset, { lead: { key: 'idle-obsolete', cost: plan.asset.originalCost ?? 0 } });

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
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: ghostCost,
      assetCount: ghosts.length,
      summary: `${ghosts.length} asset${ghosts.length === 1 ? '' : 's'} the register marks as sold, scrapped, or retired ${ghosts.length === 1 ? 'is' : 'are'} still listed, carrying ${money(ghostCost)} of original cost. Valued on their own schedules they would add ${money(ghostValue)} to the rendition.`,
      basis:
        'Only property owned and in place on January 1 is renderable. A disposal recorded in the fixed asset register is the evidence, and this is the least arguable adjustment on the list.',
      assumption: null,
      question: null,
      ...perAsset(ghosts),
    });
  }

  if (excluded.length > 0) {
    findings.push({
      key: 'non-taxable',
      title: 'Property that does not belong on this rendition',
      kind: 'modeled',
      valueRemoved: excludedValue,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: excludedCost,
      assetCount: excluded.length,
      summary: `${money(excludedCost)} of cost across ${excluded.length} line${excluded.length === 1 ? '' : 's'} is not taxable tangible personal property — software and capitalized implementation, real property carried in the register, or equipment leased in from a lessor who renders it themselves.`,
      basis:
        'Texas ad valorem tax reaches tangible personal property (Tax Code 11.02). Real property is appraised on its own account; a lessor renders what it owns. These lines are in the register because it is a book record kept for depreciation, not a tax schedule.',
      assumption: `Value shown is what these would carry if rendered as ten-year machinery — the district's general default and where a rendition without a classification step puts everything. If they were rendered on a shorter life, the saving is smaller.`,
      question: null,
      ...perAsset(excluded),
    });
  }

  if (floored.length > 0) {
    findings.push({
      key: 'fully-depreciated',
      title: 'Assets already at the schedule floor',
      kind: 'screening',
      valueRemoved: null,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: flooredCost,
      assetCount: floored.length,
      summary: `${floored.length} asset${floored.length === 1 ? '' : 's'} older than the published schedule carr${floored.length === 1 ? 'ies' : 'y'} ${money(flooredCost)} of original cost but only ${money(flooredValue)} of schedule value — the district's own tables treat them as fully depreciated.`,
      basis:
        'Each life class stops depreciating at a floor. An asset past the last published year sits at that floor however old it is, which is a much smaller number than cost.',
      assumption: `Worth money only if these are being rendered above the floor. Last year's rendition settles it — the gap would be up to ${money(flooredCost - flooredValue)} of value.`,
      question:
        'On last year’s rendition, were these older assets reported at their original cost, or at a written-down value? If you have a copy of what was filed, that settles it outright.',
      ...perAsset(floored),
    });
  }

  if (leasehold.length > 0) {
    findings.push({
      key: 'leasehold-double-tax',
      title: 'Leasehold improvements possibly taxed twice',
      kind: 'screening',
      valueRemoved: null,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: leaseholdCost,
      assetCount: leasehold.length,
      summary: `${money(leaseholdCost)} of tenant build-out is carried as personal property, worth ${money(leaseholdValue)} on the schedules. If the landlord's real property was appraised by a method that already reflects these improvements, they are being taxed twice.`,
      basis:
        'Tax Code 23.24 bars appraising an improvement as personal property when the real property assessment already includes it.',
      assumption:
        "Settled by pulling the landlord's real property account and its appraisal method. Worth doing: this is usually the second-largest line after ghost assets, and it recurs every year it goes unchallenged.",
      question:
        'Who is the landlord at this location, and does your lease say the build-out belongs to them at the end of the term? Their property account tells us whether this is already being taxed to them.',
      ...perAsset(leasehold),
    });
  }

  if (inventory.length > 0) {
    findings.push({
      key: 'freeport',
      title: 'Freeport exemption on inventory',
      kind: 'screening',
      valueRemoved: null,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: inventoryCost,
      assetCount: inventory.length,
      summary: `${money(inventoryCost)} of inventory is rendered at full cost. Any of it that leaves Texas within 175 days of acquisition is exempt — and the exemption is claimed, not granted automatically.`,
      basis:
        'Tax Code 11.251 exempts goods detained in Texas for 175 days or less for assembly, storage, manufacturing, or fabrication before moving out of state. Application is annual, and a late application still captures part of the benefit.',
      assumption:
        'Settled by asking one question: what share of inventory ships out of state, and how fast? A shipping report answers it.',
      question:
        'Roughly what share of your inventory leaves Texas, and how long does it typically sit here first? A shipping report for last year answers it exactly.',
      ...perAsset(inventory),
    });
  }

  if (duplicates.groups > 0) {
    findings.push({
      key: 'duplicate-capitalization',
      title: 'The same asset capitalized more than once',
      // Priced rather than asked. Four independent things agreeing —
      // description, cost, timing and department — is a much stronger claim
      // than any one of them, and the register is where the claim is made.
      kind: 'modeled',
      valueRemoved: duplicates.excessValue,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: dupCost,
      assetCount: dupRows.length,
      summary: `${duplicates.groups} group${duplicates.groups === 1 ? '' : 's'} of near-identical lines — matching descriptions, costs within a couple of percent, booked in the same window and the same department — carr${duplicates.groups === 1 ? 'ies' : 'y'} ${money(dupCost)} of cost across ${dupRows.length} rows. Keeping one copy of each removes ${money(duplicates.excessCost)} of cost and ${money(duplicates.excessValue)} of schedule value.`,
      basis:
        'A project capitalized once as a total and again as its components, or a batch imported twice, puts the same property on the rendition more than once — and the district values every line it is given. Tax Code 25.25(c)(2) reaches multiple appraisals of the same property specifically.',
      assumption:
        'Ten identical desks on one purchase order are ten real assets; one lathe entered by two teams is one. Where each line carries its own serial number the group is scored down hard rather than dropped, so a reviewer can see what was considered and set aside.',
      question: null,
      ...perAsset(dupRows),
    });
  }

  if (nonAssessableRows.length > 0) {
    findings.push({
      key: 'non-assessable-cost',
      title: 'Cost in the capitalized amount that is not taxable property',
      kind: 'measured',
      valueRemoved: nonAssessableValue,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: nonAssessableCost,
      assetCount: nonAssessableRows.length,
      summary: `Reading the invoices behind ${nonAssessableRows.length} capitalized line${nonAssessableRows.length === 1 ? '' : 's'} found ${money(nonAssessableCost)} of booked cost containing freight, installation labour, software, tax and similar charges that are not tangible personal property. Rendered on the machine alone, ${money(nonAssessableValue)} of schedule value comes off.`,
      basis:
        'Texas assesses tangible personal property, not the accounting total that was capitalized under it. Freight, rigging, millwright labour, engineering, software licences and sales tax are routinely capitalized into the same line as the equipment and are not themselves taxable property.',
      assumption:
        'Only lines with an invoice behind them appear here — nothing is estimated from a percentage. Extractions a preparer has not yet checked are scored down and say so on the row.',
      question: null,
      ...perAsset(nonAssessableRows),
    });
  }

  if (situsRows.length > 0) {
    findings.push({
      key: 'situs-error',
      title: 'Property that may belong on another district’s account',
      kind: 'modeled',
      valueRemoved: situsValue,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: situsCost,
      assetCount: situsRows.length,
      summary: `${situsRows.length} line${situsRows.length === 1 ? '' : 's'} carrying ${money(situsCost)} of cost, ${money(situsValue)} of schedule value, ${situsRows.length === 1 ? 'is' : 'are'} placed at a site outside this district, named at a location that is not on the client’s site list, or acquired within weeks of January 1.`,
      basis:
        'Property is taxable where it was located on January 1 (Tax Code 21.02). Tax Code 25.25(c)(3) reaches property that does not exist in the form or at the location described.',
      assumption:
        'This moves property between accounts rather than out of tax. The saving here is the value coming off this return; whether the net saving is anything depends on the other district’s rate, and on three of these lines it may be a wash.',
      question: null,
      ...perAsset(situsRows),
    });
  }

  if (misclassifiedRows.length > 0) {
    findings.push({
      key: 'misclassification',
      title: 'Property rendered on the wrong schedule',
      kind: 'modeled',
      valueRemoved: misclassifiedValue,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: misclassifiedCost,
      assetCount: misclassifiedRows.length,
      summary: `${misclassifiedRows.length} line${misclassifiedRows.length === 1 ? '' : 's'} ${misclassifiedRows.length === 1 ? 'sits' : 'sit'} on a longer life than either the client’s own books or their identical neighbours imply. Re-rendered on the class the evidence points to, ${money(misclassifiedValue)} of schedule value comes off ${money(misclassifiedCost)} of cost.`,
      basis:
        'Each class carries its own index factors and percent-good table, so the class decides the value far more than the cost does. The corrected figure here is the district’s own arithmetic re-run on a different class, not an adjustment applied to the old one.',
      assumption:
        'The district decides the class and reads machinery lives off the SIC table, so this is an argument to be made rather than a correction to be claimed. The evidence panel names which of the two tests fired.',
      question: null,
      ...perAsset(misclassifiedRows),
    });
  }

  if (leasedRows.length > 0) {
    findings.push({
      key: 'leased-double-report',
      title: 'Leased equipment the lessor may already be rendering',
      kind: 'screening',
      valueRemoved: null,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: leasedCost,
      assetCount: leasedRows.length,
      summary: `${money(leasedCost)} of cost across ${leasedRows.length} line${leasedRows.length === 1 ? '' : 's'} looks like leased equipment — a right-of-use asset, lease wording in the description, or a vendor who is a finance company. Worth ${money(leasedValue)} on the schedules if it is being rendered here as well as by the lessor.`,
      basis:
        'The owner renders leased personal property. ASC 842 puts operating leases on the balance sheet as right-of-use assets, so equipment the client does not own now appears in the fixed asset register as a matter of course — and gets rendered along with everything else.',
      assumption:
        'Settled by the lease itself: a capital or finance lease is usually rendered by the lessee, a true operating lease by the lessor. The register cannot tell them apart.',
      question:
        'For the lines below, are these leases you own out at the end of the term, or ones the equipment goes back on? The lease agreement settles each one, and the lessor’s own rendition settles it faster.',
      ...perAsset(leasedRows),
    });
  }

  if (deMinimisRows.length > 0) {
    const under = deMinimis.map((group) => group.jurisdictionName ?? 'an unnamed district');
    findings.push({
      key: 'de-minimis',
      title: 'Locations under the exemption threshold entirely',
      kind: 'modeled',
      valueRemoved: deMinimisValue,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: deMinimisCost,
      assetCount: deMinimisRows.length,
      summary: `Everything the client holds in ${under.length === 1 ? under[0] : `${under.length} districts`} adds to less than the ${money(input.exemptionAmount)} exemption — ${money(deMinimisValue)} of schedule value across ${deMinimisRows.length} line${deMinimisRows.length === 1 ? '' : 's'}. Under the threshold the whole position is exempt, not merely reduced.`,
      basis:
        'Tax Code 11.145 exempts a person’s income-producing tangible personal property where the total value of that property in the taxing unit is under the threshold — $125,000 from 2026 under HB 9 and Proposition 9, $2,500 before it.',
      assumption:
        'The exemption is granted per taxing unit and applies without an application under Tax Code 11.43(a); the district still has to agree the total falls under it. Values here are the schedule values this report computes, and the district’s own view of them governs.',
      question: null,
      ...perAsset(deMinimisRows),
    });
  }

  if (carriedRows.length > 0) {
    findings.push({
      key: 'carryforward-error',
      title: 'Last year’s return reported more than the register holds',
      kind: 'measured',
      valueRemoved: carriedValue,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: carriedCost,
      assetCount: carriedRows.length,
      summary: `Comparing the ${input.priorFiling?.taxYear ?? 'prior'} return against the register, ${carriedRows.length} line${carriedRows.length === 1 ? '' : 's'} sit${carriedRows.length === 1 ? 's' : ''} in schedule buckets where more historical cost was reported than the books carry. The difference is worth ${money(carriedValue)} of schedule value, and it repeats every year it goes uncorrected.`,
      basis:
        'A rendition is normally copied forward rather than re-derived, so an over-reported bucket propagates. Tax Code 25.25(c-1) reaches an inaccuracy in the appraised value of personal property caused by an error or omission in a rendition, for the current year and either of the two preceding.',
      assumption:
        'The excess is spread pro rata across the bucket’s rows because a rendition reports in aggregate and never names assets. The bucket total is the measurement; the per-row split is an allocation.',
      question: null,
      ...perAsset(carriedRows),
    });
  }

  if (suspectedRows.length > 0) {
    findings.push({
      key: 'suspected-retired',
      title: 'Assets that look retired but were never marked',
      kind: 'screening',
      valueRemoved: null,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: suspectedCost,
      assetCount: suspectedRows.length,
      summary: `${suspectedRows.length} line${suspectedRows.length === 1 ? '' : 's'} carrying ${money(suspectedCost)} of cost show more than one sign of property that has already left: well past its class life, in a department that records no retirements at all, bought alongside siblings that were retired, or described too generically to be found on a floor. Worth ${money(suspectedValue)} on the schedules if they are gone.`,
      basis:
        'Only property owned and in place on January 1 is renderable. Nothing here is proof — the register does not know what left it — but a line that is twenty years old, has no location, and sits in a cost centre that has never retired anything is a line worth walking to.',
      assumption:
        'Maintenance records, insurance schedules and badge or production data would turn most of these into positions rather than questions. None of that is connected to this product yet.',
      question:
        'Are the assets below still in service? A walk of one floor usually settles most of a list like this, and anything genuinely gone comes off next year’s return as well as this one.',
      ...perAsset(suspectedRows),
    });
  }

  if (idleRows.length > 0) {
    findings.push({
      key: 'idle-obsolete',
      title: 'Assets the books have already written down',
      kind: 'screening',
      valueRemoved: null,
      // Filled below, once every row has been priced.
      expectedRecovery: null,
      originalCost: idleCost,
      assetCount: idleRows.length,
      summary: `${idleRows.length} line${idleRows.length === 1 ? '' : 's'} carrying ${money(idleCost)} of cost ${idleRows.length === 1 ? 'has' : 'have'} been written down in the client’s own books well before the depreciation method would have got there — an impairment. They still carry ${money(idleValue)} on the district’s schedules.`,
      basis:
        'A district appraises at market value on its own tables (Tax Code 23.01) and is not bound by anyone’s book value. But an impairment is an accountant’s signed opinion that the asset stopped being worth what it cost, and functional or economic obsolescence is argued from exactly that.',
      assumption:
        'The figure shown is the ceiling on the answer, not the answer: obsolescence is argued as a percentage off market value and the register does not say what percentage.',
      question:
        'Are the assets below still running? If any are idle, mothballed, or kept only for parts, a photograph and a sentence about why is usually enough to open the argument.',
      ...perAsset(idleRows),
    });
  }

  // Only measured and modeled findings carry a number into the total. A
  // screening finding is a question, and a question is not a saving.
  const totalValueRemoved = findings.reduce((sum, f) => sum + (f.valueRemoved ?? 0), 0);

  /**
   * Expected recovery, which is a different quantity and deliberately so.
   *
   * `totalValueRemoved` is the best case: every position taken, every one
   * accepted, this year only. Expected recovery is what the same set of
   * positions is worth once each is multiplied by how sure we are, how often
   * the district agrees, and how many prior years it can reach. It is smaller,
   * it is in tax dollars rather than value, and it is the only one of the two
   * that can rank a large uncertain finding against a small certain one — which
   * is why the queue sorts on it and the headline still leads with the other.
   *
   * A screening finding contributes here even though its `valueRemoved` is
   * null. There is no contradiction: null means the *best case* is unknown
   * pending an answer, while the expected figure is heavily discounted by
   * construction. A report that could only rank what it had already priced
   * would rank the easy findings and bury the large ones.
   */
  for (const finding of findings) {
    finding.expectedRecovery = (finding.rows ?? []).reduce(
      (sum, r) => sum + (r.expectedRecovery ?? 0),
      0,
    );
  }
  const totalExpectedRecovery = findings.reduce((sum, f) => sum + (f.expectedRecovery ?? 0), 0);

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

  /**
   * The headline prices off the same basis every row does, rather than off
   * `input.blendedTaxRate` separately. Where no basis was supplied the two are
   * the same number by construction, so nothing moves; where one was, a
   * headline still running on the county-wide constant would disagree with the
   * rows summed underneath it, which is exactly the arithmetic a controller
   * checks first.
   */
  const effectiveRate = basis.assessmentRatio * basis.millage;
  /**
   * The exemption, granted the way the statute grants it.
   *
   * 11.145 is not a subtraction from one taxable value. Each taxing unit grants
   * it against its own levy, and 11.145(c) grants it again for each separate
   * location inside that unit. A single subtraction gets the common case exactly
   * right — where every unit taxes the whole of one site, per-unit and blended
   * are the same number, which is worth knowing before reading the rest of this
   * as a correction — and understates two cases it does not: a client with
   * several sites in one unit, and an account whose value straddles a unit
   * boundary, where each side's slice carries its own exemption.
   *
   * The result is still reported as a taxable value, because that is what goes
   * on a rendition and what the rest of the page adds up. So the per-unit tax is
   * computed first and the taxable value read back off it at the report's own
   * rate: `proposedTax = proposedTaxableValue × blendedTaxRate` still holds
   * exactly, and `applied` is the exemption's worth expressed as value, which is
   * $125,000 on the nose for the ordinary single-site account.
   */
  const perUnitExemption =
    input.accountRate && input.accountRate.units.length > 0 && effectiveRate > 0
      ? taxForAccount({
          rate: input.accountRate,
          marketValue: farImpliedValue,
          exemptionPerUnit: input.exemptionAmount,
          grants: input.exemptionGrants,
        })
      : null;
  const proposedTax = perUnitExemption
    ? perUnitExemption.tax
    : Math.max(0, farImpliedValue - Math.min(input.exemptionAmount, farImpliedValue)) *
      effectiveRate;
  const proposedTaxableValue = perUnitExemption
    ? perUnitExemption.tax / effectiveRate
    : Math.max(0, farImpliedValue - Math.min(input.exemptionAmount, farImpliedValue));
  const applied = farImpliedValue - proposedTaxableValue;
  /**
   * How many grants stand behind that figure. `locations` is the largest number
   * of separate locations the caller placed in any one unit, which is what
   * 11.145(c) multiplies by — not the client's site count, because a site the
   * caller could not place in a unit is not counted anywhere.
   */
  const exemptionGrain = {
    units: input.accountRate?.units.length ?? 0,
    locations: Math.max(
      1,
      ...(input.accountRate?.units ?? []).map((unit) =>
        Math.max(1, Math.floor(input.exemptionGrants?.[unit.code] ?? 1)),
      ),
    ),
  };

  /**
   * The "before" is the district's appraised value with the same exemption
   * taken off it. The roll publishes the account gross of 11.145 — an account
   * at $900,000 appraised is taxed on $775,000 — and the proposed side is
   * already net of it, so subtracting one from the other would count the
   * exemption as a saving this engagement produced. It is not: the district
   * grants it either way. Taken the same way on both sides — per unit where
   * the account's units are known, a single subtraction where they are not —
   * so that the reduction is a difference of taxable values and the saving is
   * the difference of the two tax bills.
   */
  const assessedValue = input.assessed?.appraisedValue ?? input.assessed?.assessedValue ?? null;
  const assessedTaxableValue =
    assessedValue === null
      ? null
      : perUnitExemption
        ? taxForAccount({
            rate: input.accountRate!,
            marketValue: assessedValue,
            exemptionPerUnit: input.exemptionAmount,
            grants: input.exemptionGrants,
          }).tax / effectiveRate
        : Math.max(0, assessedValue - Math.min(input.exemptionAmount, assessedValue));
  const valueReduction =
    assessedTaxableValue === null ? null : assessedTaxableValue - proposedTaxableValue;
  const estimatedAnnualSaving = valueReduction === null ? null : valueReduction * effectiveRate;

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
      ...exemptionCopy(input.jurisdictionId, perUnitExemption ? exemptionGrain : null),
      amount: input.exemptionAmount,
      applied,
      perUnit: perUnitExemption ? exemptionGrain : null,
    },
    proposedTaxableValue,
    blendedTaxRate: effectiveRate,
    rateBasis: basis,
    rateSource,
    recoveryModel: recoveryModel(
      input.acceptanceOverrides,
      input.jurisdictionId,
      input.acceptanceEvidence,
    ),
    totalExpectedRecovery,
    proposedTax,
    valueReduction,
    estimatedAnnualSaving,
    coverage,
  };
}

/**
 * What the exemption line says, per state.
 *
 * This was three hardcoded Texas strings until Florida arrived, and it is worth
 * being explicit about why that was a bug rather than a shortcut: the *number*
 * was already coming from `exemptionFor`, so a Florida report would have quoted
 * $25,000 under the heading "Texas Tax Code 11.145". A wrong citation beside a
 * right number is worse than either alone, because it is the part a reader
 * checks when they want to know whether to trust the rest.
 *
 * The caveats differ in kind, not just wording. Texas grants per taxing unit,
 * so applying it once against a blended rate *understates* the benefit. Florida
 * grants per return — per location, per county — so applying it once to a
 * multi-site client understates it by a whole multiple, and the fix is to run
 * one report per site rather than to scale a number here.
 */
function exemptionCopy(
  jurisdictionId: string | null,
  perUnit: { units: number; locations: number } | null,
): {
  label: string;
  basis: string;
  caveat: string;
} {
  if (jurisdictionId === 'fl' || jurisdictionId?.startsWith('fl-')) {
    return {
      label: 'Tangible personal property exemption',
      basis:
        's. 196.183, F.S. — $25,000 per return, in place since the 2008 constitutional amendment.',
      caveat:
        'Granted per return — one location, one county — so a client with several Florida sites claims it several times, and this figure is the exemption for this site only. It is also not automatic: an account must have filed a DR-405 to claim it, and a taxpayer who never filed because they were under the threshold is unfiled rather than exempt.',
    };
  }
  if (jurisdictionId === null || jurisdictionId.startsWith('tx-')) {
    return {
      label: 'Business personal property exemption',
      basis: 'Texas Tax Code 11.145, as raised by HB 9 (2025) and Proposition 9, effective 2026.',
      caveat: !perUnit
        ? 'Granted per taxing unit against that unit’s own levy; applied once here against a blended rate, which understates it slightly. Verify the current amount before this reaches a client.'
        : perUnit.locations > 1
          ? `Granted per taxing unit against that unit’s own levy, and again for each separate location inside the unit under 11.145(c). Applied that way here: across ${perUnit.units} unit${perUnit.units === 1 ? '' : 's'}, at up to ${perUnit.locations} locations each. Only locations that could be placed in a unit are counted, so a client with sites this engagement has no account for is entitled to more than this. Verify the current amount before this reaches a client.`
          : `Granted per taxing unit against that unit’s own levy, and applied that way here — separately in each of the ${perUnit.units} unit${perUnit.units === 1 ? '' : 's'} that levy on this account. One location; 11.145(c) would grant it again for each further location inside a unit. Verify the current amount before this reaches a client.`,
    };
  }
  return {
    label: 'Statutory exemption',
    basis: 'No exemption has been researched for this jurisdiction.',
    caveat:
      'This report applies no exemption here. That is a gap in what has been loaded, not a finding that none exists — check the state before quoting a net position.',
  };
}
