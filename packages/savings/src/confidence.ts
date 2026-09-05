import type { ConfidenceTier, DetectionSignal, RowConfidence } from '@tangible/types';

/**
 * How sure we are about one row, and why.
 *
 * Confidence already existed in this product — the mapping agent and the
 * classification agent both produce one — but it lived inside the AI layer and
 * died there, which meant a finding could not say whether it was the obvious
 * kind or the arguable kind. That is the wrong place for it. Confidence is a
 * property of a *position*, not of a model call: a disposed asset with a
 * disposal date on it is a strong position whether a model or a rule found it,
 * and a leasehold flagged purely because of its category is a weak one either
 * way.
 *
 * So a score here is built from named signals, each with a weight, and every
 * signal is kept on the row. Three things follow that would not from a bare
 * number:
 *
 *   - a reviewer who disagrees can see *which* signal to argue with;
 *   - the detection basis at the top of a category page is a group-by over
 *     these rather than prose somebody has to keep true;
 *   - when the dispositions come back, each one is a label attached to the
 *     signals that produced it, which is the only form in which this is worth
 *     learning from later.
 *
 * The weights are judgement, not measurement, and the last of those three is
 * how they stop being judgement: once enough decisions have come back for a
 * finding, `model.ts` refits them against what reviewers actually said and
 * `confidenceFor` consults the fit instead. Until that happens — and it happens
 * per finding, not all at once — they are at least legible judgement: every one
 * of them is a sentence about tax, written down next to the number.
 */

/** Above this, a reviewer can act without going back to the register. */
const HIGH = 0.75;
/** Below this, the row is a lead rather than a position. */
const MEDIUM = 0.45;

export function tierFor(score: number): ConfidenceTier {
  if (score >= HIGH) return 'high';
  if (score >= MEDIUM) return 'medium';
  return 'low';
}

export const CONFIDENCE_THRESHOLDS = { high: HIGH, medium: MEDIUM } as const;

/**
 * Where each finding starts before its rows are looked at.
 *
 * This is the part of a row's confidence that belongs to the finding rather
 * than to the asset: a disposal is close to unarguable before we know anything
 * about the particular row, and a freeport lead is a question no register can
 * answer however good the row is. The per-row signals move it from there.
 */
const BASE: Record<string, number> = {
  // A recorded disposal is the least arguable thing on the list.
  'ghost-assets': 0.72,
  'non-taxable': 0.62,
  // The invoice is read, but reading an invoice is not the same as a preparer
  // agreeing with how its lines were split. The row's own signals settle that.
  'non-assessable-cost': 0.6,
  'de-minimis': 0.6,
  // Four things agreeing about two rows, which is a real claim and still a
  // claim — the register cannot distinguish a double entry from a real pair.
  'duplicate-capitalization': 0.5,
  'carryforward-error': 0.5,
  // Both of these are arguments to be made rather than errors to be corrected:
  // the class is the district's to decide, and property in the wrong place
  // usually moves rather than vanishes.
  misclassification: 0.4,
  'situs-error': 0.44,
  'fully-depreciated': 0.44,
  'leased-double-report': 0.4,
  'leasehold-double-tax': 0.36,
  freeport: 0.34,
  // Nothing in the register proves an asset is gone or idle. These start below
  // the medium threshold on purpose: it takes real corroborating signal to
  // lift one into a tier a reviewer filters on.
  'idle-obsolete': 0.3,
  'suspected-retired': 0.28,
};

export function baseFor(findingKey: string): number {
  return BASE[findingKey] ?? 0.5;
}

export function signal(
  code: string,
  label: string,
  weight: number,
  detail: string | null = null,
): DetectionSignal {
  return { code, label, weight, detail };
}

/**
 * The sentence a controller reads in the "why flagged" column.
 *
 * Built from the signals that *raised* the score, in the order they were
 * recorded, and then — deliberately — the strongest thing working against it.
 * A row explained only by what supports it is a row that has been sold rather
 * than reviewed, and the reviewer is the person who most needs the caveat.
 */
function explain(signals: DetectionSignal[]): string {
  const supporting = signals.filter((s) => s.weight > 0);
  const against = [...signals].filter((s) => s.weight < 0).sort((a, b) => a.weight - b.weight)[0];
  const parts = supporting.map((s) => (s.detail ? `${s.label} (${s.detail})` : s.label));
  const head = parts.length > 0 ? parts.join('; ') : 'Flagged by the category alone';
  return against ? `${head}. Against it: ${lower(against.label)}.` : `${head}.`;
}

function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * A fitted score for this finding, where one has earned its way in.
 *
 * Passed as a function rather than as a model so this file stays the place that
 * knows what a confidence *is* without also becoming the place that knows how
 * one is fitted. Returning null is the normal case and will be for a long
 * while: it means this finding has no adopted model, and the authored weights
 * below are the answer.
 */
export type FittedScore = (findingKey: string, signals: DetectionSignal[]) => number | null;

export function confidenceFor(
  findingKey: string,
  signals: DetectionSignal[],
  fitted?: FittedScore | null,
): RowConfidence {
  const raw = signals.reduce((total, s) => total + s.weight, baseFor(findingKey));
  // Clamped rather than allowed to saturate: a score of 1 would say the
  // position cannot be wrong, and nothing about a register supports that.
  const ruled = Math.min(0.97, Math.max(0.03, raw));
  const learned = fitted ? fitted(findingKey, signals) : null;
  // Rounded before the tier is read off it, so the number a reviewer sees and
  // the band it is filed under never disagree: a raw 0.7496 printed as 0.75
  // must be high, not medium.
  const score = Math.round((learned ?? ruled) * 100) / 100;
  return {
    tier: tierFor(score),
    score,
    signals,
    // The sentence is built from the signals either way, and stays true either
    // way: the signals are what the row was flagged for, and the fit changes
    // what they are worth rather than which of them fired.
    why: explain(signals),
    basis: learned === null ? 'rules' : 'fitted',
  };
}
