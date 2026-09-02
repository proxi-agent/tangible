import { classificationLabel, isExclusion, isValuable } from '@tangible/classification';
import type {
  ClassificationStatus,
  FilingBlocker,
  Rendition,
  RenditionBasis,
  RenditionCertification,
  RenditionExclusion,
  RenditionLine,
  RenditionSchedule,
  RenditionScheduleKey,
} from '@tangible/types';
import { exemptionForYear } from '@tangible/types';
import { appraise, type DepreciationSchedule, type LifeClass } from '@tangible/valuation';
import { deadlinesFor } from './deadlines.js';
import { appraisalDistrictName } from './districts.js';
import {
  describePositions,
  planPositions,
  type PositionPlan,
  type Removal,
  type RenditionPosition,
} from './positions.js';

/**
 * Build Form 50-144 from a classified register.
 *
 * Pure, like the savings engine and for the same reason: this produces a
 * document somebody signs under penalty of perjury, so it has to be
 * reproducible from its inputs and testable without a database.
 */

export interface RenditionAsset {
  id: string;
  description: string | null;
  acquisitionYear: number | null;
  originalCost: number | null;
  isDisposed: boolean;
  categoryKey: string | null;
  lifeClassOverride: number | null;
  status: ClassificationStatus | null;
}

/**
 * What a resolved Form 50-162 appointment tells a rendition.
 *
 * Deliberately three fields and no dates. The rendition does not re-decide
 * whether an appointment stands — `appointmentStanding` did that against the
 * filing date — it only reports the consequence, and reports the caller's own
 * sentence rather than composing a worse one from parts.
 */
export interface RenditionAppointment {
  /** Whether it authorises this return on the day it would be signed. */
  effective: boolean;
  /** Why it does or does not, in one sentence somebody can act on. */
  standing: string;
  /** Step 4's 22.27(b)(2) answer: may the district show us the client's file. */
  receivesConfidential: boolean;
}

export interface RenditionInput {
  engagementId: string;
  clientName: string;
  taxYear: number;
  jurisdictionId: string | null;
  accountId: string | null;
  sicCode: string | null;
  assets: RenditionAsset[];
  schedule: DepreciationSchedule | null;
  basis: RenditionBasis;
  filedByAgent: boolean;
  /**
   * The Form 50-162 appointment this return would be signed under.
   *
   * The caller resolves it, because the question is not "is there a form
   * somewhere" but "does an appointment filed with *this* district, covering
   * *this* site, still stand on the day we sign" — and only a caller holding
   * the client's appointments and the return's site can answer that.
   *
   * Optional, and `undefined` and `null` both mean we hold nothing. A
   * non-effective appointment is passed down rather than swallowed: it carries
   * the sentence saying what is wrong with it, and "signed and not yet filed"
   * is a different morning's work from "never asked for".
   */
  appointment?: RenditionAppointment | null;
  generatedAt: string;
  /**
   * Committed findings and the decisions standing against them. Optional, and
   * empty until somebody commits a set — a rendition built before any analysis
   * was put to a client is the same form it always was.
   */
  positions?: readonly RenditionPosition[];
  /**
   * Whether to file the Tax Code 22.01(j-3) certification in place of a
   * rendition. Omitted means "when eligible", which is what the season runs
   * on; `false` renders in full at any value; `true` insists, and is answered
   * with a blocker where the value cannot be known. See `certificationFor`.
   */
  certify?: boolean;
}

/**
 * Below this, the form lets the whole rendition go on Schedule A as a single
 * figure with the detail optional. Worth detecting: it turns a two-hundred-line
 * filing into three fields, and a small client into a ten-minute job.
 */
const SCHEDULE_A_THRESHOLD = 20_000;

/**
 * Above this, an agent-filed rendition carrying a good faith estimate must be
 * notarized (Tax Code 22.24(e)). Note what triggers it: the *estimate*, not the
 * value. A rendition filed on cost and year never reaches this test, which is
 * one of the practical reasons cost is the default basis.
 */
const NOTARIZATION_THRESHOLD = 150_000;

/**
 * Where each of our categories lands on the form.
 *
 * The form's schedules are organised by what the property *is* to the district,
 * which is not quite how a register organises it, so this mapping is the
 * translation. Schedule E is the one that matters most: the form wants it by
 * type *and year acquired*, which is exactly the shape the depreciation
 * schedules key on.
 */
const SCHEDULE_FOR_CATEGORY: Readonly<Record<string, RenditionScheduleKey>> = {
  inventory: 'B',
  vehicles: 'D',
  'furniture-fixtures': 'E',
  'office-equipment': 'E',
  'machinery-equipment': 'E',
  'computer-pc': 'E',
  'computer-mainframe': 'E',
  'specific-equipment': 'E',
  'telecom-8': 'E',
  'leasehold-improvements': 'E',
  solar: 'E',
  vessels: 'E',
  // Property the client holds but does not own is still reportable — the form
  // asks for it separately so the district can chase the actual owner.
  'excluded-leased-in': 'F',
};

const SCHEDULE_META: Readonly<
  Record<RenditionScheduleKey, { title: string; instruction: string; byYear: boolean }>
> = {
  A: {
    title: 'Schedule A — total under $20,000',
    instruction:
      'Where the owner’s total taxable personal property at this location is worth less than $20,000, the form takes a general description and a total. Type, year acquired and cost are optional.',
    byYear: false,
  },
  B: {
    title: 'Schedule B — inventory, raw materials and work in process',
    instruction:
      'Goods held for sale or consumption, at cost as of January 1. Carried at full cost: no index, no depreciation.',
    byYear: false,
  },
  C: {
    title: 'Schedule C — supplies',
    instruction: 'Consumables on hand January 1 that are not held for sale.',
    byYear: false,
  },
  D: {
    title: 'Schedule D — vehicles, trailers and special equipment',
    instruction:
      'Licensed vehicles, by year and description. The district values these from its own vehicle source where it can match them, rather than from cost.',
    byYear: true,
  },
  E: {
    title: 'Schedule E — furniture, fixtures, machinery, equipment and computers',
    instruction:
      'The main schedule, filed by property type and year acquired. Historical cost when new, not net book value.',
    byYear: true,
  },
  F: {
    title: 'Schedule F — property held but not owned',
    instruction:
      'Equipment in the client’s possession under lease, bailment or consignment. Reported so the district assesses the owner rather than the client.',
    byYear: false,
  },
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

export function buildRendition(input: RenditionInput): Rendition {
  const { schedule, basis } = input;
  const usingEstimate = basis === 'estimate';
  const positions = input.positions ?? [];
  const plan = planPositions(positions);

  // Only settled, in-service property reaches a form somebody signs. An asset
  // still in the review queue is not "probably furniture" for filing purposes —
  // it is unresolved, and it blocks rather than silently landing somewhere.
  let needsReview = 0;
  let unclassified = 0;
  let unvaluable = 0;
  let disposedStillListed = 0;
  let scheduleValue = 0;
  // Property reaching a schedule the form files by year, carrying no year.
  // Counted apart from `unvaluable` because the two are different problems that
  // happen to share a cause: one is a number we cannot show, the other is a
  // box on the form we cannot fill.
  let undated = 0;
  let undatedCost = 0;
  // Licensed vehicles actually reaching Schedule D. Tracked only so the one
  // question the register cannot answer about them is asked once, and only when
  // there is something to ask it about.
  let vehicles = 0;
  let vehiclesCost = 0;

  type Bucket = {
    cost: number;
    estimate: number;
    count: number;
    /**
     * Assets in this bucket the schedules could not value. A line carrying any
     * of them cannot state a good faith estimate: zero would be a false figure
     * on a sworn form, and the missing value has to show as missing.
     */
    unvaluable: number;
    categories: Set<string>;
  };
  const buckets = new Map<
    string,
    Bucket & { key: RenditionScheduleKey; type: string; year: number | null }
  >();
  const exclusions = new Map<string, RenditionExclusion>();
  // Measured off the register rather than taken from what the finding claimed,
  // so the document reports what actually came off this form today.
  const removed = new Map<string, Removal>();

  const bucketFor = (key: RenditionScheduleKey, type: string, year: number | null) => {
    const id = `${key}|${type}|${year ?? ''}`;
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = {
        key,
        type,
        year,
        cost: 0,
        estimate: 0,
        count: 0,
        unvaluable: 0,
        categories: new Set(),
      };
      buckets.set(id, bucket);
    }
    return bucket;
  };

  for (const asset of input.assets) {
    if (asset.status === null) {
      unclassified += 1;
      continue;
    }
    if (!isValuable({ categoryKey: asset.categoryKey, status: asset.status })) {
      needsReview += 1;
      continue;
    }
    const categoryKey = asset.categoryKey!;
    const cost = asset.originalCost ?? 0;

    // Disposed before January 1 is not the client's property to render. It is
    // counted so the form can say why the register and the filing differ.
    if (asset.isDisposed) {
      disposedStillListed += 1;
      note(exclusions, categoryKey, 'Disposed of before January 1, so not renderable.', cost);
      continue;
    }

    // An accepted position, applied by category. The property is in the
    // register and taxable on its face; it comes off because somebody decided
    // it should, which is why it lands in the exclusions with that reason.
    const removalReason = plan.removals.get(categoryKey);
    if (removalReason) {
      const tally = removed.get(categoryKey) ?? { cost: 0, count: 0 };
      removed.set(categoryKey, { cost: tally.cost + cost, count: tally.count + 1 });
      note(exclusions, categoryKey, removalReason, cost);
      continue;
    }

    const target = SCHEDULE_FOR_CATEGORY[categoryKey];
    if (!target) {
      note(
        exclusions,
        categoryKey,
        isExclusion(categoryKey)
          ? 'Not the client’s taxable tangible personal property.'
          : 'No schedule on Form 50-144 covers this category.',
        cost,
      );
      continue;
    }

    // The two gaps are counted apart and never both, because they ask the
    // reviewer for different work. A schedule that cannot value an asset is
    // arithmetic we could not do; a year-acquired schedule with no year is a
    // box on the form nobody can fill. The second is the one a filer has to
    // act on whichever basis they chose.
    const meta = SCHEDULE_META[target];
    if (target === 'D') {
      vehicles += 1;
      vehiclesCost += cost;
    }
    const undatedHere = meta.byYear && asset.acquisitionYear === null;
    if (undatedHere) {
      undated += 1;
      undatedCost += cost;
    }

    const value = schedule ? appraisedValue(asset, schedule, categoryKey, input.sicCode) : null;
    if (value === null && schedule && !undatedHere) unvaluable += 1;
    scheduleValue += value ?? 0;

    const bucket = bucketFor(
      target,
      classificationLabel(categoryKey),
      meta.byYear ? asset.acquisitionYear : null,
    );
    bucket.cost += cost;
    bucket.estimate += value ?? 0;
    bucket.count += 1;
    if (value === null) bucket.unvaluable += 1;
    bucket.categories.add(categoryKey);
  }

  const totalHistoricalCost = [...buckets.values()].reduce((sum, b) => sum + b.cost, 0);
  const qualifiesForScheduleA = scheduleValue > 0 && scheduleValue < SCHEDULE_A_THRESHOLD;

  const schedules: RenditionSchedule[] = qualifiesForScheduleA
    ? [
        {
          key: 'A',
          ...SCHEDULE_META.A,
          lines: [
            {
              type: 'All business personal property at this location',
              yearAcquired: null,
              historicalCost: totalHistoricalCost,
              goodFaithEstimate: usingEstimate && unvaluable === 0 ? scheduleValue : null,
              assetCount: [...buckets.values()].reduce((sum, b) => sum + b.count, 0),
              categoryKeys: [...new Set([...buckets.values()].flatMap((b) => [...b.categories]))],
            },
          ],
          totalCost: totalHistoricalCost,
          totalEstimate: usingEstimate && unvaluable === 0 ? scheduleValue : null,
        },
      ]
    : assemble(buckets, usingEstimate);

  // Withheld entirely when any asset could not be valued: a total that
  // silently treats an unpriced asset as zero understates a sworn figure.
  const totalGoodFaithEstimate = usingEstimate && unvaluable === 0 ? scheduleValue : null;

  // 22.24(e) turns on the estimate, not on the value. Saying so is the point:
  // it is the reason the cost basis is the default, and a reader who does not
  // know that will assume any large rendition needs a notary.
  const notarization =
    input.filedByAgent && usingEstimate && scheduleValue > NOTARIZATION_THRESHOLD
      ? {
          required: true,
          reason: `Filed by an agent with a good faith estimate of ${money(scheduleValue)}, above the ${money(NOTARIZATION_THRESHOLD)} threshold in Tax Code 22.24(e).`,
        }
      : {
          required: false,
          reason: !input.filedByAgent
            ? 'Filed by the owner rather than an agent, so 22.24(e) does not apply.'
            : usingEstimate
              ? `Filed by an agent with a good faith estimate below the ${money(NOTARIZATION_THRESHOLD)} threshold in Tax Code 22.24(e).`
              : 'Filed on historical cost and year acquired rather than a good faith estimate, so the 22.24(e) notarization requirement is not triggered at any value.',
        };

  const certification = certificationFor({
    input,
    scheduleValue,
    hasSchedule: schedule !== null,
    anythingToFile: buckets.size > 0,
    unvaluable,
    undated,
    unclassified,
    needsReview,
  });

  return {
    engagementId: input.engagementId,
    clientName: input.clientName,
    taxYear: input.taxYear,
    jurisdictionId: input.jurisdictionId,
    jurisdictionName: schedule?.jurisdictionName ?? null,
    accountId: input.accountId,
    sicCode: input.sicCode,
    generatedAt: input.generatedAt,
    basis,
    filedByAgent: input.filedByAgent,
    schedules,
    exclusions: [...exclusions.values()].sort((a, b) => b.originalCost - a.originalCost),
    decisions: describePositions(positions, removed),
    totalHistoricalCost,
    totalGoodFaithEstimate,
    scheduleValue,
    qualifiesForScheduleA,
    notarization,
    certification,
    blockers: blockersFor({
      input,
      needsReview,
      unclassified,
      unvaluable,
      undated,
      undatedCost,
      vehicles,
      vehiclesCost,
      disposedStillListed,
      hasSchedule: schedule !== null,
      anythingToFile: buckets.size > 0,
      certification,
      plan,
    }),
    deadlines: deadlinesFor(input.taxYear, input.jurisdictionId),
  };
}

function appraisedValue(
  asset: RenditionAsset,
  schedule: DepreciationSchedule,
  categoryKey: string,
  sicCode: string | null,
): number | null {
  const result = appraise(
    {
      originalCost: asset.originalCost ?? Number.NaN,
      acquisitionYear: asset.acquisitionYear ?? Number.NaN,
      categoryKey,
      lifeClassOverride: (asset.lifeClassOverride ?? undefined) as LifeClass | undefined,
      businessSic: sicCode,
    },
    schedule,
  );
  return result.ok ? result.value.marketValue : null;
}

function note(
  into: Map<string, RenditionExclusion>,
  categoryKey: string,
  reason: string,
  cost: number,
): void {
  const id = `${categoryKey}|${reason}`;
  const existing = into.get(id);
  if (existing) {
    existing.assetCount += 1;
    existing.originalCost += cost;
    return;
  }
  into.set(id, {
    categoryKey,
    label: classificationLabel(categoryKey),
    reason,
    assetCount: 1,
    originalCost: cost,
  });
}

function assemble(
  buckets: Map<
    string,
    {
      key: RenditionScheduleKey;
      type: string;
      year: number | null;
      cost: number;
      estimate: number;
      count: number;
      unvaluable: number;
      categories: Set<string>;
    }
  >,
  usingEstimate: boolean,
): RenditionSchedule[] {
  const byKey = new Map<RenditionScheduleKey, RenditionLine[]>();
  for (const bucket of buckets.values()) {
    const lines = byKey.get(bucket.key) ?? [];
    lines.push({
      type: bucket.type,
      yearAcquired: bucket.year,
      historicalCost: bucket.cost,
      goodFaithEstimate: usingEstimate && bucket.unvaluable === 0 ? bucket.estimate : null,
      assetCount: bucket.count,
      categoryKeys: [...bucket.categories],
    });
    byKey.set(bucket.key, lines);
  }

  return [...byKey.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, lines]) => ({
      key,
      ...SCHEDULE_META[key],
      // Newest year first within a type, which is how the form reads and how a
      // reviewer scans for the years that carry the most value.
      lines: lines.sort(
        (a, b) => a.type.localeCompare(b.type) || (b.yearAcquired ?? 0) - (a.yearAcquired ?? 0),
      ),
      totalCost: lines.reduce((sum, line) => sum + line.historicalCost, 0),
      totalEstimate:
        usingEstimate && lines.every((line) => line.goodFaithEstimate !== null)
          ? lines.reduce((sum, line) => sum + (line.goodFaithEstimate ?? 0), 0)
          : null,
    }));
}

/**
 * The election under Tax Code 22.01(j-1) not to render.
 *
 * 11.145(b) exempts business personal property worth $125,000 or less per
 * taxing unit at a location, and 22.01(j-1) then says a rendition is required
 * only where the aggregate value at a location exceeds that amount in at
 * least one taxing unit. What goes in its place is 22.01(j-3)'s certification
 * — a rendition statement carrying the person's certification that they
 * reasonably believe the value is not more than the exempted amount, on the
 * box 22.24(c) puts on the form. The return still goes out; the schedules
 * stay blank.
 *
 * "Reasonably believes" is the test, and the district's own published
 * schedules are the most defensible belief on offer: they are how the
 * district will value the property if it disagrees. The election is taken
 * automatically when that figure is at or under the exemption and nothing
 * stands in the way of knowing it — every asset valued, none undated, none
 * still in the review queue. A firm that wants the full rendition anyway
 * says so with `certify: false`; one that wants the certification over the
 * builder's objection gets a blocker instead, because a certification of a
 * value nobody can compute is a sworn guess.
 *
 * Texas only, and only from 2026: the election arrived with the exemption
 * (HB 9, 89th Legislature), and a return for an earlier year answers to the
 * $2,500 exemption that had no such election.
 */
function certificationFor(context: {
  input: RenditionInput;
  scheduleValue: number;
  hasSchedule: boolean;
  anythingToFile: boolean;
  unvaluable: number;
  undated: number;
  unclassified: number;
  needsReview: number;
}): RenditionCertification {
  const { input, scheduleValue } = context;
  const exemption = exemptionForYear(input.taxYear);
  const texas = input.jurisdictionId?.startsWith('tx-') ?? false;
  const valuedInFull = context.hasSchedule && context.unvaluable === 0 && context.undated === 0;
  const settled = context.unclassified === 0 && context.needsReview === 0;
  const value = valuedInFull ? scheduleValue : null;

  const obstacle = !texas
    ? 'The certification under Tax Code 22.01(j-3) is a Texas election, and this return is not filed in Texas.'
    : input.taxYear < 2026
      ? `The election under Tax Code 22.01(j-1) took effect for the 2026 tax year; ${input.taxYear} answers to the earlier ${money(exemption)} exemption, which carried no such election.`
      : !context.anythingToFile
        ? 'There is nothing to file at this site, so there is nothing to certify.'
        : !context.hasSchedule
          ? 'The district has no published schedule loaded, so the property here cannot be valued against the exemption.'
          : !valuedInFull
            ? 'Not every asset here could be valued on the district’s schedules — some carry no year acquired or no life class — so no total exists to hold against the exemption.'
            : !settled
              ? 'Assets here are still in the review queue, and a certification of a total that may yet change is a guess.'
              : scheduleValue > exemption
                ? `The district’s schedules put the property here at ${money(scheduleValue)}, above the ${money(exemption)} exempted by Tax Code 11.145(b), so 22.01(j-1) requires a rendition.`
                : null;

  const eligible = obstacle === null;
  const elected = input.certify ?? eligible;
  const reason = eligible
    ? elected
      ? `The district’s schedules put the property here at ${money(scheduleValue)}, at or under the ${money(exemption)} that Tax Code 11.145(b) exempts for ${input.taxYear}. Under 22.01(j-1) it need not be rendered; this return certifies that belief under 22.01(j-3) and leaves the schedules blank. Once filed, the election takes effect from the following tax year and continues until the property’s ownership changes, unless the chief appraiser requires a rendition.`
      : `Rendered in full by choice. The district’s schedules put the property here at ${money(scheduleValue)}, at or under the ${money(exemption)} exemption, so the 22.01(j-3) certification was available and was not taken.`
    : obstacle;

  return { elected, eligible, exemption, value, reason };
}

/**
 * What stands between this and a signature.
 *
 * `blocking` means the form would be wrong or incomplete if sent today.
 * `warning` means it would be defensible but worse than it needs to be. The
 * distinction matters because the deadline is real: someone will file this on
 * April 14 with two warnings outstanding, and they should be able to tell at a
 * glance which two they can live with.
 */
function blockersFor(context: {
  input: RenditionInput;
  needsReview: number;
  unclassified: number;
  unvaluable: number;
  undated: number;
  undatedCost: number;
  vehicles: number;
  vehiclesCost: number;
  disposedStillListed: number;
  hasSchedule: boolean;
  anythingToFile: boolean;
  certification: RenditionCertification;
  plan: PositionPlan;
}): FilingBlocker[] {
  const blockers: FilingBlocker[] = [];
  const { input, certification } = context;

  if (certification.elected && !certification.eligible) {
    blockers.push({
      key: 'certification-ineligible',
      severity: 'blocking',
      message: `Asked to file as a certification under Tax Code 22.01(j-3), but it cannot be signed. ${certification.reason}`,
      resolution: 'Clear what stops the value from being known, or file the full rendition.',
    });
  }

  if (certification.elected && certification.eligible) {
    // The parts of 11.145 the register cannot see. (f) aggregates related
    // entities that compose a unified business enterprise; (d) and (d-1)
    // allow one exemption per taxing unit regardless of location for property
    // leased out or held where the owner neither owns nor leases. A site that
    // is under the cap on its own may not be under it once those apply, and
    // the only person who knows is the client.
    blockers.push({
      key: 'certification-aggregation',
      severity: 'warning',
      message: `Filed as a certification under Tax Code 22.01(j-3) rather than a rendition: the signer certifies a reasonable belief that the property here is worth not more than ${money(certification.exemption)}. Two things bear on that which the register cannot see — 11.145(f) aggregates property at this location across related entities that compose a unified business enterprise, and 11.145(d) and (d-1) allow only one exemption per taxing unit regardless of location for property leased out or held where the owner neither owns nor leases.`,
      resolution:
        'Confirm with the client that no affiliate holds property at this location, and that the property is neither leased out nor kept at a third party’s premises, before signing.',
    });

    const value = certification.value ?? 0;
    if (value > certification.exemption * 0.9) {
      blockers.push({
        key: 'certification-headroom',
        severity: 'warning',
        message: `Within ${money(certification.exemption - value)} of the exemption on the district’s own schedules. A district that values higher and lands above ${money(certification.exemption)} will treat this account as one that was required to render under 22.01(j-1), and 22.28 charges 10% of the taxes due on property that was not rendered.`,
        resolution:
          'Consider filing the full rendition instead: at this value it costs nothing, and it forecloses the penalty.',
      });
    }
  }

  if (!input.jurisdictionId) {
    blockers.push({
      key: 'no-jurisdiction',
      severity: 'blocking',
      message: 'No jurisdiction is set, so there is no district to file with.',
      // The site first, because that is where the answer belongs: property is
      // taxed where it stood, and a client whose sites straddle a county line
      // has two answers. The engagement's is the fallback for the ordinary
      // client whose sites are all in one county, and saying only that would
      // send the two-county case to the one field that cannot hold both.
      resolution: 'Set the appraisal district on the site, or on the engagement to cover them all.',
    });
  }
  if (!context.hasSchedule && input.jurisdictionId) {
    // By name where we know it. The id is a slug of ours and means nothing to
    // the person deciding whether to chase a schedule for that district.
    const district = appraisalDistrictName(input.jurisdictionId) ?? input.jurisdictionId;
    blockers.push({
      key: 'no-schedule',
      severity: 'warning',
      message: `No published depreciation schedule is loaded for ${district}, so no values can be shown alongside cost.`,
      resolution:
        'Load the district’s schedule, or file on the cost basis, which does not need one.',
    });
  }
  if (!context.anythingToFile) {
    blockers.push({
      key: 'nothing-to-file',
      severity: 'blocking',
      message: 'No settled, in-service property reached any schedule.',
      resolution: 'Classify the register and clear the review queue.',
    });
  }
  if (context.unclassified > 0) {
    blockers.push({
      key: 'unclassified',
      severity: 'blocking',
      message: `${context.unclassified} asset${context.unclassified === 1 ? '' : 's'} on the register ${context.unclassified === 1 ? 'has' : 'have'} no classification, so ${context.unclassified === 1 ? 'it is' : 'they are'} on no schedule.`,
      resolution: 'Run the classification engine over the engagement.',
    });
  }
  if (context.needsReview > 0) {
    blockers.push({
      key: 'needs-review',
      severity: 'blocking',
      message: `${context.needsReview} asset${context.needsReview === 1 ? '' : 's'} still in the review queue ${context.needsReview === 1 ? 'is' : 'are'} omitted from this form. A rendition is sworn to; an unresolved asset cannot be quietly assigned a schedule.`,
      resolution: 'Settle the review queue.',
    });
  }
  // Neither basis survives a missing year, and the cost basis is the one that
  // survives it least. 22.01(a) offers the owner a choice of two ways to state
  // the property — a good faith estimate of market value, *or* historical cost
  // when new **and** the year of acquisition — and the second is not half
  // available. Schedules D and E are laid out by year to match, so an undated
  // asset has no row to sit on: `planFormFill` cannot place it on a rung and
  // sends it to the attached listing, which needs the same year the register
  // never gave. Saying this plainly matters because the old warning said the
  // opposite — that undated property was "filed at cost with no value shown,
  // which is what this basis asks for" — and reassured the filer about the one
  // gap that stops the form from being complete.
  if (context.undated > 0) {
    const many = context.undated !== 1;
    blockers.push({
      key: 'no-year-acquired',
      severity: 'blocking',
      message: `${context.undated} asset${many ? 's' : ''} carrying ${money(context.undatedCost)} reach${many ? '' : 'es'} a schedule the form files by year acquired, with no year. Tax Code 22.01(a) lets the owner render on historical cost only together with the year of acquisition, so ${many ? 'these lines have' : 'this line has'} no complete form to sit on.`,
      resolution:
        'Supply the acquisition year for those assets, or render them on a good faith estimate of market value instead.',
    });
  }

  // What remains under `unvaluable` once the undated are counted separately:
  // property the schedule could not price for some other reason. Harmless on
  // cost, which asks for no value at all; disqualifying on the estimate basis,
  // where leaving it at zero would understate a signed document.
  if (context.unvaluable > 0) {
    const unvaluableDated = context.unvaluable;
    const onEstimate = input.basis === 'estimate';
    const many = unvaluableDated !== 1;
    blockers.push({
      key: 'unvaluable',
      severity: onEstimate ? 'blocking' : 'warning',
      message: onEstimate
        ? `${unvaluableDated} asset${many ? 's' : ''} could not be valued against the district’s schedule, so no good faith estimate can be stated for the ${many ? 'lines they sit on' : 'line it sits on'}. Those estimates are withheld rather than filed as zero.`
        : `${unvaluableDated} asset${many ? 's' : ''} could not be valued against the district’s schedule. ${many ? 'They are' : 'It is'} filed at cost and year, which is what this basis asks for.`,
      resolution: onEstimate
        ? 'Check the acquisition years against the schedule’s published range, or file on the cost basis, which does not require a value.'
        : 'No action needed to file; check the years against the schedule if you want a value shown alongside.',
    });
  }
  if (!input.accountId) {
    blockers.push({
      key: 'no-account',
      severity: 'warning',
      message: 'No roll account number is recorded, so the filing cannot cite one.',
      resolution: 'Add the account number from the district’s notice.',
    });
  }
  if (!input.sicCode) {
    blockers.push({
      key: 'no-sic',
      severity: 'warning',
      message:
        'No SIC code is set, so machinery sits on the ten-year placeholder rather than the life the district publishes for this line of business.',
      resolution: 'Set the SIC code on the engagement.',
    });
  }
  // The one question a fixed asset register can never answer about a vehicle,
  // asked once and only when Schedule D actually carries something.
  //
  // Everything titled and licensed goes on Schedule D by default, and that
  // default is right: the relief is 22.01(k), and it is narrow in a way worth
  // stating rather than assuming. It runs only where the owner is an
  // *individual* — an LP, LLC or corporation cannot reach it at all, because
  // 11.254(a) exempts "one motor vehicle owned by the individual" — and only
  // for a passenger car or light truck (11.254(b), borrowing Transportation
  // Code 502.001), used in that individual's occupation *and also* personally,
  // not carrying passengers for hire (11.254(d)), one per individual (11.254(c)).
  //
  // The part that decides it is the last clause of 22.01(k): relief belongs to
  // an individual who "has been granted or has applied for" the exemption. Not
  // one who would qualify. A client whose truck plainly meets every test in
  // 11.254 and who never filed Form 50-759 still owes the rendition on it, so
  // the fact to establish is a filed application, not a qualifying vehicle —
  // which is exactly the shape of 22.23(b) and the freeport late-file, and the
  // shape a reviewer working from the register alone would get backwards.
  if (context.vehicles > 0) {
    const many = context.vehicles !== 1;
    blockers.push({
      key: 'vehicles-personal-use',
      severity: 'warning',
      message: `${context.vehicles} licensed vehicle${many ? 's' : ''} carrying ${money(context.vehiclesCost)} ${many ? 'are' : 'is'} rendered on Schedule D. Tax Code 22.01(k) relieves the rendition duty for one vehicle only where the owner is an individual who has been granted or has applied for the Section 11.254 exemption — an entity cannot claim it, and qualifying without applying does not relieve anything.`,
      resolution:
        'Confirm the owner is an entity, or that no 11.254 application has been filed. If one has, take that vehicle off the register for this filing — a category removal would take them all.',
    });
  }
  if (context.disposedStillListed > 0) {
    blockers.push({
      key: 'disposed-present',
      severity: 'warning',
      message: `${context.disposedStillListed} disposed asset${context.disposedStillListed === 1 ? '' : 's'} ${context.disposedStillListed === 1 ? 'was' : 'were'} left off this rendition. Confirm the disposal dates fall before January 1.`,
      resolution: 'Check the register’s disposal dates against the assessment date.',
    });
  }
  // Filing as agent is not the problem — filing as agent unappointed is. The
  // caller has already asked whether an appointment filed with this district
  // reaches this site today; all that is left here is to say what its answer
  // costs.
  const appointment = input.appointment ?? null;
  if (input.filedByAgent && !appointment?.effective) {
    blockers.push({
      key: 'agent-appointment',
      severity: 'blocking',
      message:
        appointment === null
          ? 'Filing as the client’s agent requires an appointment on file with this district. Tax Code 22.27 also limits who may receive rendition contents to the owner and their appointed agent.'
          : `The appointment on file does not authorise this return. ${appointment.standing}`,
      resolution:
        appointment === null
          ? 'Have the client sign Form 50-162 for this district and record it once the district has it.'
          : 'Record the appointment as filed once the district has it, or send a new Form 50-162 out for signature.',
    });
  }
  // A live appointment that answered No to Step 4's 22.27(b)(2) radio. Valid,
  // and a trap: we may sign and file the rendition, and the district may not
  // send us back the client's own return, the notice of appraised value, or
  // anything else 22.27 makes confidential.
  if (input.filedByAgent && appointment?.effective && !appointment.receivesConfidential) {
    blockers.push({
      key: 'agent-not-confidential',
      severity: 'warning',
      message:
        'The appointment on file says the district may not disclose confidential information to us, so nothing filed under it can be requested back — 22.27 covers rendition contents.',
      resolution: 'Confirm that is intended, or have Step 4 re-signed with the box answered Yes.',
    });
  }

  // A built-in warning that asks a question the decision log has already
  // answered is dropped rather than repeated: an accepted finding carries a
  // name and a date, which is more than the warning was asking for.
  return [
    ...blockers.filter((blocker) => !context.plan.answered.has(blocker.key)),
    ...context.plan.blockers,
  ];
}
