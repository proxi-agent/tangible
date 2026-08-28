import type { DetectionSignal } from '@tangible/types';
import { EVIDENCE_SOURCES } from './sources.js';
import type { EvidenceResult } from './match.js';

/**
 * External evidence, in the language the confidence engine already speaks.
 *
 * Everything before this file is about establishing facts. This file is about
 * what those facts are worth to a specific position, and the two must not be
 * folded together: a work order against a pump is the same fact whether we are
 * arguing the pump is a ghost or arguing it is leased, and it moves those two
 * findings in opposite directions.
 *
 * So weights are per finding, not per match. A CMMS match is strong evidence
 * *against* a ghost finding and no evidence at all about misclassification. A
 * lease-subledger match is the whole case for a leased-asset finding and says
 * nothing about whether the asset exists.
 *
 * The signals come back with negative weights more often than positive ones,
 * and that is the point of the exercise. The register-only signals in
 * `@tangible/savings` are all reasons to suspect. These are the first signals in
 * the product capable of *clearing* an asset, and a queue that can only accuse
 * is a queue that grows until nobody works it.
 */

/**
 * How much a source's word is worth on a finding, before the match's own score
 * scales it.
 *
 * A blank means the source has nothing to say about that finding — which is most
 * of this table, and deliberately so. The temptation with external data is to
 * let every source nudge every score a little; that produces a model where
 * nothing is ever clearly right or wrong and every row lands in the middle.
 */
const AFFIRMS: Readonly<Record<string, Partial<Record<string, number>>>> = {
  'ghost-assets': {
    cmms: -0.35,
    itam: -0.4,
    'insurance-sov': -0.2,
    'physical-inventory': -0.5,
  },
  'suspected-retired': {
    cmms: -0.4,
    itam: -0.45,
    'insurance-sov': -0.2,
    'physical-inventory': -0.5,
  },
  'idle-obsolete': { cmms: -0.3, itam: -0.25 },
  'leased-double-report': { 'lease-subledger': 0.4 },
  'leasehold-double-tax': { 'real-property': 0.35 },
};

/**
 * What a negative statement is worth, which is not the mirror of the positive.
 *
 * An asset absent from a maintenance system is *suspicious*; an asset present in
 * one is *proven*. The asymmetry is real and the weights say so — a source's
 * deny is set well under its affirm, which is what stops a thin export from
 * manufacturing findings.
 *
 * The physical count is where that gap closes furthest, and it is the whole
 * reason to take one. The asymmetry above exists because the other systems
 * record activity incidentally: a pump can be perfectly real and absent from the
 * maintenance log because nobody has had to fix it. A count has no such excuse —
 * establishing what is present was the entire purpose of the exercise — so it is
 * the one source here whose deny weight is set *above* its affirm weight, and
 * its silence is worth roughly twice any other source's.
 *
 * It still does not overtake a match. `gatherEvidence` discounts every negative
 * below a positive of the same source and this table does not get to override
 * that, which is correct: a count can miss an asset that is out for repair, in a
 * room nobody walked, or wearing a tag that would not scan. Standing in front of
 * the thing remains the stronger statement. A count that came back empty is as
 * close to proof of a ghost as this product gets without being it.
 */
const DENIES: Readonly<Record<string, Partial<Record<string, number>>>> = {
  'ghost-assets': { cmms: 0.22, itam: 0.28, 'physical-inventory': 0.55 },
  'suspected-retired': { cmms: 0.25, itam: 0.3, 'physical-inventory': 0.55 },
  'leased-double-report': { 'lease-subledger': -0.45 },
  'leasehold-double-tax': { 'real-property': -0.4 },
};

/**
 * The signals one asset's evidence produces for one finding.
 *
 * Each signal's `detail` carries the method and the two sides of the match,
 * because the reviewer's question is never "did it match" — it is "matched on
 * what?", and a signal that cannot answer that is a signal they will ignore.
 */
export function evidenceSignals(evidence: EvidenceResult, findingKey: string): DetectionSignal[] {
  const signals: DetectionSignal[] = [];
  const affirms = AFFIRMS[findingKey] ?? {};
  const denies = DENIES[findingKey] ?? {};

  for (const match of evidence.matches) {
    const base = affirms[match.source];
    if (base === undefined) continue;
    const profile = EVIDENCE_SOURCES[match.source];
    signals.push({
      code: `evidence-${match.source}`,
      // The source's own `affirms` sentence, so the words on the finding are the
      // words that were reviewed when the source was added.
      label: profile.affirms,
      // Scaled by the match's strength: a description match moves a score about
      // half as far as a serial number, which is the honest difference.
      weight: Math.round(base * match.score * 100) / 100,
      detail: `${profile.label}: matched on ${match.method} — ${match.on}${
        match.lastSeenOn ? `, last seen ${match.lastSeenOn}` : ''
      }`,
    });
  }

  for (const negative of evidence.negatives) {
    const base = denies[negative.source];
    if (base === undefined) continue;
    signals.push({
      code: `evidence-${negative.source}-none`,
      label: negative.statement,
      weight: Math.round(base * negative.score * 100) / 100,
      detail: `${EVIDENCE_SOURCES[negative.source].label}: no match across ${negative.searched} records searched`,
    });
  }

  return signals;
}

/**
 * The sentence a report prints when a source was consulted and said nothing.
 *
 * Separate from the signals because it is not always worth a weight and is
 * always worth saying. "We checked the maintenance system and it has never seen
 * this asset" is the line that turns a statistical flag into something a
 * controller can act on, and it belongs on the page whether or not it moved the
 * score.
 */
export function negativeStatements(evidence: EvidenceResult): string[] {
  return evidence.negatives.map(
    (negative) =>
      `No match found in ${EVIDENCE_SOURCES[negative.source].label.toLowerCase()} across ${negative.searched} records. ${negative.statement}`,
  );
}

/**
 * What a screen says about a source that was never going to answer.
 *
 * Printed rather than hidden: an operator who cannot see that the maintenance
 * system was out of scope for a desk will keep asking why the desk was not
 * checked against it.
 */
export function silenceNotes(evidence: EvidenceResult): string[] {
  return evidence.silent.map(
    (kind) =>
      `${EVIDENCE_SOURCES[kind].label} does not cover this kind of asset, so it was not searched and its silence means nothing.`,
  );
}
