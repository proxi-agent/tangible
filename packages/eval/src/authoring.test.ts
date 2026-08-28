import { describe, expect, it } from 'vitest';
import type { ScheduleDraft } from '@tangible/types';
import { reviewDraft } from './authoring.js';

const cells = (from: number, to: number, at: (year: number) => number) =>
  Array.from({ length: from - to + 1 }, (_, i) => ({ year: from - i, value: at(from - i) }));

const draft = (over: Partial<ScheduleDraft> = {}): ScheduleDraft => ({
  jurisdictionId: 'tx-dallas',
  jurisdictionName: 'Dallas County, TX',
  taxYear: 2026,
  title: 'Dallas CAD BPP depreciation schedules, tax year 2026',
  citation:
    'Dallas Central Appraisal District, Business Personal Property Valuation Procedures, Tax Year 2026, pp. 8-11.',
  sourceTitle: 'DCAD BPP Valuation Procedures, Tax Year 2026',
  sourceUrl: 'https://example.invalid/dcad-2026.pdf',
  sourcePages: '8-11',
  effectiveFrom: '2026-01-01',
  effectiveTo: '2026-12-31',
  indexFactors: cells(2025, 2006, (year) => Number((1 + (2025 - year) * 0.03).toFixed(3))),
  percentGood: [
    { lifeClass: 5, cells: cells(2025, 2016, (year) => Math.max(10, (year - 2015) * 10)) },
    { lifeClass: 10, cells: cells(2025, 2011, (year) => Math.max(12, (year - 2010) * 6)) },
  ],
  specialPercentGood: [
    { schedule: 'pc', cells: cells(2025, 2019, (year) => Math.max(10, (year - 2018) * 14)) },
  ],
  sicProfiles: [
    { sic: '3599', description: 'Machine shops', machineryLife: 10, miscLife: 8, stateClass: 'L1' },
  ],
  gaps: [],
  notes: null,
  ...over,
});

describe('reviewing a drafted schedule', () => {
  it('accepts a coherent one', () => {
    const review = reviewDraft(draft());
    expect(review.problems).toEqual([]);
    expect(review.ok).toBe(true);
  });

  it('blocks on anything the drafter could not read', () => {
    const review = reviewDraft(
      draft({ gaps: ['the 20-year column is cut off below 2012 in this excerpt'] }),
    );
    // A refusal to invent is the behaviour we asked for, and it still blocks:
    // a schedule with a hole values some year of some class silently wrong.
    expect(review.ok).toBe(false);
    expect(review.problems[0]).toContain('20-year column');
  });

  it('catches a percent-good column read upside down', () => {
    const review = reviewDraft(
      draft({
        percentGood: [
          { lifeClass: 5, cells: cells(2025, 2016, (year) => Math.max(10, (2025 - year) * 10)) },
        ],
      }),
    );
    expect(review.ok).toBe(false);
    expect(review.problems.join(' ')).toContain('does not get better with age');
  });

  it('catches an index column read in the wrong direction', () => {
    const review = reviewDraft({
      ...draft(),
      indexFactors: cells(2025, 2006, (year) => Number((1 + (year - 2006) * 0.03).toFixed(3))),
    });
    expect(review.ok).toBe(false);
    expect(review.problems.join(' ')).toContain('wrong direction');
  });

  it('catches percent good rescaled to a fraction on the way in', () => {
    const review = reviewDraft(
      draft({
        percentGood: [{ lifeClass: 5, cells: cells(2025, 2021, (year) => (year - 2020) / 10) }],
      }),
    );
    expect(review.ok).toBe(false);
    expect(review.problems.join(' ')).toContain('0–100');
  });

  it('refuses a schedule whose window never closes', () => {
    const review = reviewDraft(draft({ effectiveTo: null }));
    expect(review.ok).toBe(false);
    expect(review.problems.join(' ')).toContain('open window');
  });

  it('renders a module that carries provenance and no approver', () => {
    const review = reviewDraft(draft());
    expect(review.scheduleModule).toContain("ruleId: 'valuation:tx-dallas:2026'");
    expect(review.scheduleModule).toContain('approvedBy: null');
    expect(review.scheduleModule).toContain('DRAFTED, NOT APPROVED');
    expect(review.scheduleModule).toContain('export const TX_DALLAS_2026: DepreciationSchedule');
  });

  it('renders goldens with the expectations left blank', () => {
    const review = reviewDraft(draft());
    // The drafter transcribed the table, so it cannot also certify what the
    // table produces. A person fills these in from a real notice.
    expect(review.goldenModule).toContain("basis: 'assessment-notice'");
    expect(review.goldenModule).toContain('marketValue: 0');
    expect(review.goldenModule).toContain('TODO');
  });

  it('says what is unusual without blocking on it', () => {
    const review = reviewDraft(draft({ sicProfiles: [] }));
    expect(review.ok).toBe(true);
    expect(review.observations.join(' ')).toContain('fall back to the category default');
  });
});
