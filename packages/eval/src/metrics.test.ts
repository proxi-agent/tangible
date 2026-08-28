import { describe, expect, it } from 'vitest';
import type { EvalLabel } from '@tangible/types';
import {
  calibrationOf,
  scoreLabels,
  thresholdSweep,
  wilsonHalfWidth,
  MIN_JUDGED,
} from './metrics.js';
import { labelsFrom, newestPerRow, verdictFor, type DecisionRecord } from './labels.js';

const label = (over: Partial<EvalLabel> & { rowKey: string }): EvalLabel => ({
  findingKey: 'ghost-assets',
  assetId: 'a1',
  engagementId: 'e1',
  jurisdictionId: 'tx-harris',
  taxYear: 2026,
  verdict: 'correct',
  decidedAt: '2026-08-01T00:00:00.000Z',
  decidedBy: 'reviewer@firm',
  decidedByAudience: 'firm',
  confidenceScore: 0.8,
  confidenceTier: 'high',
  signals: [],
  decidedValue: 10_000,
  decidedTaxAtRisk: 250,
  rulesVersion: '1.2.0',
  ...over,
});

const many = (count: number, over: (i: number) => Partial<EvalLabel>): EvalLabel[] =>
  Array.from({ length: count }, (_, i) => label({ rowKey: `r${i}`, ...over(i) }));

describe('precision', () => {
  it('withholds a number until enough rows have been judged', () => {
    const report = scoreLabels(
      many(MIN_JUDGED - 1, () => ({})),
      '2026-08-27T00:00:00.000Z',
    );
    const row = report.byFinding[0];
    expect(row?.judged).toBe(MIN_JUDGED - 1);
    // Nineteen out of nineteen is not 100% precision, it is nineteen rows.
    expect(row?.precision).toBeNull();
    expect(row?.interval).toBeNull();
  });

  it('reports one once there are enough', () => {
    const labels = many(MIN_JUDGED, (i) => ({ verdict: i < 2 ? 'incorrect' : 'correct' }));
    const report = scoreLabels(labels, '2026-08-27T00:00:00.000Z');
    const row = report.byFinding[0];
    expect(row?.judged).toBe(MIN_JUDGED);
    expect(row?.precision).toBeCloseTo(0.9, 5);
    expect(row?.interval).not.toBeNull();
  });

  it('leaves abstentions out of the denominator and counts them as labels', () => {
    const labels = [
      ...many(10, () => ({ verdict: 'correct' as const })),
      ...many(5, (i) => ({ rowKey: `d${i}`, verdict: 'abstain' as const })),
    ];
    const report = scoreLabels(labels, '2026-08-27T00:00:00.000Z');
    const row = report.byFinding[0];
    expect(row?.labeled).toBe(15);
    expect(row?.judged).toBe(10);
    expect(row?.abstained).toBe(5);
  });

  it('splits by jurisdiction as well as by finding', () => {
    const labels = [
      ...many(3, (i) => ({ rowKey: `h${i}`, jurisdictionId: 'tx-harris' })),
      ...many(2, (i) => ({ rowKey: `t${i}`, jurisdictionId: 'tx-travis' })),
    ];
    const report = scoreLabels(labels, '2026-08-27T00:00:00.000Z');
    expect(report.byFinding).toHaveLength(1);
    expect(report.byFindingJurisdiction).toHaveLength(2);
  });
});

describe('the interval', () => {
  it('is null on nothing', () => {
    expect(wilsonHalfWidth(0, 0)).toBeNull();
  });

  it('stays inside the unit interval when every row was right', () => {
    // The reason for Wilson rather than the normal approximation: at 20/20 the
    // normal interval has zero width, which would read as certainty.
    const half = wilsonHalfWidth(20, 20);
    expect(half).not.toBeNull();
    expect(half!).toBeGreaterThan(0);
  });

  it('narrows as the sample grows', () => {
    expect(wilsonHalfWidth(90, 100)!).toBeLessThan(wilsonHalfWidth(9, 10)!);
  });
});

describe('calibration', () => {
  it('bins by the score the model gave and compares it to what happened', () => {
    const labels = [
      ...many(10, (i) => ({ rowKey: `a${i}`, confidenceScore: 0.95, verdict: 'correct' as const })),
      ...many(10, (i) => ({
        rowKey: `b${i}`,
        confidenceScore: 0.35,
        verdict: i < 5 ? ('correct' as const) : ('incorrect' as const),
      })),
    ];
    const bins = calibrationOf(labels).filter((bin) => bin.judged > 0);
    expect(bins).toHaveLength(2);
    const low = bins.find((bin) => bin.lower <= 0.35 && 0.35 < bin.upper);
    expect(low?.observed).toBeCloseTo(0.5, 5);
    expect(low?.expected).toBeCloseTo(0.35, 5);
  });

  it('puts a score of exactly 1 in the top bin rather than off the end', () => {
    const bins = calibrationOf([label({ rowKey: 'r', confidenceScore: 1 })]);
    expect(bins.filter((bin) => bin.judged > 0)).toHaveLength(1);
    expect(bins.find((bin) => bin.judged > 0)?.upper).toBe(1);
  });
});

describe('the threshold sweep', () => {
  const labels = [
    ...many(20, (i) => ({ rowKey: `hi${i}`, confidenceScore: 0.9, verdict: 'correct' as const })),
    ...many(10, (i) => ({
      rowKey: `lo${i}`,
      confidenceScore: 0.4,
      verdict: i < 3 ? ('correct' as const) : ('incorrect' as const),
    })),
  ];

  it('trades away correct findings as the threshold rises', () => {
    const sweep = thresholdSweep(labels);
    const low = sweep.find((point) => point.threshold === 0.3);
    const high = sweep.find((point) => point.threshold === 0.8);
    expect(low?.precision).toBeCloseTo(23 / 30, 4);
    expect(high?.precision).toBeCloseTo(1, 5);
    // Raising it to 0.8 buys that precision by dropping three real findings,
    // and the sweep prices them — the product control this feeds is a choice
    // about how much recovery the firm is willing to leave on the table.
    expect(high?.droppedCorrectValue).toBe(30_000);
    expect(high?.keptCorrectShare).toBeCloseTo(20 / 23, 4);
  });

  it('withholds precision at a threshold that leaves too few rows behind', () => {
    const sweep = thresholdSweep(labels.slice(0, 19));
    // The same rule as everywhere else: a thin slice does not get to claim a
    // number, and the threshold control should not look better than the
    // evidence for it.
    expect(sweep.find((point) => point.threshold === 0.9)?.precision).toBeNull();
  });
});

describe('labels off the review queue', () => {
  const record = (over: Partial<DecisionRecord> & { rowKey: string }): DecisionRecord => ({
    findingKey: 'ghost-assets',
    assetId: 'a1',
    engagementId: 'e1',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    status: 'accepted',
    decidedAt: '2026-08-01T00:00:00.000Z',
    decidedBy: 'reviewer@firm',
    decidedByAudience: 'firm',
    confidenceScore: 0.8,
    confidenceTier: 'high',
    signals: [],
    decidedValue: 10_000,
    decidedTaxAtRisk: 250,
    rulesVersion: '1.2.0',
    ...over,
  });

  it('reads accept and reject as verdicts and everything else as an abstention', () => {
    expect(verdictFor('accepted')).toBe('correct');
    expect(verdictFor('rejected')).toBe('incorrect');
    // A row waiting on the client is not evidence the detector was wrong.
    expect(verdictFor('pending-client')).toBe('abstain');
    expect(verdictFor('deferred')).toBe('abstain');
  });

  it('keeps only the last decision on a row', () => {
    const kept = newestPerRow([
      record({ rowKey: 'r1', status: 'accepted', decidedAt: '2026-08-01T00:00:00.000Z' }),
      record({ rowKey: 'r1', status: 'rejected', decidedAt: '2026-08-05T00:00:00.000Z' }),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.status).toBe('rejected');
  });

  it('does not merge the same row key across engagements', () => {
    const kept = newestPerRow([
      record({ rowKey: 'r1', engagementId: 'e1' }),
      record({ rowKey: 'r1', engagementId: 'e2' }),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('carries the score the row was shown at, not the score it would get today', () => {
    const [made] = labelsFrom([record({ rowKey: 'r1', confidenceScore: 0.42 })]);
    expect(made?.confidenceScore).toBe(0.42);
    expect(made?.rulesVersion).toBe('1.2.0');
  });
});
