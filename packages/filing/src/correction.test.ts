import { describe, expect, it } from 'vitest';
import type { AssessmentNoticeFacts, ProtestResolutionFacts } from '@tangible/types';
import { correctionOutlook } from './correction.js';

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
  noticedValue: 800_000,
  finalValue: 700_000,
  penaltyOutcome: null,
  orderReference: null,
  ...over,
});

/** The routes, by cite, that are actually usable. */
const openCites = (
  n: AssessmentNoticeFacts,
  r: ProtestResolutionFacts | null,
  today: string,
  value: number | null = 800_000,
) =>
  correctionOutlook(n, r, value, today)
    .routes.filter((route) => route.open)
    .map((route) => route.cite);

const route = (
  key: string,
  n: AssessmentNoticeFacts,
  r: ProtestResolutionFacts | null,
  today: string,
  value: number | null = 800_000,
) => correctionOutlook(n, r, value, today).routes.find((one) => one.cite === key)!;

describe('correctionOutlook', () => {
  it('leaves all three open in the year itself, before the taxes go delinquent', () => {
    expect(openCites(notice(), null, '2026-09-01')).toEqual(['25.25(c)', '25.25(c-1)', '25.25(d)']);
  });

  it('closes (d) once the taxes go delinquent on February 1', () => {
    expect(route('25.25(d)', notice(), null, '2027-01-31').open).toBe(true);
    expect(route('25.25(d)', notice(), null, '2027-02-01').open).toBe(false);
    expect(route('25.25(d)', notice(), null, '2027-02-01').barred).toContain('delinquent');
  });

  it('gives (c-1) the current year and the two after it', () => {
    expect(route('25.25(c-1)', notice(), null, '2028-12-31').open).toBe(true);
    expect(route('25.25(c-1)', notice(), null, '2029-01-01').open).toBe(false);
  });

  it('gives (c) five years past the tax year', () => {
    expect(route('25.25(c)', notice(), null, '2031-12-31').open).toBe(true);
    expect(route('25.25(c)', notice(), null, '2032-01-01').open).toBe(false);
  });

  it('says nothing is left once even (c) has run', () => {
    const outlook = correctionOutlook(notice(), null, 800_000, '2032-06-01');
    expect(outlook.open).toBe(false);
    expect(outlook.standing).toContain('25.25(a)');
    expect(outlook.standing).toContain('December 31, 2031');
  });

  describe('what an ending costs', () => {
    it('closes (c-1) and (d) when the year was settled informally', () => {
      const open = openCites(notice(), resolution({ stage: 'informal' }), '2026-09-01');
      expect(open).toEqual(['25.25(c)']);
      expect(route('25.25(c-1)', notice(), resolution(), '2026-09-01').barred).toContain(
        '1.111(e)',
      );
    });

    it('closes (c-1) and (d) when the board determined the protest', () => {
      const open = openCites(notice(), resolution({ stage: 'arb' }), '2026-09-01');
      expect(open).toEqual(['25.25(c)']);
    });

    it('leaves everything open when the protest was withdrawn', () => {
      // Nothing was determined on the merits and no agreement was reached, so
      // none of 25.25's bars are met. This is the answer worth money.
      const open = openCites(
        notice(),
        resolution({ stage: 'withdrawn', finalValue: null }),
        '2026-09-01',
      );
      expect(open).toEqual(['25.25(c)', '25.25(c-1)', '25.25(d)']);
    });

    it('leaves everything open when the protest was dismissed', () => {
      const open = openCites(
        notice(),
        resolution({ stage: 'dismissed', finalValue: null }),
        '2026-09-01',
      );
      expect(open).toContain('25.25(c-1)');
    });

    it('ignores a resolution that was voided', () => {
      const open = openCites(notice(), resolution({ status: 'void' }), '2026-09-01');
      expect(open).toContain('25.25(c-1)');
    });

    it('keeps (c) open through a protest, because 25.25(l) says so', () => {
      const shut = route('25.25(c)', notice(), resolution({ stage: 'arb' }), '2026-09-01');
      expect(shut.open).toBe(true);
      expect(shut.barred).toBeNull();
      expect(
        correctionOutlook(notice(), resolution({ stage: 'arb' }), 800_000, '2026-09-01').standing,
      ).toContain('25.25(l)');
    });
  });

  describe('the second cost of a late rendition', () => {
    it('closes (c-1) where the notice applied the 22.28 penalty', () => {
      const shut = route(
        '25.25(c-1)',
        notice({ renditionPenaltyApplied: true }),
        null,
        '2026-09-01',
      );
      expect(shut.open).toBe(false);
      expect(shut.barred).toContain('25.25(c-1)(1)');
    });

    it('does not let the penalty touch (c) or (d)', () => {
      const open = openCites(notice({ renditionPenaltyApplied: true }), null, '2026-09-01');
      expect(open).toEqual(['25.25(c)', '25.25(d)']);
    });
  });

  describe('25.25(d)', () => {
    it('works the one-third threshold back to a value somebody can check', () => {
      // More than one-third over correct means correct is under three quarters
      // of what is on the roll.
      const d = route('25.25(d)', notice(), null, '2026-09-01', 812_000);
      expect(d.threshold).toBeCloseTo(1 / 3);
      expect(d.grounds).toContain('$609,000');
    });

    it('says so rather than guessing when no value is on the notice', () => {
      expect(route('25.25(d)', notice(), null, '2026-09-01', null).grounds).toContain(
        'cannot be worked out',
      );
    });

    it('prints the late-correction penalty as the reason to take it last', () => {
      const outlook = correctionOutlook(notice(), null, 800_000, '2026-09-01');
      expect(route('25.25(d)', notice(), null, '2026-09-01').cost).toContain('10%');
      expect(outlook.standing).toContain('first');
    });
  });

  it('names the free routes ahead of the paid one', () => {
    const outlook = correctionOutlook(notice(), null, 800_000, '2026-09-01');
    expect(outlook.standing).toContain('25.25(c), 25.25(c-1) and 25.25(d)');
    expect(outlook.standing).toContain('25.25(c) and 25.25(c-1) first');
  });
});
