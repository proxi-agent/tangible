import { describe, expect, it } from 'vitest';
import type { CorrectionSubject } from '@tangible/types';
import { correctionOutlook } from './correction.js';

const subject = (over: Partial<CorrectionSubject> = {}): CorrectionSubject => ({
  taxYear: 2026,
  rolledValue: 800_000,
  renditionPenaltyApplied: null,
  ending: null,
  historyKnown: true,
  ...over,
});

/** The routes, by cite, that are actually usable. */
const openCites = (s: CorrectionSubject, today: string) =>
  correctionOutlook(s, today)
    .routes.filter((route) => route.open)
    .map((route) => route.cite);

const route = (key: string, s: CorrectionSubject, today: string) =>
  correctionOutlook(s, today).routes.find((one) => one.cite === key)!;

describe('correctionOutlook', () => {
  it('leaves all three open in the year itself, before the taxes go delinquent', () => {
    expect(openCites(subject(), '2026-09-01')).toEqual(['25.25(c)', '25.25(c-1)', '25.25(d)']);
  });

  it('closes (d) once the taxes go delinquent on February 1', () => {
    expect(route('25.25(d)', subject(), '2027-01-31').open).toBe(true);
    expect(route('25.25(d)', subject(), '2027-02-01').open).toBe(false);
    expect(route('25.25(d)', subject(), '2027-02-01').barred).toContain('delinquent');
  });

  it('gives (c-1) the current year and the two after it', () => {
    expect(route('25.25(c-1)', subject(), '2028-12-31').open).toBe(true);
    expect(route('25.25(c-1)', subject(), '2029-01-01').open).toBe(false);
  });

  it('gives (c) five years past the tax year', () => {
    expect(route('25.25(c)', subject(), '2031-12-31').open).toBe(true);
    expect(route('25.25(c)', subject(), '2032-01-01').open).toBe(false);
  });

  it('says nothing is left once even (c) has run', () => {
    const outlook = correctionOutlook(subject(), '2032-06-01');
    expect(outlook.open).toBe(false);
    expect(outlook.standing).toContain('25.25(a)');
    expect(outlook.standing).toContain('December 31, 2031');
  });

  describe('what an ending costs', () => {
    it('closes (c-1) and (d) when the year was settled informally', () => {
      expect(openCites(subject({ ending: 'informal' }), '2026-09-01')).toEqual(['25.25(c)']);
      expect(route('25.25(c-1)', subject({ ending: 'informal' }), '2026-09-01').barred).toContain(
        '1.111(e)',
      );
    });

    it('closes (c-1) and (d) when the board determined the protest', () => {
      expect(openCites(subject({ ending: 'arb' }), '2026-09-01')).toEqual(['25.25(c)']);
    });

    it('leaves everything open when the protest was withdrawn', () => {
      // Nothing was determined on the merits and no agreement was reached, so
      // none of 25.25's bars are met. This is the answer worth money.
      expect(openCites(subject({ ending: 'withdrawn' }), '2026-09-01')).toEqual([
        '25.25(c)',
        '25.25(c-1)',
        '25.25(d)',
      ]);
    });

    it('leaves everything open when the protest was dismissed', () => {
      expect(openCites(subject({ ending: 'dismissed' }), '2026-09-01')).toContain('25.25(c-1)');
    });

    it('keeps (c) open through a protest, because 25.25(l) says so', () => {
      const shut = route('25.25(c)', subject({ ending: 'arb' }), '2026-09-01');
      expect(shut.open).toBe(true);
      expect(shut.barred).toBeNull();
      expect(correctionOutlook(subject({ ending: 'arb' }), '2026-09-01').standing).toContain(
        '25.25(l)',
      );
    });
  });

  describe('the second cost of a late rendition', () => {
    it('closes (c-1) where the notice applied the 22.28 penalty', () => {
      const shut = route('25.25(c-1)', subject({ renditionPenaltyApplied: true }), '2026-09-01');
      expect(shut.open).toBe(false);
      expect(shut.barred).toContain('25.25(c-1)(1)');
    });

    it('does not let the penalty touch (c) or (d)', () => {
      expect(openCites(subject({ renditionPenaltyApplied: true }), '2026-09-01')).toEqual([
        '25.25(c)',
        '25.25(d)',
      ]);
    });
  });

  describe('a year we did not run', () => {
    // `ending: null` means "nothing on file", which is not the same claim as
    // "nothing happened" — and on a year reconstructed from a notice the client
    // found in a drawer, only the first is true.
    const stranger = subject({ historyKnown: false });

    it('still opens the routes, because no bar is known to apply', () => {
      expect(openCites(stranger, '2026-09-01')).toEqual([
        '25.25(c)',
        '25.25(c-1)',
        '25.25(d)',
      ]);
    });

    it('will not let (c-1) or (d) read as confirmed', () => {
      expect(route('25.25(c-1)', stranger, '2026-09-01').grounds).toContain('Confirm with the district');
      expect(route('25.25(d)', stranger, '2026-09-01').grounds).toContain('Confirm with the district');
      expect(correctionOutlook(stranger, '2026-09-01').standing).toContain('Ask the district');
    });

    it('leaves (c) alone, which nothing in 25.25 bars anyway', () => {
      expect(route('25.25(c)', stranger, '2026-09-01').grounds).not.toContain('Confirm');
    });

    it('says nothing about confirming once only (c) is left', () => {
      // Past (c-1) and (d), the caveat is about routes that have already shut.
      expect(correctionOutlook(stranger, '2029-06-01').standing).not.toContain('Ask the district');
    });
  });

  describe('25.25(d)', () => {
    it('works the one-third threshold back to a value somebody can check', () => {
      // More than one-third over correct means correct is under three quarters
      // of what is on the roll.
      const d = route('25.25(d)', subject({ rolledValue: 812_000 }), '2026-09-01');
      expect(d.threshold).toBeCloseTo(1 / 3);
      expect(d.grounds).toContain('$609,000');
    });

    it('says so rather than guessing when no value is known', () => {
      expect(route('25.25(d)', subject({ rolledValue: null }), '2026-09-01').grounds).toContain(
        'cannot be worked out',
      );
    });

    it('prints the late-correction penalty as the reason to take it last', () => {
      expect(route('25.25(d)', subject(), '2026-09-01').cost).toContain('10%');
      expect(correctionOutlook(subject(), '2026-09-01').standing).toContain('first');
    });
  });

  it('names the free routes ahead of the paid one', () => {
    const outlook = correctionOutlook(subject(), '2026-09-01');
    expect(outlook.standing).toContain('25.25(c), 25.25(c-1) and 25.25(d)');
    expect(outlook.standing).toContain('25.25(c) and 25.25(c-1) first');
  });
});
