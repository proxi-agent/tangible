import { describe, expect, it } from 'vitest';
import type { DetectionSignal } from '@tangible/types';
import { confidenceFor } from './confidence.js';
import {
  fitDetectionModel,
  modelScore,
  ruleScore,
  MIN_LABELS,
  PRIOR_OBSERVATIONS,
  type ModelLabel,
} from './model.js';

/**
 * The fit, tested on registers nobody kept.
 *
 * Every dataset below is synthetic and deterministic, because the property
 * being tested is not "does it learn the truth about ghost assets" — nobody has
 * enough labels to ask that yet — but "does it refuse to claim anything until
 * it has earned it, and does it learn the right thing when it has". Those are
 * the two failure modes that would matter in production, and both are testable
 * without a single real decision.
 */

const sig = (code: string, weight: number): DetectionSignal => ({
  code,
  label: code,
  weight,
  detail: null,
});

/** A deterministic stand-in for a coin, so a fit is reproducible. */
function coin(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

/**
 * A finding where one signal really does predict acceptance and the authored
 * weight badly understates it: rows carrying it are accepted 85% of the time,
 * rows without it 10%, and the hand rule reads those as 0.44 and 0.28.
 */
function retirementLabels(count: number, seed = 7): ModelLabel[] {
  const rand = coin(seed);
  const out: ModelLabel[] = [];
  for (let i = 0; i < count; i += 1) {
    const strong = i % 2 === 0;
    out.push({
      findingKey: 'suspected-retired',
      signals: strong
        ? [sig('far-past-life', 0.16), sig('no-retirements-recorded', 0.14)]
        : [sig('generic-description', 0.06)],
      correct: rand() < (strong ? 0.85 : 0.1),
    });
  }
  return out;
}

const now = '2026-08-27T00:00:00.000Z';
const findingOf = (labels: ModelLabel[], key = 'suspected-retired') =>
  fitDetectionModel(labels, now).view.findings.find((f) => f.findingKey === key)!;

describe('fitDetectionModel', () => {
  it('publishes nothing at all when nobody has decided anything', () => {
    const fit = fitDetectionModel([], now);
    expect(fit.view.findings).toEqual([]);
    expect(fit.view.adopted).toEqual([]);
    expect(fit.coefficients.size).toBe(0);
  });

  it('will not fit a finding below the label floor, and says how far off it is', () => {
    const finding = findingOf(retirementLabels(20));
    expect(finding.adopted).toBe(false);
    expect(finding.fittedLoss).toBeNull();
    expect(finding.reason).toContain(`${MIN_LABELS} decisions`);
  });

  it('will not adopt a fit on labels that all say the same thing', () => {
    const labels: ModelLabel[] = Array.from({ length: 60 }, (_, i) => ({
      findingKey: 'ghost-assets',
      signals: [sig('disposed-in-register', 0.2), sig(i % 2 === 0 ? 'has-date' : 'no-date', 0.05)],
      correct: true,
    }));
    const finding = findingOf(labels, 'ghost-assets');
    expect(finding.labels).toBe(60);
    expect(finding.accepted).toBe(60);
    expect(finding.adopted).toBe(false);
    expect(finding.reason).toContain('a constant');
  });

  it('adopts a fit that beats the authored weights on decisions it never saw', () => {
    const finding = findingOf(retirementLabels(160));
    expect(finding.adopted).toBe(true);
    expect(finding.fittedLoss).not.toBeNull();
    expect(finding.baselineLoss).not.toBeNull();
    expect(finding.fittedLoss!).toBeLessThan(finding.baselineLoss!);
    expect(finding.reason).toContain('scored by the model');
  });

  it('moves the signal the labels argue about, and in the right direction', () => {
    const finding = findingOf(retirementLabels(160));
    const strong = finding.features.find((f) => f.code === 'far-past-life')!;
    // The authored weight said +0.16 on a 0.28 base — about half a log-odd.
    // The labels say a row carrying it is accepted six times out of seven.
    expect(strong.fitted).toBeGreaterThan(strong.prior);
    expect(strong.observations).toBe(80);
    expect(strong.accepted).toBeGreaterThan(60);
  });

  it('moves a contradicted signal further the more reviewers saw it', () => {
    // The same contradiction — every row carrying the signal was rejected,
    // against a finding whose rows are mostly accepted — presented twice, on
    // five decisions and on fifty.
    const contradict = (rows: number) => {
      const labels = retirementLabels(160);
      for (let i = 0; i < rows; i += 1) {
        labels[i * 2] = {
          ...labels[i * 2]!,
          signals: [...labels[i * 2]!.signals, sig('rare-signal', 0.16)],
          correct: false,
        };
      }
      const feature = findingOf(labels).features.find((f) => f.code === 'rare-signal')!;
      return { feature, move: Math.abs(feature.fitted - feature.prior) };
    };

    const thin = contradict(5);
    const thick = contradict(50);
    expect(thin.feature.observations).toBe(5);
    expect(thick.feature.observations).toBe(50);
    expect(thin.move).toBeLessThan(thick.move);
    // And the thin one cannot run away however flatly the labels contradict
    // it: the ridge caps the move at the observation count over 2λ.
    expect(thin.move).toBeLessThanOrEqual(5 / (PRIOR_OBSERVATIONS * 0.25));
  });

  it('drops a code no second reviewer ever saw', () => {
    const labels = retirementLabels(160);
    labels[3] = { ...labels[3]!, signals: [...labels[3]!.signals, sig('seen-once', 0.2)] };
    const finding = findingOf(labels);
    expect(finding.features.map((f) => f.code)).not.toContain('seen-once');
  });

  it('reports reliability out of fold, on predictions the fit did not see', () => {
    const finding = findingOf(retirementLabels(160));
    const judged = finding.reliability.reduce((sum, bin) => sum + bin.judged, 0);
    expect(judged).toBe(160);
    const busiest = [...finding.reliability].sort((a, b) => b.judged - a.judged)[0]!;
    expect(Math.abs(busiest.expected! - busiest.observed!)).toBeLessThan(0.15);
  });

  it('is deterministic — the same decisions fit the same coefficients', () => {
    const labels = retirementLabels(160);
    expect(findingOf(labels).features).toEqual(findingOf([...labels]).features);
  });
});

describe('modelScore', () => {
  const fit = fitDetectionModel(retirementLabels(160), now);
  const strong = [sig('far-past-life', 0.16), sig('no-retirements-recorded', 0.14)];

  it('scores an adopted finding well above what the authored weights did', () => {
    const score = modelScore(fit, 'suspected-retired', strong)!;
    expect(score).toBeGreaterThan(0.7);
    expect(ruleScore('suspected-retired', strong)).toBeCloseTo(0.58, 2);
  });

  it('has nothing to say about a finding with no adopted model', () => {
    expect(modelScore(fit, 'freeport', strong)).toBeNull();
    expect(modelScore(null, 'suspected-retired', strong)).toBeNull();
  });

  it('ignores a signal the fit has never seen rather than guessing at it', () => {
    const withUnknown = [...strong, sig('evidence-cmms-none', 0.25)];
    expect(modelScore(fit, 'suspected-retired', withUnknown)).toBe(
      modelScore(fit, 'suspected-retired', strong),
    );
  });

  it('stays inside the same bounds the rule was clamped to', () => {
    const piled = Array.from({ length: 12 }, () => sig('far-past-life', 0.16));
    const score = modelScore(fit, 'suspected-retired', piled)!;
    expect(score).toBeLessThanOrEqual(0.97);
    expect(score).toBeGreaterThanOrEqual(0.03);
  });
});

describe('confidenceFor with a fit', () => {
  const fit = fitDetectionModel(retirementLabels(160), now);
  const strong = [sig('far-past-life', 0.16), sig('no-retirements-recorded', 0.14)];

  it('says which of the two produced the number', () => {
    expect(confidenceFor('suspected-retired', strong).basis).toBe('rules');
    expect(
      confidenceFor('suspected-retired', strong, (key, signals) => modelScore(fit, key, signals))
        .basis,
    ).toBe('fitted');
  });

  it('falls back to the authored weights for a finding the fit skipped', () => {
    const scored = confidenceFor('freeport', strong, (key, signals) =>
      modelScore(fit, key, signals),
    );
    expect(scored.basis).toBe('rules');
    expect(scored.score).toBeCloseTo(ruleScore('freeport', strong), 2);
  });

  it('still explains the row with the signals rather than with the model', () => {
    const scored = confidenceFor('suspected-retired', strong, (key, signals) =>
      modelScore(fit, key, signals),
    );
    expect(scored.why).toContain('far-past-life');
    expect(scored.tier).toBe('high');
  });
});
