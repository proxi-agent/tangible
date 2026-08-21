import { describe, expect, it } from 'vitest';
import type { AssessmentNoticeFacts } from '@tangible/types';
import { checkNotice, protestStanding, type FiledReturnFacts } from './protest.js';

/**
 * 2026 is chosen because its May 15 is a Friday — the observed date and the
 * statutory one are the same day, so a test about the thirty-day leg is not
 * quietly also a test about weekends. The one weekend case gets its own test.
 */
const facts = (over: Partial<AssessmentNoticeFacts> = {}): AssessmentNoticeFacts => ({
  taxYear: 2026,
  status: 'active',
  noticedOn: '2026-04-10',
  deliveredOn: null,
  printedDeadline: null,
  renditionPenaltyApplied: null,
  protestFiledOn: null,
  ...over,
});

const filed = (over: Partial<FiledReturnFacts> = {}): FiledReturnFacts => ({
  filedOn: '2026-04-10',
  dueOn: '2026-04-15',
  confirmation: '7020 1290 0001 2345 6789',
  totalHistoricalCost: 1_000_000,
  scheduleValue: 400_000,
  ...over,
});

describe('protestStanding', () => {
  it('floors the window at May 15 when thirty days runs out earlier', () => {
    // Delivered April 10 → thirty days is May 10, which 41.44 does not shorten
    // the window to. The later of the two governs.
    const standing = protestStanding(facts(), '2026-04-20');
    expect(standing.statutoryDeadline).toBe('2026-05-15');
    expect(standing.deadline).toBe('2026-05-15');
    expect(standing.open).toBe(true);
  });

  it('runs thirty days past May 15 for a notice delivered late', () => {
    const standing = protestStanding(facts({ noticedOn: '2026-05-01' }), '2026-05-20');
    expect(standing.statutoryDeadline).toBe('2026-06-01');
    expect(standing.open).toBe(true);
  });

  it('observes the thirtieth day onto the next business day', () => {
    // May 8 + 30 = June 7, a Sunday. 1.06 carries it to the Monday.
    const standing = protestStanding(facts({ noticedOn: '2026-05-08' }), '2026-05-20');
    expect(standing.statutoryDeadline).toBe('2026-06-08');
  });

  it('counts from the day it arrived where that was recorded', () => {
    const presumed = protestStanding(facts({ noticedOn: '2026-05-01' }), '2026-05-20');
    const actual = protestStanding(
      facts({ noticedOn: '2026-05-01', deliveredOn: '2026-05-06' }),
      '2026-05-20',
    );
    expect(presumed.statutoryDeadline).toBe('2026-06-01');
    expect(actual.statutoryDeadline).toBe('2026-06-05');
  });

  it('says whether the delivery date is a record or a presumption', () => {
    // Both sentences count thirty days, and only one of them counts from a
    // fact. 1.07's presumption is rebuttable — somebody arguing the window is
    // longer needs to know which of the two dates the tool used.
    const presumed = protestStanding(facts({ noticedOn: '2026-05-01' }), '2026-05-20');
    const actual = protestStanding(
      facts({ noticedOn: '2026-05-01', deliveredOn: '2026-05-06' }),
      '2026-05-20',
    );
    expect(presumed.standing).toContain('mailing date 1.07 presumes delivery on');
    expect(presumed.standing).not.toContain('delivery on May 1');
    expect(actual.standing).toContain('delivery on May 6, 2026');
    expect(actual.standing).not.toContain('1.07');
  });

  it('works to the printed date when the district printed a shorter one', () => {
    // The common case worth money: mailed April 28, so 41.44 gives May 28, and
    // the notice prints the May 15 boilerplate anyway.
    const standing = protestStanding(
      facts({ noticedOn: '2026-04-28', printedDeadline: '2026-05-15' }),
      '2026-05-01',
    );
    expect(standing.statutoryDeadline).toBe('2026-05-28');
    expect(standing.deadline).toBe('2026-05-15');
    expect(standing.standing).toContain('13 more days');
    expect(standing.standing).toContain('Work to the printed date');
  });

  it('works to the statutory date when the district printed a longer one', () => {
    const standing = protestStanding(
      facts({ noticedOn: '2026-04-10', printedDeadline: '2026-06-30' }),
      '2026-05-01',
    );
    expect(standing.deadline).toBe('2026-05-15');
    expect(standing.standing).toContain('check the postmark');
  });

  it('says nothing about a disagreement when the two agree', () => {
    const standing = protestStanding(
      facts({ noticedOn: '2026-04-10', printedDeadline: '2026-05-15' }),
      '2026-05-01',
    );
    expect(standing.deadline).toBe('2026-05-15');
    expect(standing.standing).not.toContain('Work to the printed date');
    expect(standing.standing).not.toContain('postmark');
  });

  it('closes the window once the date has passed', () => {
    const standing = protestStanding(facts(), '2026-05-16');
    expect(standing.open).toBe(false);
    expect(standing.standing).toContain('the value stands for 2026');
  });

  it('is still open on the deadline itself', () => {
    expect(protestStanding(facts(), '2026-05-15').open).toBe(true);
  });

  it('closes the window when a protest went in, and says it beat the date', () => {
    const standing = protestStanding(facts({ protestFiledOn: '2026-05-12' }), '2026-05-20');
    expect(standing.open).toBe(false);
    expect(standing.standing).toContain('inside the May 15, 2026 deadline');
  });

  it('says so when the protest went in late', () => {
    const standing = protestStanding(facts({ protestFiledOn: '2026-05-20' }), '2026-05-21');
    expect(standing.standing).toContain('entitled to a hearing');
  });

  it('starts no clock on a void notice', () => {
    const standing = protestStanding(facts({ status: 'void' }), '2026-04-20');
    expect(standing.open).toBe(false);
    expect(standing.standing).toContain('starts no clock');
  });

  it('points a superseded notice at the newer one', () => {
    expect(protestStanding(facts({ status: 'superseded' }), '2026-04-20').standing).toContain(
      'Work to the newer one',
    );
  });

  /**
   * The one that closes first. 22.30(b) has no May 15 under it, so on a notice
   * delivered in early April the waiver window shuts more than a month before
   * the protest window does — which is how a firm argues the value in time and
   * loses the penalty anyway.
   */
  it('runs the waiver clock thirty days from the notice, with no May 15 floor', () => {
    const standing = protestStanding(facts({ renditionPenaltyApplied: true }), '2026-04-20');
    expect(standing.waiverDeadline).toBe('2026-05-11');
    expect(standing.deadline).toBe('2026-05-15');
  });

  it('leaves the waiver clock unset where no penalty was applied', () => {
    expect(protestStanding(facts(), '2026-04-20').waiverDeadline).toBeNull();
    expect(protestStanding(facts({ renditionPenaltyApplied: false }), '2026-04-20').waiverDeadline).toBeNull();
  });
});

describe('checkNotice', () => {
  const check = (notice: AssessmentNoticeFacts & { appraisedValue: number | null }, ret: FiledReturnFacts | null) =>
    checkNotice(notice, ret, protestStanding(notice, '2026-05-01'));
  const keys = (checks: ReturnType<typeof check>) => checks.map((entry) => entry.key);

  it('flags a penalty applied to a return that was postmarked in time', () => {
    const checks = check(
      { ...facts({ renditionPenaltyApplied: true }), appraisedValue: 400_000 },
      filed(),
    );
    const penalty = checks.find((entry) => entry.key === 'penalty-though-timely');
    expect(penalty?.severity).toBe('critical');
    expect(penalty?.message).toContain('7020 1290 0001 2345 6789');
    // The 22.30 clock, named, because it is the one that runs out first.
    expect(penalty?.message).toContain('May 11, 2026');
  });

  it('does not dispute a penalty on a return that went out late', () => {
    const checks = check(
      { ...facts({ renditionPenaltyApplied: true }), appraisedValue: 400_000 },
      filed({ filedOn: '2026-04-20' }),
    );
    expect(keys(checks)).toContain('penalty-and-late');
    expect(checks.find((entry) => entry.key === 'penalty-and-late')?.message).toContain('good cause');
  });

  it('asks for the return where a penalty landed and none is recorded', () => {
    const checks = check(
      { ...facts({ renditionPenaltyApplied: true }), appraisedValue: null },
      null,
    );
    expect(keys(checks)).toEqual(['penalty-no-return', 'no-value']);
  });

  it('calls out a value materially above the district’s own schedule', () => {
    const checks = check({ ...facts(), appraisedValue: 500_000 }, filed());
    const gap = checks.find((entry) => entry.key === 'above-schedule');
    expect(gap?.severity).toBe('warning');
    expect(gap?.message).toContain('$100,000 above');
    expect(gap?.message).toContain('25% high');
  });

  it('treats a small difference as the two of us rounding', () => {
    // 2% of the schedule value, and over the dollar floor: both tests have to
    // pass before a protest is worth anybody's afternoon.
    const checks = check({ ...facts(), appraisedValue: 408_000 }, filed());
    expect(keys(checks)).toContain('on-schedule');
  });

  it('does not call a large percentage material on a small account', () => {
    const checks = check({ ...facts(), appraisedValue: 11_000 }, filed({ scheduleValue: 9_000 }));
    expect(keys(checks)).toContain('on-schedule');
  });

  it('says plainly when the district came in low', () => {
    const checks = check({ ...facts(), appraisedValue: 300_000 }, filed());
    const low = checks.find((entry) => entry.key === 'below-schedule');
    expect(low?.severity).toBe('note');
    expect(low?.message).toContain('nothing here to protest');
  });

  it('refuses to compare where no schedule was loaded when the return went out', () => {
    const checks = check({ ...facts(), appraisedValue: 400_000 }, filed({ scheduleValue: 0 }));
    expect(keys(checks)).toEqual(['nothing-to-compare']);
    expect(checks[0]?.message).toContain('$1,000,000');
  });

  it('refuses to compare where no return is recorded', () => {
    const checks = check({ ...facts(), appraisedValue: 400_000 }, null);
    expect(keys(checks)).toEqual(['nothing-to-compare']);
  });
});
