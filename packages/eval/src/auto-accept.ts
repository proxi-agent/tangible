import type { AutoAcceptPoint, AutoAcceptReport, ClassificationLabel } from '@tangible/types';
import { MIN_JUDGED } from './metrics.js';

/**
 * What the reviewers have said about the classification bar.
 *
 * The detector thresholds have had a sweep since the harness was written, and
 * it works because a flagged row is shown to a person whatever its score: the
 * labels cover the whole range, so moving the floor in either direction has a
 * measurable price. The classification bar is not like that. It decides which
 * rows a person ever sees, so the rows it accepts produce no judgement at all,
 * and the dataset it generates is a half-line rather than a range.
 *
 * That is a property of the control, not a shortcoming of this file, and the
 * only dishonest thing available here would be to let an empty band read as a
 * cheap one. So a candidate bar reports what it would change, how much of that
 * change is wrong, and whether that second number rests on anything. A bar
 * above the live one currently rests on nothing and says so.
 *
 * There is no recall here either, for the reason `metrics.ts` gives: what the
 * classifier missed is not knowable from decisions about what it produced.
 */

/** Where the classifier's bar could plausibly sit. The live one is added too. */
const SWEEP = [0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * The band of rows a move to `threshold` would change the treatment of.
 *
 * Lowering the bar hands rows in [threshold, live) to no one; raising it hands
 * rows in [live, threshold) to a reviewer. Rows outside the band are treated
 * the same before and after, and counting them would make every candidate look
 * about as good as every other.
 */
function band(
  labels: ClassificationLabel[],
  threshold: number,
  live: number,
): ClassificationLabel[] {
  if (threshold < live) {
    return labels.filter((l) => l.confidence >= threshold && l.confidence < live);
  }
  if (threshold > live) {
    return labels.filter((l) => l.confidence >= live && l.confidence < threshold);
  }
  return [];
}

function pointAt(labels: ClassificationLabel[], threshold: number, live: number): AutoAcceptPoint {
  const direction = threshold < live ? 'lower' : threshold > live ? 'raise' : 'live';
  const affected = band(labels, threshold, live);
  return {
    threshold,
    direction,
    affected: affected.length,
    // An empty band is unknown, not free. The live bar is the one exception:
    // it changes nothing, so nothing about it is unknown.
    wrong:
      direction === 'live'
        ? 0
        : affected.length > 0
          ? affected.filter((l) => !l.agreed).length
          : null,
    observed: direction === 'live' || affected.length > 0,
  };
}

export function autoAcceptReport(
  labels: ClassificationLabel[],
  liveThreshold: number,
): AutoAcceptReport {
  // Memory replays are excluded from every threshold number below. A remembered
  // decision carries confidence 1 because a person was sure, not because the
  // model was, and the bar never governed it — letting those rows into the
  // sweep would move the bar on the strength of rows it does not control.
  const model = labels.filter((l) => l.source === 'ai');
  const memory = labels.filter((l) => l.source === 'memory');

  const below = model.filter((l) => l.confidence < liveThreshold);
  const above = model.filter((l) => l.confidence >= liveThreshold);
  const agreed = model.filter((l) => l.agreed).length;

  const thresholds = [...new Set([...SWEEP, liveThreshold])].sort((a, b) => a - b);

  return {
    liveThreshold,
    labels: model.length,
    below: below.length,
    belowAgreed: below.filter((l) => l.agreed).length,
    above: above.length,
    aboveAgreed: above.filter((l) => l.agreed).length,
    points: thresholds.map((threshold) => pointAt(model, threshold, liveThreshold)),
    memoryJudged: memory.length,
    memoryOverruled: memory.filter((l) => !l.agreed).length,
    agreement: model.length >= MIN_JUDGED ? round(agreed / model.length, 4) : null,
  };
}
