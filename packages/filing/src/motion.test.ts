import { describe, expect, it } from 'vitest';
import type { CorrectionMotionFacts } from '@tangible/types';
import { checkMotion, motionStanding } from './motion.js';

const motion = (over: Partial<CorrectionMotionFacts> = {}): CorrectionMotionFacts => ({
  subjectTaxYear: 2025,
  route: 'c-1',
  status: 'recorded',
  filedOn: '2026-09-15',
  rolledValue: 800_000,
  claimedValue: 500_000,
  undisputedTaxPaidOn: null,
  hearingScheduledFor: null,
  hearingNoticedOn: null,
  outcome: null,
  outcomeOn: null,
  correctedValue: null,
  orderReference: null,
  ...over,
});

const keys = (facts: CorrectionMotionFacts, today: string) =>
  checkMotion(facts, today).map((check) => check.key);

describe('what a motion spends', () => {
  it('closes (c-1) on the three endings (c-1)(3) lists', () => {
    for (const outcome of ['agreed', 'determined', 'forfeited'] as const) {
      const ended = motion({ outcome, outcomeOn: '2026-11-02' });
      expect(motionStanding(ended, '2026-12-01').barsAnother).toBe(true);
    }
  });

  it('spends nothing when it was withdrawn', () => {
    const pulled = motion({ outcome: 'withdrawn', outcomeOn: '2026-11-02' });
    const standing = motionStanding(pulled, '2026-12-01');
    expect(standing.barsAnother).toBe(false);
    expect(standing.standing).toContain('withdrawal is not on its list');
  });

  it('spends nothing while it is still pending', () => {
    // (c-1)(3) is about a motion that ended, not one that exists. A live motion
    // has not taken the route away from anybody.
    const standing = motionStanding(motion(), '2026-10-01');
    expect(standing.live).toBe(true);
    expect(standing.barsAnother).toBe(false);
  });

  it('spends nothing once the record is voided', () => {
    const standing = motionStanding(
      motion({ status: 'void', outcome: 'determined', outcomeOn: '2026-11-02' }),
      '2026-12-01',
    );
    expect(standing.barsAnother).toBe(false);
    expect(standing.standing).toContain('Recorded in error');
  });
});

describe('25.26, which is not about the motion at all', () => {
  it('puts the deadline on the delinquency date for the year under motion', () => {
    // Not the year the motion was filed in. A (c) motion brought in 2026 for
    // 2022 answers to January 31, 2023.
    const old = motion({ subjectTaxYear: 2022, route: 'c', filedOn: '2026-09-15' });
    expect(motionStanding(old, '2026-10-01').prepaymentDeadline).toBe('2023-01-31');
  });

  it('reads the payment against that date, not against today', () => {
    const paid = motion({ undisputedTaxPaidOn: '2026-01-15' });
    expect(motionStanding(paid, '2026-10-01').prepaymentMet).toBe(true);

    const late = motion({ undisputedTaxPaidOn: '2026-02-15' });
    const standing = motionStanding(late, '2026-10-01');
    expect(standing.prepaymentMet).toBe(false);
    expect(standing.standing).toContain('25.26(d)');
  });

  it('treats an unrecorded payment as a question, not as an answer', () => {
    const standing = motionStanding(motion(), '2026-10-01');
    expect(standing.prepaymentMet).toBeNull();
    expect(standing.standing).toContain('Nothing is recorded about the 25.26 payment');
    expect(standing.standing).toContain('has passed');
  });

  it('flags the unanswered payment once the date is behind us', () => {
    expect(keys(motion(), '2026-10-01')).toContain('motion-payment-unknown');
    // Filed before the date it turns on: the same fact, but nothing is wrong yet.
    expect(keys(motion({ filedOn: '2025-12-01' }), '2025-12-02')).not.toContain(
      'motion-payment-unknown',
    );
  });

  it('says filing did not move the date, because 25.26(a) says so', () => {
    const early = motion({ filedOn: '2025-12-01' });
    expect(motionStanding(early, '2025-12-02').standing).toContain(
      'pendency of a motion does not affect the delinquency date',
    );
  });

  it('closes (c-1) on a forfeiture, which determined nothing', () => {
    const lost = motion({ outcome: 'forfeited', outcomeOn: '2026-11-02' });
    const standing = motionStanding(lost, '2026-12-01');
    expect(standing.barsAnother).toBe(true);
    expect(standing.reduction).toBeNull();
    expect(standing.standing).toContain('Nothing was determined about value');
  });
});

describe('25.25(e) scheduling', () => {
  it('counts ninety days from the filing where the filing is the trigger', () => {
    // September through December: the ninety days run from the request, which
    // goes in with the motion.
    expect(motionStanding(motion({ filedOn: '2026-09-15' }), '2026-10-01').hearingDueBy).toBe(
      '2026-12-14',
    );
  });

  it('will not put a date on a spring filing', () => {
    // January through August the ninety days run from the day the board
    // approves the appraisal records, which is the district's date, not ours.
    const spring = motion({ filedOn: '2026-03-02' });
    const standing = motionStanding(spring, '2026-04-01');
    expect(standing.hearingDueBy).toBeNull();
    expect(standing.standing).toContain('heard in the autumn');
  });

  it('works the fifteen days of notice backwards from the hearing', () => {
    const set = motion({ hearingScheduledFor: '2026-11-20' });
    expect(motionStanding(set, '2026-10-01').hearingNoticeDueBy).toBe('2026-11-05');
    expect(keys({ ...set, hearingNoticedOn: '2026-11-05' }, '2026-10-01')).not.toContain(
      'motion-short-notice',
    );
    expect(keys({ ...set, hearingNoticedOn: '2026-11-06' }, '2026-10-01')).toContain(
      'motion-short-notice',
    );
  });

  it('notices a hearing that has gone by with nothing recorded', () => {
    const set = motion({ hearingScheduledFor: '2026-11-20' });
    expect(keys(set, '2026-11-21')).toContain('motion-hearing-passed');
    expect(keys(set, '2026-11-20')).not.toContain('motion-hearing-passed');
  });
});

describe('25.25(g)', () => {
  it('gives sixty days from a determination', () => {
    const determined = motion({
      outcome: 'determined',
      outcomeOn: '2026-11-02',
      correctedValue: 500_000,
    });
    const standing = motionStanding(determined, '2026-12-01');
    expect(standing.suitDeadline).toBe('2027-01-01');
    expect(standing.suitOpen).toBe(true);
    expect(standing.reduction).toBe(300_000);
    expect(standing.standing).toContain('$300,000 off the roll');
  });

  it('gives the same sixty days from a forfeiture finding', () => {
    // (g) names both: a determination of the motion, and a determination that
    // the owner forfeited for want of the 25.26 payment.
    const lost = motion({ outcome: 'forfeited', outcomeOn: '2026-11-02' });
    expect(motionStanding(lost, '2026-12-01').suitDeadline).toBe('2027-01-01');
  });

  it('gives none from an agreed correction, which no board determined', () => {
    const agreed = motion({ outcome: 'agreed', outcomeOn: '2026-11-02' });
    const standing = motionStanding(agreed, '2026-12-01');
    expect(standing.suitDeadline).toBeNull();
    expect(standing.standing).toContain('nothing to appeal from');
  });

  it('shuts once the sixty days are behind us, and says the count is the short one', () => {
    const determined = motion({ outcome: 'determined', outcomeOn: '2026-11-02' });
    const standing = motionStanding(determined, '2027-01-02');
    expect(standing.suitOpen).toBe(false);
    expect(standing.standing).toContain('earliest the window can close');
  });
});

describe('what is worth a second look', () => {
  it('catches a motion filed after its own route shut', () => {
    // (c-1) reaches the current year and the two before it. A 2022 year was
    // gone at the end of 2024, and the deadline a firm remembers is (c)'s.
    const late = motion({ subjectTaxYear: 2022, route: 'c-1', filedOn: '2026-09-15' });
    expect(keys(late, '2026-10-01')).toContain('motion-out-of-time');

    const fine = motion({ subjectTaxYear: 2022, route: 'c', filedOn: '2026-09-15' });
    expect(keys(fine, '2026-10-01')).not.toContain('motion-out-of-time');
  });

  it('measures a (d) motion against its own threshold', () => {
    // (d) wants the roll more than a third over correct, so the claim has to
    // come in below three quarters of it.
    const under = motion({ route: 'd', filedOn: '2026-01-15', claimedValue: 610_000 });
    expect(keys(under, '2026-01-20')).toContain('motion-under-threshold');
    expect(checkMotion(under, '2026-01-20')[0].message).toContain('$600,000');

    const over = motion({ route: 'd', filedOn: '2026-01-15', claimedValue: 590_000 });
    expect(keys(over, '2026-01-20')).not.toContain('motion-under-threshold');
  });

  it('leaves the threshold alone on the free routes', () => {
    // (c) and (c-1) have no threshold at all, which is most of why they are the
    // routes to reach for first.
    const modest = motion({ route: 'c-1', claimedValue: 790_000 });
    expect(keys(modest, '2026-10-01')).not.toContain('motion-under-threshold');
  });

  it('wants the order number on a determination', () => {
    const determined = motion({ outcome: 'determined', outcomeOn: '2026-11-02' });
    expect(keys(determined, '2026-12-01')).toContain('motion-order-missing');
    expect(keys({ ...determined, orderReference: 'ARB-2026-0091' }, '2026-12-01')).not.toContain(
      'motion-order-missing',
    );
  });

  it('catches an ending dated before the filing', () => {
    const impossible = motion({ outcome: 'agreed', outcomeOn: '2026-09-01' });
    expect(keys(impossible, '2026-12-01')).toContain('motion-ended-before-filed');
  });

  it('checks nothing on a record that has been superseded', () => {
    const old = motion({ status: 'superseded', subjectTaxYear: 2022, route: 'c-1' });
    expect(checkMotion(old, '2026-10-01')).toEqual([]);
    expect(motionStanding(old, '2026-10-01').standing).toContain('Work to the newer one');
  });
});
