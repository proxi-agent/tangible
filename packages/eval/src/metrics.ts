import type {
  CalibrationBin,
  EvalLabel,
  FindingMetrics,
  QualityReport,
  ThresholdPoint,
} from '@tangible/types';

/**
 * What the labels say about the detectors.
 *
 * Three quantities, and they answer different questions:
 *
 *   precision  — of what we showed a reviewer, how much was right. Measurable,
 *                and the number the phase asks to be readable per finding type
 *                per jurisdiction.
 *   calibration— does a 0.8 behave like a 0.8. This is what makes the
 *                confidence floor a usable control rather than a dial.
 *   threshold  — what each candidate floor costs in true positives and dollars.
 *
 * Recall is absent, deliberately and permanently from *this* file. A position
 * we never flagged produces no decision, so no volume of labels can measure how
 * much we missed. Recall is only knowable against a golden register where a
 * person has declared the full expected set by hand, and it lives there.
 */

/**
 * Below this many judged rows, precision is reported as null rather than as a
 * number. Six accepted out of six is not 100% precision, it is six rows, and a
 * dashboard that prints 100% next to it will be believed.
 */
export const MIN_JUDGED = 20;

/** What the phase is aiming at per finding type before precision is trusted. */
export const LABEL_TARGET = 200;

const Z = 1.96;

/**
 * Half-width of the 95% Wilson score interval.
 *
 * Wilson rather than the textbook normal interval because precision here is
 * routinely near 1 on small samples, exactly where the normal interval produces
 * a band that runs past 100% and a lower bound that is nonsense.
 */
export function wilsonHalfWidth(correct: number, total: number): number | null {
  if (total <= 0) return null;
  const p = correct / total;
  const denominator = 1 + (Z * Z) / total;
  const spread = Z * Math.sqrt((p * (1 - p)) / total + (Z * Z) / (4 * total * total));
  return round(spread / denominator, 4);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emptyMetrics(findingKey: string, jurisdictionId: string | null): FindingMetrics {
  return {
    findingKey,
    jurisdictionId,
    judged: 0,
    correct: 0,
    incorrect: 0,
    abstained: 0,
    precision: null,
    interval: null,
    correctValue: 0,
    incorrectValue: 0,
    labeled: 0,
    target: LABEL_TARGET,
  };
}

function accumulate(metrics: FindingMetrics, label: EvalLabel): void {
  metrics.labeled += 1;
  const value = label.decidedValue ?? 0;
  if (label.verdict === 'correct') {
    metrics.judged += 1;
    metrics.correct += 1;
    metrics.correctValue += value;
  } else if (label.verdict === 'incorrect') {
    metrics.judged += 1;
    metrics.incorrect += 1;
    metrics.incorrectValue += value;
  } else {
    metrics.abstained += 1;
  }
}

function settle(metrics: FindingMetrics): FindingMetrics {
  if (metrics.judged >= MIN_JUDGED) {
    metrics.precision = round(metrics.correct / metrics.judged, 4);
    metrics.interval = wilsonHalfWidth(metrics.correct, metrics.judged);
  }
  metrics.correctValue = Math.round(metrics.correctValue);
  metrics.incorrectValue = Math.round(metrics.incorrectValue);
  return metrics;
}

function group(labels: EvalLabel[], keyOf: (l: EvalLabel) => [string, string | null]) {
  const byKey = new Map<string, FindingMetrics>();
  for (const label of labels) {
    const [findingKey, jurisdictionId] = keyOf(label);
    const mapKey = `${findingKey}::${jurisdictionId ?? '*'}`;
    let metrics = byKey.get(mapKey);
    if (!metrics) {
      metrics = emptyMetrics(findingKey, jurisdictionId);
      byKey.set(mapKey, metrics);
    }
    accumulate(metrics, label);
  }
  return [...byKey.values()].map(settle).sort(compareMetrics);
}

/** Most-judged first, then alphabetical: the order a reviewer reads it in. */
function compareMetrics(a: FindingMetrics, b: FindingMetrics): number {
  if (b.judged !== a.judged) return b.judged - a.judged;
  if (a.findingKey !== b.findingKey) return a.findingKey.localeCompare(b.findingKey);
  return (a.jurisdictionId ?? '').localeCompare(b.jurisdictionId ?? '');
}

const BIN_WIDTH = 0.1;

export function calibrationOf(labels: EvalLabel[]): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < 10; i += 1) {
    bins.push({
      lower: round(i * BIN_WIDTH, 2),
      upper: round((i + 1) * BIN_WIDTH, 2),
      judged: 0,
      correct: 0,
      expected: null,
      observed: null,
    });
  }
  const claimed = bins.map(() => 0);
  for (const label of labels) {
    if (label.verdict === 'abstain' || label.confidenceScore === null) continue;
    // The top bin is closed at both ends so a score of exactly 1 lands in it
    // rather than in an eleventh bin that does not exist.
    const index = Math.min(9, Math.floor(label.confidenceScore / BIN_WIDTH));
    const bin = bins[index];
    if (!bin) continue;
    bin.judged += 1;
    if (label.verdict === 'correct') bin.correct += 1;
    claimed[index] = (claimed[index] ?? 0) + label.confidenceScore;
  }
  return bins.map((bin, index) => {
    if (bin.judged === 0) return bin;
    return {
      ...bin,
      expected: round((claimed[index] ?? 0) / bin.judged, 4),
      observed: round(bin.correct / bin.judged, 4),
    };
  });
}

const SWEEP = [0.3, 0.4, 0.45, 0.5, 0.6, 0.7, 0.75, 0.8, 0.9];

export function thresholdSweep(labels: EvalLabel[]): ThresholdPoint[] {
  const judged = labels.filter((l) => l.verdict !== 'abstain' && l.confidenceScore !== null);
  const allCorrect = judged.filter((l) => l.verdict === 'correct');
  return SWEEP.map((threshold) => {
    const kept = judged.filter((l) => (l.confidenceScore ?? 0) >= threshold);
    const correct = kept.filter((l) => l.verdict === 'correct');
    const dropped = allCorrect.filter((l) => (l.confidenceScore ?? 0) < threshold);
    return {
      threshold,
      judged: kept.length,
      correct: correct.length,
      precision: kept.length >= MIN_JUDGED ? round(correct.length / kept.length, 4) : null,
      keptCorrectShare:
        allCorrect.length > 0 ? round(correct.length / allCorrect.length, 4) : null,
      droppedCorrectValue: Math.round(
        dropped.reduce((total, l) => total + (l.decidedValue ?? 0), 0),
      ),
    };
  });
}

export function scoreLabels(labels: EvalLabel[], generatedAt: string): QualityReport {
  const judged = labels.filter((l) => l.verdict !== 'abstain');
  const correct = judged.filter((l) => l.verdict === 'correct').length;
  return {
    generatedAt,
    labelCount: labels.length,
    judgedCount: judged.length,
    precision: judged.length >= MIN_JUDGED ? round(correct / judged.length, 4) : null,
    byFinding: group(labels, (l) => [l.findingKey, null]),
    byFindingJurisdiction: group(labels, (l) => [l.findingKey, l.jurisdictionId]),
    calibration: calibrationOf(labels),
    thresholds: thresholdSweep(labels),
    engagementCount: new Set(labels.map((l) => l.engagementId)).size,
    reviewerCount: new Set(labels.map((l) => l.decidedBy).filter(Boolean)).size,
  };
}
