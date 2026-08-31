import { describe, expect, it } from 'vitest';
import type { AssessmentNoticeFacts, ProtestResolutionFacts } from '@tangible/types';
import { checkResolution, resolutionStanding } from './resolution.js';

/**
 * June 2026 for the order dates, because sixty days from mid-June lands in
 * mid-August on a weekday — so a test about the sixty-day leg is not quietly
 * also a test about 1.06 rolling a Saturday forward. The weekend case gets its
 * own test.
 */
const notice = (over: Partial<AssessmentNoticeFacts> = {}): AssessmentNoticeFacts => ({
  taxYear: 2026,
  status: 'active',
  noticedOn: '2026-04-10',
  deliveredOn: null,
  printedDeadline: null,
  renditionPenaltyApplied: null,
  protestFiledOn: '2026-05-12',
  ...over,
});

const resolution = (over: Partial<ProtestResolutionFacts> = {}): ProtestResolutionFacts => ({
  taxYear: 2026,
  status: 'recorded',
  stage: 'informal',
  resolvedOn: '2026-06-15',
  noticedValue: 500_000,
  finalValue: 400_000,
  penaltyOutcome: null,
  orderReference: null,
  ...over,
});

describe('resolutionStanding', () => {
  it('measures the reduction in assessed value', () => {
    const standing = resolutionStanding(resolution(), '2026-06-20');
    expect(standing.reduction).toBe(100_000);
    expect(standing.reductionPct).toBeCloseTo(0.2);
    expect(standing.standing).toContain('$100,000');
  });

  it('closes the year on a 1.111(e) agreement with nothing after it', () => {
    const standing = resolutionStanding(resolution({ stage: 'informal' }), '2026-06-20');
    expect(standing.binding).toBe(true);
    expect(standing.appealDeadline).toBeNull();
    expect(standing.appealOpen).toBe(false);
    expect(standing.arbitrationEligible).toBeNull();
    expect(standing.standing).toContain('1.111(e)');
  });

  it('starts sixty days from a written order', () => {
    const standing = resolutionStanding(
      resolution({ stage: 'arb', orderReference: 'ARB-2026-4471' }),
      '2026-06-20',
    );
    // June 15 + 60 = August 14, a Friday. No 1.06 roll.
    expect(standing.appealDeadline).toBe('2026-08-14');
    expect(standing.appealOpen).toBe(true);
    expect(standing.binding).toBe(false);
    expect(standing.standing).toContain('42.21(a)');
  });

  it('rolls the sixtieth day off a weekend under 1.06', () => {
    // June 16 + 60 = August 15, a Saturday.
    const standing = resolutionStanding(
      resolution({ stage: 'arb', resolvedOn: '2026-06-16' }),
      '2026-06-20',
    );
    expect(standing.appealDeadline).toBe('2026-08-17');
  });

  it('says the order date is the short reading, not the deadline itself', () => {
    const standing = resolutionStanding(resolution({ stage: 'arb' }), '2026-06-20');
    expect(standing.standing).toContain('receipt is normally later');
  });

  it('binds once the sixty days have run', () => {
    const standing = resolutionStanding(resolution({ stage: 'arb' }), '2026-09-01');
    expect(standing.appealOpen).toBe(false);
    expect(standing.binding).toBe(true);
    expect(standing.standing).toContain('the value stands for 2026');
  });

  it('opens 41A arbitration under the $5M ceiling', () => {
    const standing = resolutionStanding(
      resolution({ stage: 'arb', noticedValue: 6_000_000, finalValue: 4_800_000 }),
      '2026-06-20',
    );
    expect(standing.arbitrationEligible).toBe(true);
    expect(standing.standing).toContain('binding arbitration');
  });

  it('answers arbitration against the value that stands, not the one noticed', () => {
    // Noticed under the ceiling, determined over it. What matters for 41A is
    // the value being appealed from, which is the board's.
    const standing = resolutionStanding(
      resolution({ stage: 'arb', noticedValue: 4_900_000, finalValue: 5_400_000 }),
      '2026-06-20',
    );
    expect(standing.arbitrationEligible).toBe(false);
    expect(standing.standing).toContain('district court');
  });

  it('cannot answer arbitration with no value on file', () => {
    const standing = resolutionStanding(
      resolution({ stage: 'arb', noticedValue: null, finalValue: null }),
      '2026-06-20',
    );
    expect(standing.arbitrationEligible).toBeNull();
    expect(standing.reduction).toBeNull();
  });

  it('leaves the noticed value standing on a withdrawal', () => {
    const standing = resolutionStanding(
      resolution({ stage: 'withdrawn', finalValue: null }),
      '2026-06-20',
    );
    expect(standing.binding).toBe(true);
    expect(standing.reduction).toBeNull();
    expect(standing.standing).toContain('$500,000');
    expect(standing.standing).toContain('stands for 2026');
  });

  it('says a dismissal is not a decision about value', () => {
    const standing = resolutionStanding(
      resolution({ stage: 'dismissed', finalValue: null }),
      '2026-06-20',
    );
    expect(standing.standing).toContain('not a decision about value');
    expect(standing.appealDeadline).toBeNull();
  });

  it('settles nothing once voided', () => {
    const standing = resolutionStanding(resolution({ status: 'void' }), '2026-06-20');
    expect(standing.binding).toBe(false);
    expect(standing.standing).toContain('Recorded in error');
  });

  it('points a superseded row at the one that replaced it', () => {
    const standing = resolutionStanding(resolution({ status: 'superseded' }), '2026-06-20');
    expect(standing.standing).toContain('newer one');
  });

  it('reports a value that went up rather than hiding it in a negative', () => {
    const standing = resolutionStanding(resolution({ finalValue: 560_000 }), '2026-06-20');
    expect(standing.reduction).toBe(-60_000);
    expect(standing.standing).toContain('onto the appraised value');
  });
});

describe('checkResolution', () => {
  const checks = (r: ProtestResolutionFacts, n: AssessmentNoticeFacts) =>
    checkResolution(r, n, resolutionStanding(r, '2026-06-20'));
  const keys = (r: ProtestResolutionFacts, n: AssessmentNoticeFacts) =>
    checks(r, n).map((one) => one.key);

  it('is quiet about a clean informal settlement', () => {
    expect(keys(resolution(), notice())).toEqual([]);
  });

  it('will not let a rendition penalty disappear behind a win', () => {
    const found = checks(resolution(), notice({ renditionPenaltyApplied: true }));
    const penalty = found.find((one) => one.key === 'penalty-survives');
    expect(penalty?.severity).toBe('critical');
    expect(penalty?.message).toContain('22.30');
    expect(penalty?.message).toContain('10% of the taxes');
  });

  it('still flags a penalty that was argued and upheld', () => {
    const found = checks(
      resolution({ penaltyOutcome: 'upheld' }),
      notice({ renditionPenaltyApplied: true }),
    );
    expect(found.find((one) => one.key === 'penalty-survives')?.severity).toBe('critical');
  });

  it('drops to a note once the penalty was waived', () => {
    const found = checks(
      resolution({ penaltyOutcome: 'waived' }),
      notice({ renditionPenaltyApplied: true }),
    );
    expect(found.find((one) => one.key === 'penalty-waived')?.severity).toBe('note');
    expect(keys(resolution({ penaltyOutcome: 'waived' }), notice())).toContain(
      'penalty-outcome-without-penalty',
    );
  });

  it('accepts an informal settlement with no protest on file', () => {
    // 1.111(e) does not condition the agreement on a protest having been filed,
    // and on a BPP account it is routinely settled on the phone.
    expect(keys(resolution(), notice({ protestFiledOn: null }))).toEqual([]);
  });

  it('rejects a board outcome with no protest on file', () => {
    expect(keys(resolution({ stage: 'arb' }), notice({ protestFiledOn: null }))).toContain(
      'resolution-without-protest',
    );
  });

  it('wants the order number an appeal would be filed against', () => {
    expect(keys(resolution({ stage: 'arb' }), notice())).toContain('order-unreferenced');
    expect(keys(resolution({ stage: 'arb', orderReference: 'ARB-1' }), notice())).not.toContain(
      'order-unreferenced',
    );
  });

  it('catches a resolution dated before the notice it resolves', () => {
    expect(keys(resolution({ resolvedOn: '2026-04-01' }), notice())).toContain(
      'resolved-before-noticed',
    );
  });

  it('catches a resolution dated before the protest went in', () => {
    expect(keys(resolution({ resolvedOn: '2026-05-01' }), notice())).toContain(
      'resolved-before-protest',
    );
  });

  it('asks about a value that came back higher', () => {
    expect(keys(resolution({ finalValue: 700_000 }), notice())).toContain('value-increased');
  });

  it('records a settlement that moved nothing rather than staying silent', () => {
    expect(keys(resolution({ finalValue: 500_000 }), notice())).toContain('no-reduction');
  });

  it('says so when the notice carried no value to measure against', () => {
    expect(keys(resolution({ noticedValue: null }), notice())).toContain('reduction-unmeasurable');
  });

  it('checks nothing on a voided row', () => {
    expect(keys(resolution({ status: 'void' }), notice({ renditionPenaltyApplied: true }))).toEqual(
      [],
    );
  });
});
