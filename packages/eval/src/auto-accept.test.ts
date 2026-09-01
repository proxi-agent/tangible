import { describe, expect, it } from 'vitest';
import type { ClassificationLabel } from '@tangible/types';
import { autoAcceptReport } from './auto-accept.js';

const LIVE = 0.85;

const label = (over: Partial<ClassificationLabel>): ClassificationLabel => ({
  source: 'ai',
  confidence: 0.7,
  autoAccepted: false,
  agreed: true,
  ...over,
});

const many = (n: number, make: (i: number) => Partial<ClassificationLabel>) =>
  Array.from({ length: n }, (_, i) => label(make(i)));

describe('the auto-accept sweep', () => {
  const labels = [
    // Just under the bar, and the reviewer nearly always agreed: the case for
    // lowering it.
    ...many(20, (i) => ({ confidence: 0.82, agreed: i > 0 })),
    // Well under it, and the reviewer disagreed a third of the time.
    ...many(30, (i) => ({ confidence: 0.55, agreed: i % 3 !== 0 })),
  ];

  it('prices lowering the bar by the rows it would stop showing', () => {
    const report = autoAcceptReport(labels, LIVE);
    const at80 = report.points.find((p) => p.threshold === 0.8);
    // Only the band between 0.8 and the live 0.85 changes treatment. The 0.55
    // rows are queued at either bar and are not part of this decision.
    expect(at80?.direction).toBe('lower');
    expect(at80?.affected).toBe(20);
    expect(at80?.wrong).toBe(1);
    expect(at80?.observed).toBe(true);
  });

  it('widens the band as the bar drops, and the cost with it', () => {
    const report = autoAcceptReport(labels, LIVE);
    const at50 = report.points.find((p) => p.threshold === 0.5);
    expect(at50?.affected).toBe(50);
    expect(at50?.wrong).toBe(11);
  });

  it('reports a bar above the live one as unknown rather than as free', () => {
    const report = autoAcceptReport(labels, LIVE);
    const at90 = report.points.find((p) => p.threshold === 0.9);
    // Nobody judges an auto-accepted row, so the band [0.85, 0.9) holds no
    // labels. Reporting zero wrong there would read as "raising the bar costs
    // nothing and catches nothing", which is a claim about rows we have never
    // looked at.
    expect(at90?.direction).toBe('raise');
    expect(at90?.affected).toBe(0);
    expect(at90?.wrong).toBeNull();
    expect(at90?.observed).toBe(false);
    expect(report.above).toBe(0);
  });

  it('speaks about a higher bar once auto-accepted rows are sampled for review', () => {
    const sampled = [
      ...labels,
      ...many(12, (i) => ({ confidence: 0.88, autoAccepted: true, agreed: i > 1 })),
    ];
    const report = autoAcceptReport(sampled, LIVE);
    const at90 = report.points.find((p) => p.threshold === 0.9);
    expect(at90?.affected).toBe(12);
    expect(at90?.wrong).toBe(2);
    expect(at90?.observed).toBe(true);
    expect(report.above).toBe(12);
    expect(report.aboveAgreed).toBe(10);
  });

  it('changes nothing at the bar in force', () => {
    const report = autoAcceptReport(labels, LIVE);
    const live = report.points.find((p) => p.threshold === LIVE);
    expect(live?.direction).toBe('live');
    expect(live?.affected).toBe(0);
    expect(live?.wrong).toBe(0);
  });

  it('includes the live bar even when the sweep would not have', () => {
    const report = autoAcceptReport(labels, 0.77);
    expect(report.points.map((p) => p.threshold)).toContain(0.77);
    expect(report.points.filter((p) => p.direction === 'live')).toHaveLength(1);
  });

  it('keeps replayed decisions out of the threshold numbers', () => {
    const withMemory = [
      ...labels,
      // A memory hit carries confidence 1 because a person was sure, not
      // because the model was. Counted in the sweep it would sit above the bar
      // and make raising it look measured.
      ...many(8, (i) => ({ source: 'memory' as const, confidence: 1, agreed: i > 1 })),
    ];
    const report = autoAcceptReport(withMemory, LIVE);
    expect(report.labels).toBe(50);
    expect(report.above).toBe(0);
    expect(report.memoryJudged).toBe(8);
    expect(report.memoryOverruled).toBe(2);
  });

  it('withholds an agreement rate on a thin sample', () => {
    expect(
      autoAcceptReport(
        many(19, () => ({})),
        LIVE,
      ).agreement,
    ).toBeNull();
    expect(
      autoAcceptReport(
        many(20, () => ({})),
        LIVE,
      ).agreement,
    ).toBe(1);
  });

  it('has nothing to say with no labels at all', () => {
    const report = autoAcceptReport([], LIVE);
    expect(report.labels).toBe(0);
    expect(report.agreement).toBeNull();
    expect(report.points.every((p) => p.affected === 0)).toBe(true);
    expect(report.points.filter((p) => p.observed)).toHaveLength(1);
  });
});
