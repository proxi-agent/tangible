import { classificationLabel } from '@tangible/classification';
import type { DetectionSignal } from '@tangible/types';
import {
  appraise,
  LIFE_CLASSES,
  type Appraisal,
  type DepreciationSchedule,
  type LifeClass,
} from '@tangible/valuation';
import type { SavingsAsset } from './analyze.js';
import { signal } from './confidence.js';
import {
  ageSignal,
  disciplineSignal,
  foldLocation,
  genericSignal,
  impairmentSignal,
  leaseSignals,
  locationSignal,
  roundnessSignal,
  siblingSignal,
  type RetirementDiscipline,
  type Siblings,
} from './signals.js';

/**
 * The detectors that cannot be written inside one pass over the register.
 *
 * Everything in the original engine looked at an asset on its own: is it
 * disposed, is its class excluded, is it past the floor. That is why five of
 * the twelve leakage types had no detector — the rest are all *comparisons*. A
 * duplicate is a statement about two rows. A misclassification is a statement
 * about a row and its peers. A de minimis exemption is a statement about every
 * row in a jurisdiction at once. None of them can be decided while standing on
 * a single asset.
 *
 * So this file is the second pass, and it deals in **plans** rather than rows:
 * each detector says which asset, what it carries today, what it should carry,
 * and why. Turning that into a priced row — the tax chain, the confidence, the
 * expected recovery — happens in one place in `analyze.ts`, because a detector
 * that priced its own findings would eventually price them differently.
 */

export interface RowPlan {
  asset: SavingsAsset;
  scheduleValue: number | null;
  assessedAsFiled: number | null;
  correctedValue: number | null;
  signals: DetectionSignal[];
  /**
   * The earliest tax year this same error would already have been on the roll.
   *
   * The only input to expected recovery that is a fact rather than a judgement,
   * and the reason the retroactive term is not simply "five years". A detector
   * that cannot say leaves it null and the prior years are dropped rather than
   * assumed.
   */
  firstExposedYear: number | null;
  /** Cost less anything an invoice identified as non-assessable. */
  assessableCost?: number | null;
}

export interface Candidate {
  asset: SavingsAsset;
  appraisal: Appraisal;
}

export interface DetectorContext {
  taxYear: number;
  schedule: DepreciationSchedule | null;
  businessSic: string | null;
  /** Folded labels of the sites the client says they operate. */
  knownLocations: ReadonlySet<string>;
  jurisdictionId: string | null;
  jurisdictionName: string | null;
  /** The 11.145 threshold for this jurisdiction and year. */
  exemptionAmount: number;
}

/** The life the district's own tables put this asset on, where that is a life. */
export function classLife(appraisal: Appraisal): LifeClass | null {
  return typeof appraisal.schedule === 'number' ? appraisal.schedule : null;
}

function ageOf(asset: SavingsAsset, taxYear: number): number | null {
  return asset.acquisitionYear === null ? null : taxYear - asset.acquisitionYear;
}

/* ========================================================================== */
/*  Habits: what the register says about how it is kept                       */
/* ========================================================================== */

/**
 * Retirement discipline, per cost centre, over the whole register.
 *
 * Computed across every asset including the disposed ones — that is the point,
 * since a department's retirements are exactly what we are counting. `overdue`
 * counts only live assets, because a disposed asset past its life is not
 * evidence of anything except that the process worked.
 */
export function retirementDiscipline(
  assets: readonly SavingsAsset[],
  taxYear: number,
  lifeOf: (asset: SavingsAsset) => number | null,
): Map<string, RetirementDiscipline> {
  const out = new Map<string, RetirementDiscipline>();
  for (const asset of assets) {
    const costCenter = asset.costCenter?.trim();
    if (!costCenter) continue;
    const row =
      out.get(costCenter) ??
      ({ costCenter, assets: 0, retired: 0, overdue: 0 } as RetirementDiscipline);
    row.assets += 1;
    if (asset.isDisposed) row.retired += 1;
    else {
      const age = ageOf(asset, taxYear);
      const life = lifeOf(asset);
      if (age !== null && life !== null && life > 0 && age / life >= 1.5) row.overdue += 1;
    }
    out.set(costCenter, row);
  }
  return out;
}

/**
 * The lines booked from one vendor on one day, which is as close as a fixed
 * asset register gets to a purchase order.
 *
 * Keyed on the acquisition *date* rather than the year: a vendor a company buys
 * from every month would otherwise collapse into one enormous fake purchase.
 * Assets with no date drop out entirely rather than sharing a null bucket.
 */
export function purchaseSiblings(assets: readonly SavingsAsset[]): Map<string, Siblings> {
  const groups = new Map<string, SavingsAsset[]>();
  for (const asset of assets) {
    const vendor = asset.vendor?.trim().toLowerCase();
    const date = asset.acquisitionDate?.trim();
    if (!vendor || !date) continue;
    const key = `${vendor}|${date}`;
    const group = groups.get(key) ?? [];
    group.push(asset);
    groups.set(key, group);
  }
  const out = new Map<string, Siblings>();
  for (const [key, group] of groups) {
    if (group.length < 3) continue;
    const disposed = group.filter((a) => a.isDisposed).length;
    for (const asset of group) {
      out.set(asset.id, {
        key,
        total: group.length,
        // The asset itself is excluded from the count that describes it — a
        // live asset should not be told that most of its siblings are gone by
        // counting itself among the ones that are not.
        disposed: asset.isDisposed ? disposed - 1 : disposed,
      });
    }
  }
  return out;
}

/* ========================================================================== */
/*  1. Assets that are probably already gone                                  */
/* ========================================================================== */

/**
 * The ghost detector for property nobody marked.
 *
 * Everything the doc names except the external systems — no maintenance
 * records, no insurance schedule, no badge data; those land in phase 5 and are
 * what would turn this from a strong lead into a position. Until then it is a
 * screening finding by construction: the register cannot prove a thing is gone,
 * only that the register has stopped being about it.
 *
 * The gate is deliberately not "any signal fired". A single weak signal on a
 * $900 desk is noise, and a queue full of noise is a queue nobody opens. Two
 * signals with real weight between them, and the row has to be worth something.
 */
const SUSPECT_MIN_COST = 2_500;

export function suspectedRetiredPlans(
  candidates: readonly Candidate[],
  ctx: DetectorContext,
  discipline: Map<string, RetirementDiscipline>,
  siblings: Map<string, Siblings>,
): RowPlan[] {
  const out: RowPlan[] = [];
  for (const { asset, appraisal } of candidates) {
    if (asset.isDisposed) continue;
    const cost = asset.originalCost ?? 0;
    if (cost < SUSPECT_MIN_COST) continue;

    const age = ageOf(asset, ctx.taxYear);
    const life = classLife(appraisal);
    const found = [
      ageSignal(age, life),
      disciplineSignal(
        asset.costCenter?.trim() ? discipline.get(asset.costCenter.trim()) : undefined,
      ),
      siblingSignal(siblings.get(asset.id)),
      roundnessSignal(asset.originalCost),
      genericSignal(asset.description),
      locationSignal(asset.registerLocation, ctx.knownLocations),
    ].filter((s): s is DetectionSignal => s !== null);

    const positive = found.filter((s) => s.weight > 0);
    const strength = positive.reduce((sum, s) => sum + s.weight, 0);
    if (positive.length < 2 || strength < 0.22) continue;

    out.push({
      asset,
      scheduleValue: appraisal.marketValue,
      assessedAsFiled: appraisal.marketValue,
      correctedValue: 0,
      signals: [
        ...found,
        signal(
          'not-marked-disposed',
          'The register does not say this is gone — the signals do',
          -0.18,
          'a walk of the floor, or a maintenance record, settles it',
        ),
      ],
      // If it went, it went some time ago, and the year is exactly what nobody
      // recorded. Claiming prior years on a position this soft would be the
      // model's worst failure mode, so it claims none.
      firstExposedYear: null,
    });
  }
  return out;
}

/* ========================================================================== */
/*  2. The same asset, capitalized more than once                             */
/* ========================================================================== */

/**
 * Duplicates, priced rather than asked about.
 *
 * The old detector matched on exact description, exact cost and exact year, and
 * emitted a question. Exactness is why it found so little: a project split
 * across two invoices comes in as "CONVEYOR SYSTEM" and "CONVEYOR SYSTEM PHASE
 * 2" at $84,000 and $84,150, three weeks apart, and no exact key sees them. The
 * doc's four-way match — description similarity, cost proximity, acquisition
 * window, cost centre — sees them, and the reason it can be priced rather than
 * asked is that all four agreeing is a much stronger claim than any one of them.
 *
 * What still cuts hard the other way is identity. Distinct serial numbers are
 * close to proof that these are two machines, and the rows stay printed with
 * the confidence on the floor rather than being hidden, because a reviewer
 * holding ten identical desks needs to see that we looked and decided against.
 */
const DUP_COST_TOLERANCE = 0.02;
const DUP_DAYS = 120;
const DUP_SIMILARITY = 0.72;

export function fuzzyDuplicatePlans(candidates: readonly Candidate[]): {
  plans: RowPlan[];
  groups: number;
  excessCost: number;
  excessValue: number;
} {
  // Bucketed by cost centre so two departments buying the same laptop are not
  // each other's duplicates, then swept in cost order so the pairwise work is
  // over a narrow window rather than the whole register.
  const buckets = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const { asset } = candidate;
    if (!asset.originalCost || !asset.description?.trim()) continue;
    const key = asset.costCenter?.trim().toLowerCase() || '(none)';
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }

  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const byId = new Map(candidates.map((c) => [c.asset.id, c]));
  const matched = new Map<string, { similarity: number; days: number | null; costGap: number }>();

  for (const bucket of buckets.values()) {
    const sorted = [...bucket].sort(
      (a, b) => (a.asset.originalCost ?? 0) - (b.asset.originalCost ?? 0),
    );
    for (let i = 0; i < sorted.length; i += 1) {
      const a = sorted[i]!.asset;
      const costA = a.originalCost!;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const b = sorted[j]!.asset;
        const costB = b.originalCost!;
        // The sweep can stop as soon as cost leaves the tolerance band, which
        // is what keeps this linear-ish on a four-thousand-line register.
        if (costB > costA * (1 + DUP_COST_TOLERANCE) + 1) break;
        const days = dayGap(a, b);
        if (days !== null && days > DUP_DAYS) continue;
        if (days === null && a.acquisitionYear !== b.acquisitionYear) continue;
        const similarity = tokenSimilarity(a.description!, b.description!);
        if (similarity < DUP_SIMILARITY) continue;
        union(a.id, b.id);
        const costGap = Math.abs(costA - costB) / Math.max(costA, costB);
        for (const id of [a.id, b.id]) {
          const seen = matched.get(id);
          if (!seen || similarity > seen.similarity) matched.set(id, { similarity, days, costGap });
        }
      }
    }
  }

  const grouped = new Map<string, Candidate[]>();
  for (const id of matched.keys()) {
    const root = find(id);
    const group = grouped.get(root) ?? [];
    group.push(byId.get(id)!);
    grouped.set(root, group);
  }

  const plans: RowPlan[] = [];
  let excessCost = 0;
  let excessValue = 0;
  let groups = 0;
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    groups += 1;
    // Biggest first, so the copy that stays on the return is the one the
    // district is least likely to argue about keeping.
    const ordered = [...group].sort(
      (a, b) => (b.asset.originalCost ?? 0) - (a.asset.originalCost ?? 0),
    );
    const serials = ordered.map((c) => c.asset.serialNumber?.trim()).filter(Boolean);
    const tags = ordered.map((c) => c.asset.assetTag?.trim()).filter(Boolean);
    const distinctSerials =
      serials.length === ordered.length && new Set(serials).size === ordered.length;
    const distinctTags = tags.length === ordered.length && new Set(tags).size === ordered.length;

    const shared: DetectionSignal[] = [];
    const sample = matched.get(ordered[0]!.asset.id);
    shared.push(
      signal(
        'similar-lines',
        'Near-identical lines in the same cost centre',
        Math.min(0.16, 0.06 * (ordered.length - 1)),
        `${ordered.length} lines${sample ? `, descriptions ${Math.round(sample.similarity * 100)}% alike` : ''}`,
      ),
    );
    if (sample && sample.costGap <= 0.001) {
      shared.push(signal('same-cost', 'Booked at exactly the same cost', 0.1, null));
    } else if (sample) {
      shared.push(
        signal(
          'close-cost',
          'Booked within a couple of percent of each other',
          0.05,
          `${Math.round(sample.costGap * 1000) / 10}% apart`,
        ),
      );
    }
    if (sample?.days !== null && sample?.days !== undefined) {
      shared.push(
        signal(
          'same-window',
          sample.days === 0 ? 'Booked on the same day' : 'Booked within the same few weeks',
          sample.days === 0 ? 0.12 : 0.06,
          sample.days === 0 ? null : `${sample.days} days apart`,
        ),
      );
    }
    if (distinctSerials) {
      // Heavy enough to put the row below the medium threshold on its own.
      // Every line in a group carrying its own serial number is close to proof
      // that these are different machines, and a reviewer filtering to medium
      // and above should not have to read past them.
      shared.push(
        signal('distinct-serials', 'Each line carries its own serial number', -0.42, null),
      );
    } else if (distinctTags) {
      shared.push(signal('distinct-tags', 'Each line carries its own asset tag', -0.2, null));
    } else {
      shared.push(
        signal('no-distinguishing-tag', 'Nothing on the rows tells the copies apart', 0.1, null),
      );
    }

    ordered.forEach(({ asset, appraisal }, index) => {
      const keeps = index === 0;
      if (!keeps) {
        excessCost += asset.originalCost ?? 0;
        excessValue += appraisal.marketValue;
      }
      plans.push({
        asset,
        scheduleValue: appraisal.marketValue,
        assessedAsFiled: appraisal.marketValue,
        correctedValue: keeps ? appraisal.marketValue : 0,
        signals: keeps
          ? [
              signal(
                'kept-copy',
                'The copy that stays on the return if the group is one asset',
                0,
                null,
              ),
              ...shared,
            ]
          : shared,
        // A double entry was double from the day it was booked, so every year
        // since is exposed — subject to the route's own window.
        firstExposedYear: keeps ? null : (asset.acquisitionYear ?? null),
      });
    });
  }
  return { plans, groups, excessCost, excessValue };
}

/** Days between two acquisition dates, or null when either is only a year. */
function dayGap(a: SavingsAsset, b: SavingsAsset): number | null {
  const da = Date.parse(a.acquisitionDate ?? '');
  const db = Date.parse(b.acquisitionDate ?? '');
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round(Math.abs(da - db) / 86_400_000);
}

/**
 * How alike two descriptions are.
 *
 * Two measures, and the higher one wins, because register wording fails in two
 * different directions. Overlap catches "CNC LATHE HAAS ST-20" against itself
 * spelled differently. Containment catches the case the old exact-match
 * detector was blind to and which is most of the real money: a project booked
 * once as "CONVEYOR SYSTEM" and again as "CONVEYOR SYSTEM PHASE 2", where every
 * word of the shorter line appears in the longer one. Containment counts only
 * when the shorter side has at least two words — otherwise "PUMP" would be
 * contained in every pump on the register.
 *
 * One thing overrules both. A model number is an identity claim, and two
 * different ones settle the question outright: "PUMP MDX-400" and "PUMP MDX-700"
 * share every word and are not the same machine. Hyphens and spaces inside a
 * model number are export noise, so ST-20 and ST 20 are read as one thing.
 */
export function tokenSimilarity(a: string, b: string): number {
  const ma = modelNumbers(a);
  const mb = modelNumbers(b);
  if (ma.size > 0 && mb.size > 0 && ![...ma].some((m) => mb.has(m))) return 0;

  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;
  const jaccard = shared / (ta.size + tb.size - shared);
  const smaller = Math.min(ta.size, tb.size);
  return Math.max(jaccard, smaller >= 2 ? shared / smaller : 0);
}

function modelNumbers(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z]{1,8}[- ]?\d{2,}/g) ?? []).map((m) => m.replace(/[- ]/g, '')),
  );
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1 && !/^\d+$/.test(token)),
  );
}

/* ========================================================================== */
/*  3. Property in the wrong class                                            */
/* ========================================================================== */

/**
 * Misclassification as a finding with its own dollars.
 *
 * It already existed as a *decision* — the classification engine puts every
 * asset in a category and a reviewer can change it. What it never was is a
 * finding: nothing on the report said "this is in the wrong class and that is
 * worth $14,000", because by the time the report ran the classification was
 * simply the truth.
 *
 * Two rules, and only two, because both rest on something the register itself
 * says rather than on our own opinion of the class:
 *
 *   - **The client's own book life disagrees.** A register that depreciates a
 *     thing over five years while we render it over fifteen is the client
 *     telling us what they think it is. They are not the authority — the
 *     district's table is — but a gap that large is usually a class error, and
 *     the corrected number is what the district's own table produces for the
 *     life the client's books imply.
 *   - **Its peers disagree.** The same wording, in the same cost centre, put in
 *     a different category three or more times. One row against several is far
 *     more likely to be the odd one out than the several are.
 *
 * Both are priced by re-running the district's arithmetic, never by an
 * adjustment factor — so what a reader disagrees with is the class, not the
 * maths.
 */
const LIFE_GAP = 0.4;

export function misclassificationPlans(
  candidates: readonly Candidate[],
  ctx: DetectorContext,
): RowPlan[] {
  const { schedule } = ctx;
  if (!schedule) return [];
  const out: RowPlan[] = [];

  // Peers: folded description within a cost centre, and what they were called.
  const peers = new Map<string, Map<string, number>>();
  for (const { asset } of candidates) {
    const key = peerKey(asset);
    if (!key || !asset.categoryKey) continue;
    const counts = peers.get(key) ?? new Map<string, number>();
    counts.set(asset.categoryKey, (counts.get(asset.categoryKey) ?? 0) + 1);
    peers.set(key, counts);
  }

  for (const { asset, appraisal } of candidates) {
    const life = classLife(appraisal);
    const signals: DetectionSignal[] = [];
    let correctedValue: number | null = null;

    const booked = bookLife(asset.registerLife);
    if (life !== null && booked !== null && booked < life * (1 - LIFE_GAP)) {
      const target = nearestLifeClass(booked);
      const revalued = revalue(asset, ctx, asset.categoryKey!, target);
      if (revalued !== null && revalued < appraisal.marketValue) {
        correctedValue = revalued;
        signals.push(
          signal(
            'book-life-shorter',
            'The client’s own books depreciate this far faster than the class we render it on',
            0.18,
            `${booked} years in the register against ${life} on the district’s table`,
          ),
        );
      }
    }

    const key = peerKey(asset);
    const counts = key ? peers.get(key) : undefined;
    if (counts && asset.categoryKey) {
      const mine = counts.get(asset.categoryKey) ?? 0;
      const [topKey, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
      if (topKey !== asset.categoryKey && topCount >= 3 && mine <= 1) {
        const revalued = revalue(asset, ctx, topKey, undefined);
        if (revalued !== null && revalued < appraisal.marketValue) {
          correctedValue = Math.min(correctedValue ?? Number.POSITIVE_INFINITY, revalued);
          signals.push(
            signal(
              'peer-outlier',
              'Identical lines in the same department are classified differently',
              0.14,
              `${topCount} of them are ${classificationLabel(topKey)}`,
            ),
          );
        }
      }
    }

    if (correctedValue === null || signals.length === 0) continue;
    signals.push(
      signal(
        'class-is-judgement',
        'The district decides the class, and reads machinery lives off the SIC table',
        -0.12,
        null,
      ),
    );
    out.push({
      asset,
      scheduleValue: appraisal.marketValue,
      assessedAsFiled: appraisal.marketValue,
      correctedValue,
      signals,
      // A class error is an error in the rendition, and it has been there since
      // the asset was first rendered.
      firstExposedYear: asset.acquisitionYear,
    });
  }
  return out;
}

function peerKey(asset: SavingsAsset): string | null {
  const description = asset.description?.trim();
  if (!description) return null;
  const folded = [...tokens(description)].sort().join(' ');
  if (!folded) return null;
  return `${asset.costCenter?.trim().toLowerCase() ?? ''}|${folded}`;
}

/** "5", "5 years", "60" (months), "05.0" — registers write it every way. */
export function bookLife(raw: string | null | undefined): number | null {
  const text = raw?.trim();
  if (!text) return null;
  const match = /(\d+(?:\.\d+)?)/.exec(text);
  if (!match) return null;
  let years = Number(match[1]);
  if (!Number.isFinite(years) || years <= 0) return null;
  // Months, where the wording says so or the magnitude gives it away. Nothing
  // over forty is accepted as years below, so a bare "60" is sixty months —
  // the five-year life registers write more than any other — not a life no
  // schedule carries.
  if (/month/i.test(text) || years > 40) years = years / 12;
  return years >= 1 && years <= 40 ? Math.round(years) : null;
}

function nearestLifeClass(years: number): LifeClass {
  return LIFE_CLASSES.reduce((best, candidate) =>
    Math.abs(candidate - years) < Math.abs(best - years) ? candidate : best,
  );
}

function revalue(
  asset: SavingsAsset,
  ctx: DetectorContext,
  categoryKey: string,
  lifeClassOverride: LifeClass | undefined,
): number | null {
  if (!ctx.schedule) return null;
  const result = appraise(
    {
      originalCost: asset.originalCost ?? Number.NaN,
      acquisitionYear: asset.acquisitionYear ?? Number.NaN,
      categoryKey,
      lifeClassOverride,
      businessSic: ctx.businessSic,
    },
    ctx.schedule,
  );
  return result.ok ? result.value.marketValue : null;
}

/* ========================================================================== */
/*  4. Property being rendered to the wrong district                          */
/* ========================================================================== */

/**
 * Situs errors: property on this return that was not here on January 1.
 *
 * Worth being precise about what this finding claims, because it is the one
 * most easily oversold. It does not say the property is untaxed. It says it is
 * on the *wrong account*, and coming off here usually means going on somewhere
 * else — occasionally at a lower rate, occasionally at a higher one. The
 * summary says so; a report that quietly booked a transfer as a saving would be
 * the kind of thing a district enjoys finding.
 *
 * Three rules, in descending order of how much the record supports them:
 *
 *   - The asset is placed at a site in a different county from the one this
 *     return is being filed in. That is the firm's own site record disagreeing
 *     with the filing, and it is close to decisive.
 *   - The register names a location that is not on the client's site list at
 *     all — usually a site they closed, which is where the doc's "assets at
 *     closed sites" actually lives given no register carries a closed flag.
 *   - The asset was acquired within a few weeks of the lien date, where whether
 *     it was here on January 1 is a genuinely open question rather than an
 *     error. Priced, but as the weakest of the three.
 */
const LIEN_WINDOW_DAYS = 45;

export function situsPlans(candidates: readonly Candidate[], ctx: DetectorContext): RowPlan[] {
  const out: RowPlan[] = [];
  const lien = Date.parse(`${ctx.taxYear}-01-01T00:00:00Z`);

  for (const { asset, appraisal } of candidates) {
    const signals: DetectionSignal[] = [];

    const placedElsewhere =
      asset.site?.jurisdictionId != null &&
      ctx.jurisdictionId != null &&
      asset.site.jurisdictionId !== ctx.jurisdictionId;
    if (placedElsewhere) {
      signals.push(
        signal(
          'placed-in-another-county',
          'Placed at a site in a different appraisal district from this return',
          0.3,
          `${asset.site!.label}${asset.site!.jurisdictionName ? ` — ${asset.site!.jurisdictionName}` : ''}`,
        ),
      );
    }

    const location = asset.registerLocation?.trim();
    if (
      location &&
      ctx.knownLocations.size > 0 &&
      !ctx.knownLocations.has(foldLocation(location))
    ) {
      signals.push(
        signal(
          'location-not-on-file',
          'The register puts it at a location that is not one of the client’s sites',
          0.16,
          `“${location}”`,
        ),
      );
    }

    const acquired = Date.parse(asset.acquisitionDate ?? '');
    if (!Number.isNaN(acquired) && Math.abs(acquired - lien) / 86_400_000 <= LIEN_WINDOW_DAYS) {
      signals.push(
        signal(
          'acquired-near-lien-date',
          'Bought within weeks of January 1, so whether it was here that day is a real question',
          0.1,
          asset.acquisitionDate!.trim(),
        ),
      );
    }

    if (signals.length === 0) continue;
    signals.push(
      signal(
        'moves-rather-than-vanishes',
        'Off this account usually means onto another one, not out of tax',
        -0.16,
        null,
      ),
    );
    out.push({
      asset,
      scheduleValue: appraisal.marketValue,
      assessedAsFiled: appraisal.marketValue,
      correctedValue: 0,
      signals,
      // 25.25(c) reaches property that does not exist at the location described,
      // and a site error is normally as old as the placement.
      firstExposedYear: placedElsewhere ? asset.acquisitionYear : null,
    });
  }
  return out;
}

/* ========================================================================== */
/*  5. Leased property rendered by the wrong party                            */
/* ========================================================================== */

/**
 * Distinct from the leasehold-improvements finding, which is about build-out
 * the landlord's real property assessment may already reach. This is about
 * equipment: a copier, a forklift, a fleet vehicle that the lessor owns and
 * renders itself. Both parties rendering the same machine to the same district
 * is a double assessment, and the district has no way to notice.
 */
export function leasedPlans(candidates: readonly Candidate[]): RowPlan[] {
  const out: RowPlan[] = [];
  for (const { asset, appraisal } of candidates) {
    if (asset.categoryKey === 'leasehold-improvements') continue;
    const signals = leaseSignals({
      description: asset.description,
      glAccount: asset.glAccount,
      vendor: asset.vendor,
      registerCategory: asset.registerCategory,
      depreciationMethod: asset.depreciationMethod,
    });
    if (signals.length === 0) continue;
    out.push({
      asset,
      scheduleValue: appraisal.marketValue,
      assessedAsFiled: appraisal.marketValue,
      correctedValue: 0,
      signals,
      firstExposedYear: asset.acquisitionYear,
    });
  }
  return out;
}

/* ========================================================================== */
/*  6. Idle and obsolete                                                      */
/* ========================================================================== */

/**
 * Property the client's own books have already given up on.
 *
 * The register carries one piece of obsolescence evidence and one only: a book
 * value written to nothing earlier than the depreciation method would have got
 * there. That is an impairment, and an impairment is an accountant's signed
 * opinion that the asset stopped being worth what it cost.
 *
 * It settles nothing by itself — the district values on its own schedules and
 * is not bound by anyone's book — so this stays a screening finding with the
 * cost behind it named, which is exactly what the doc asks for. What makes it
 * worth putting in front of a client is that the answer is usually a photograph
 * and a sentence.
 */
export function idlePlans(candidates: readonly Candidate[], ctx: DetectorContext): RowPlan[] {
  const out: RowPlan[] = [];
  for (const { asset, appraisal } of candidates) {
    const fired = impairmentSignal({
      originalCost: asset.originalCost,
      netBookValue: asset.netBookValue,
      accumulatedDepreciation: asset.accumulatedDepreciation,
      age: ageOf(asset, ctx.taxYear),
      classLife: classLife(appraisal),
    });
    if (!fired) continue;
    out.push({
      asset,
      scheduleValue: appraisal.marketValue,
      assessedAsFiled: appraisal.marketValue,
      // The ceiling on the answer rather than the answer: obsolescence is
      // argued as a percentage off market value, and the register does not say
      // what percentage. Priced at full removal so the row carries the size of
      // the question, and discounted hard by the signals below.
      correctedValue: 0,
      signals: [
        fired,
        signal(
          'book-is-not-market',
          'A district values on its own schedules, not on the client’s book value',
          -0.2,
          'Tax Code 23.01(b) asks for market value; an impairment is where that argument starts',
        ),
      ],
      firstExposedYear: null,
    });
  }
  return out;
}

/* ========================================================================== */
/*  7. Under the threshold entirely                                           */
/* ========================================================================== */

export interface DeMinimisGroup {
  jurisdictionId: string | null;
  jurisdictionName: string | null;
  siteLabels: string[];
  marketValue: number;
  threshold: number;
  plans: RowPlan[];
}

/**
 * The whole location, exempt.
 *
 * Tax Code 11.145 exempts a person's income-producing tangible personal
 * property when the total value of that property *in the taxing unit* is under
 * the threshold — $2,500 before 2026, $125,000 after HB 9 and Proposition 9.
 * It is not a deduction off the top: fall under it and the entire position goes
 * to zero, which is why it deserves to be a finding rather than a line in the
 * exemption block. A client with four small satellite offices in four counties
 * may owe nothing at three of them.
 *
 * Grouped by appraisal district rather than by site, because that is the grain
 * the statute is written at. Where several sites sit in one district their
 * values add, and the finding says which sites it added — a client who reads
 * "under the threshold" about one building when it was really three needs to
 * see the three.
 */
export function deMinimisGroups(
  candidates: readonly Candidate[],
  ctx: DetectorContext,
): DeMinimisGroup[] {
  if (ctx.exemptionAmount <= 0) return [];
  const groups = new Map<string, { candidates: Candidate[]; sites: Set<string>; value: number }>();
  for (const candidate of candidates) {
    const key = candidate.asset.site?.jurisdictionId ?? ctx.jurisdictionId ?? '(unplaced)';
    const group = groups.get(key) ?? { candidates: [], sites: new Set<string>(), value: 0 };
    group.candidates.push(candidate);
    if (candidate.asset.site) group.sites.add(candidate.asset.site.label);
    group.value += candidate.appraisal.marketValue;
    groups.set(key, group);
  }

  const out: DeMinimisGroup[] = [];
  for (const [key, group] of groups) {
    if (group.value === 0 || group.value >= ctx.exemptionAmount) continue;
    // One district out of one is not a finding — it is the exemption block on
    // the report, which already says the whole position falls under. This
    // finding exists to catch the *part* of a business that does.
    if (groups.size === 1) continue;
    const first = group.candidates[0]!.asset.site;
    out.push({
      jurisdictionId: key === '(unplaced)' ? null : (first?.jurisdictionId ?? ctx.jurisdictionId),
      jurisdictionName: first?.jurisdictionName ?? ctx.jurisdictionName,
      siteLabels: [...group.sites].sort(),
      marketValue: group.value,
      threshold: ctx.exemptionAmount,
      plans: group.candidates.map(({ asset, appraisal }) => ({
        asset,
        scheduleValue: appraisal.marketValue,
        assessedAsFiled: appraisal.marketValue,
        correctedValue: 0,
        signals: [
          signal(
            'under-threshold',
            'Everything the client has in this district adds to less than the exemption',
            0.26,
            `${Math.round(group.value).toLocaleString('en-US')} against a ${Math.round(ctx.exemptionAmount).toLocaleString('en-US')} threshold`,
          ),
          signal(
            'exemption-must-be-claimed',
            'The exemption is per taxing unit, and the district decides whether the total falls under it',
            -0.1,
            null,
          ),
        ],
        firstExposedYear: null,
      })),
    });
  }
  return out;
}

/* ========================================================================== */
/*  8. Last year's mistake, carried forward                                   */
/* ========================================================================== */

/** One line of what was actually filed, as the mapped prior return records it. */
export interface PriorLine {
  categoryKey: string | null;
  yearAcquired: number | null;
  historicalCost: number | null;
}

export interface PriorFiling {
  taxYear: number;
  lines: PriorLine[];
}

/**
 * The firm-side comparison, promoted into something the client sees.
 *
 * `compareRegister` has existed for a while and it is the practitioner's tool:
 * it reconciles a filed return against the register line by line so a preparer
 * can see what moved. What it never did is put a number in front of the
 * taxpayer, and the number is the whole point — a category over-reported once
 * gets copied into next year's return, and the year after that, because nobody
 * re-derives a rendition from scratch. That is what makes this different from
 * the other eleven: it is the only finding that is *about* the return rather
 * than about the property, and it compounds.
 *
 * The grain is the form's own — schedule category and year acquired — because
 * that is all a rendition reports. Where the return claims more historical cost
 * in a bucket than the register holds, the excess is over-reported, and the
 * rows are the register's own assets in that bucket each carrying a pro-rata
 * share. Pro-rata is an allocation, not a measurement, and the signal on every
 * row says so.
 */
const CARRY_TOLERANCE = 0.02;

export function carryForwardPlans(
  candidates: readonly Candidate[],
  prior: PriorFiling | null,
): RowPlan[] {
  if (!prior || prior.lines.length === 0) return [];

  const reported = new Map<string, number>();
  for (const line of prior.lines) {
    if (!line.categoryKey || line.historicalCost === null) continue;
    const key = `${line.categoryKey}|${line.yearAcquired ?? '~'}`;
    reported.set(key, (reported.get(key) ?? 0) + line.historicalCost);
  }
  if (reported.size === 0) return [];

  const held = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const { asset } = candidate;
    if (!asset.categoryKey) continue;
    const key = `${asset.categoryKey}|${asset.acquisitionYear ?? '~'}`;
    const group = held.get(key) ?? [];
    group.push(candidate);
    held.set(key, group);
  }

  const out: RowPlan[] = [];
  for (const [key, group] of held) {
    const claimed = reported.get(key);
    if (claimed === undefined) continue;
    const actual = group.reduce((sum, c) => sum + (c.asset.originalCost ?? 0), 0);
    if (actual <= 0) continue;
    const excess = claimed - actual;
    if (excess <= actual * CARRY_TOLERANCE) continue;

    const [categoryKey, year] = key.split('|');
    const share = excess / claimed;
    for (const { asset, appraisal } of group) {
      out.push({
        asset,
        scheduleValue: appraisal.marketValue,
        // What the return implies this row carries: its own share of the
        // over-reported bucket on top of its schedule value.
        assessedAsFiled: appraisal.marketValue / (1 - share),
        correctedValue: appraisal.marketValue,
        signals: [
          signal(
            'over-reported-bucket',
            'Last year’s return claimed more cost in this bucket than the register holds',
            0.2,
            `${classificationLabel(categoryKey!)}${year === '~' ? '' : `, acquired ${year}`}: ${Math.round(claimed).toLocaleString('en-US')} filed against ${Math.round(actual).toLocaleString('en-US')} on the books`,
          ),
          signal(
            'pro-rata-allocation',
            'The excess is spread across the bucket’s rows, not traced to this one',
            -0.14,
            'a rendition reports in aggregate and never names assets',
          ),
        ],
        firstExposedYear: prior.taxYear,
      });
    }
  }
  return out;
}

/* ========================================================================== */
/*  9. Cost that was never assessable in the first place                      */
/* ========================================================================== */

/** What an invoice turned out to be, once its lines were read. */
export interface InvoiceSplit {
  assetId: string;
  /** The capitalized amount the register carries for this asset. */
  bookedCost: number;
  /** The part of it that is tangible personal property. */
  assessableCost: number;
  /** Line descriptions behind the excluded part, for the evidence panel. */
  excluded: { label: string; amount: number }[];
  /** The extractor's own confidence in the lines it read. */
  extractionConfidence: number;
  /** Whether a person has looked at the extraction. */
  reviewed: boolean;
  documentLabel: string | null;
}

/**
 * The highest-dollar category in the doc, and the one with the largest gap
 * between what a register says and what is true.
 *
 * A capitalized amount is an accounting total, not a description of property.
 * A $340,000 line reading "PACKAGING LINE" routinely contains freight,
 * millwright labour, rigging, engineering, a software licence, sales tax and a
 * year of maintenance — and Texas assesses the machine, not the invoice. None
 * of that is visible in a fixed asset register at any level of care, which is
 * why this detector is the only one in the file that cannot run on the register
 * alone: it needs the invoice behind the line.
 *
 * So the shape here is deliberately narrow. It does not guess. Where no invoice
 * has been read for an asset, there is no finding — an estimated installation
 * percentage would be the single easiest way to put a number in front of a tax
 * director that they can disprove in one phone call to their controller.
 *
 * What it does instead is re-run the district's own arithmetic on the reduced
 * cost, so the position is "this machine cost $290,000, not $340,000" rather
 * than "take 15% off". The rest is a confidence question: an extraction nobody
 * has checked says so with much less force than one a preparer has signed off.
 */
export function nonAssessablePlans(
  candidates: readonly Candidate[],
  ctx: DetectorContext,
  splits: ReadonlyMap<string, InvoiceSplit>,
): RowPlan[] {
  if (splits.size === 0 || !ctx.schedule) return [];
  const out: RowPlan[] = [];
  for (const { asset, appraisal } of candidates) {
    const split = splits.get(asset.id);
    if (!split) continue;
    const removed = split.bookedCost - split.assessableCost;
    if (removed <= 0 || split.assessableCost <= 0) continue;

    const result = appraise(
      {
        originalCost: split.assessableCost,
        acquisitionYear: asset.acquisitionYear ?? Number.NaN,
        categoryKey: asset.categoryKey ?? '',
        lifeClassOverride: (asset.lifeClassOverride ?? undefined) as LifeClass | undefined,
        businessSic: ctx.businessSic,
      },
      ctx.schedule,
    );
    if (!result.ok) continue;

    const share = removed / split.bookedCost;
    const signals: DetectionSignal[] = [
      signal(
        'invoice-read',
        'The invoice behind this line was read, and part of it is not tangible property',
        0.3,
        `${Math.round(share * 100)}% of ${Math.round(split.bookedCost).toLocaleString('en-US')}${split.documentLabel ? ` — ${split.documentLabel}` : ''}`,
      ),
    ];
    const top = [...split.excluded].sort((a, b) => b.amount - a.amount).slice(0, 3);
    if (top.length > 0) {
      signals.push(
        signal(
          'excluded-lines',
          'What came out',
          0,
          top
            .map((line) => `${line.label} ${Math.round(line.amount).toLocaleString('en-US')}`)
            .join('; '),
        ),
      );
    }
    signals.push(
      split.reviewed
        ? signal('extraction-reviewed', 'A preparer has checked the extracted lines', 0.14, null)
        : signal(
            'extraction-unreviewed',
            'Read by the extractor and not yet checked by a person',
            -0.2,
            `field confidence ${Math.round(split.extractionConfidence * 100)}%`,
          ),
    );
    if (!split.reviewed && split.extractionConfidence < 0.7) {
      signals.push(
        signal('low-field-confidence', 'Several fields on this invoice read poorly', -0.16, null),
      );
    }

    out.push({
      asset,
      scheduleValue: appraisal.marketValue,
      assessedAsFiled: appraisal.marketValue,
      correctedValue: result.value.marketValue,
      signals,
      assessableCost: split.assessableCost,
      // The invoice was wrong on the day it was capitalized, so every year the
      // asset has been rendered has carried the same overstatement.
      firstExposedYear: asset.acquisitionYear,
    });
  }
  return out;
}
