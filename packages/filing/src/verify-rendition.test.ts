import { describe, expect, it } from 'vitest';
import type { ExtractedRendition, PriorReturnLine, PriorReturnSchedule } from '@tangible/types';
import { rollupReported, verifyRendition } from './verify-rendition.js';

function line(over: Partial<PriorReturnLine> = {}): PriorReturnLine {
  return {
    schedule: 'E',
    type: 'Machinery & Equipment',
    yearAcquired: 2019,
    historicalCost: 185000,
    goodFaithEstimate: null,
    sourcePage: 2,
    ...over,
  };
}

function schedule(over: Partial<PriorReturnSchedule> = {}): PriorReturnSchedule {
  const lines = over.lines ?? [line()];
  return {
    key: 'E',
    lines,
    statedTotal: over.statedTotal !== undefined ? over.statedTotal : sum(lines),
    ...over,
    lines,
  };
}

function sum(lines: PriorReturnLine[]): number {
  return lines.reduce((t, l) => t + (l.historicalCost ?? l.goodFaithEstimate ?? 0), 0);
}

function rendition(over: Partial<ExtractedRendition> = {}): ExtractedRendition {
  const schedules = over.schedules ?? [schedule()];
  return {
    ownerName: 'Acme Machining LLC',
    accountId: '2349508',
    taxYear: 2026,
    districtName: 'Harris County Appraisal District',
    basis: 'cost',
    schedules,
    statedFormTotal:
      over.statedFormTotal !== undefined
        ? over.statedFormTotal
        : schedules.reduce((t, s) => t + (s.statedTotal ?? 0), 0),
    isSigned: true,
    unreadable: [],
    ...over,
    schedules,
  };
}

const codes = (r: ReturnType<typeof verifyRendition>) => r.issues.map((i) => i.code);

describe('verifyRendition', () => {
  it('verifies a return whose schedules and form total all foot', () => {
    const result = verifyRendition(rendition());
    expect(result.status).toBe('verified');
    expect(result.issues).toEqual([]);
    expect(result.derivedTotal).toBe(185000);
    expect(result.lineCount).toBe(1);
  });

  /**
   * The check this whole file exists for. A transposed digit in one line breaks
   * the schedule's footing, which is what stops a misread figure from silently
   * becoming the baseline every later finding is measured against.
   */
  it('catches a transposed digit as a schedule that does not foot', () => {
    const misread = verifyRendition(
      rendition({
        schedules: [
          schedule({
            lines: [line({ historicalCost: 18500 })], // 185,000 read as 18,500
            statedTotal: 185000,
          }),
        ],
        statedFormTotal: 185000,
      }),
    );
    expect(misread.status).toBe('discrepant');
    expect(codes(misread)).toContain('schedule-does-not-foot');
    const issue = misread.issues.find((i) => i.code === 'schedule-does-not-foot');
    expect(issue).toMatchObject({
      severity: 'error',
      schedule: 'E',
      expected: 185000,
      actual: 18500,
    });
    expect(issue?.message).toContain('$166,500');
  });

  it('tolerates hand-rounding but not the smallest transposition', () => {
    const rounding = verifyRendition(
      rendition({
        schedules: [schedule({ lines: [line({ historicalCost: 185000 })], statedTotal: 185001 })],
        statedFormTotal: 185001,
      }),
    );
    expect(rounding.status).toBe('verified');

    // The smallest digit-swap on a four-figure line is $9, comfortably outside.
    const swapped = verifyRendition(
      rendition({
        schedules: [schedule({ lines: [line({ historicalCost: 1243 })], statedTotal: 1234 })],
        statedFormTotal: 1234,
      }),
    );
    expect(swapped.status).toBe('discrepant');
    expect(codes(swapped)).toContain('schedule-does-not-foot');
  });

  it('checks the form total against the schedules independently', () => {
    const result = verifyRendition(
      rendition({
        schedules: [
          schedule({ key: 'E', lines: [line({ historicalCost: 100000 })], statedTotal: 100000 }),
          schedule({
            key: 'C',
            lines: [
              line({ schedule: 'C', type: 'Supplies', yearAcquired: null, historicalCost: 5000 }),
            ],
            statedTotal: 5000,
          }),
        ],
        statedFormTotal: 200000,
      }),
    );
    expect(result.status).toBe('discrepant');
    expect(codes(result)).toContain('form-does-not-foot');
    expect(result.issues.find((i) => i.code === 'form-does-not-foot')).toMatchObject({
      expected: 200000,
      actual: 105000,
    });
  });

  /**
   * A returned document that does not add up is a finding, not a reject. The
   * status refuses to call it verified; it does not throw it away.
   */
  it('keeps the figures it read even when the return does not foot', () => {
    const result = verifyRendition(
      rendition({
        schedules: [schedule({ lines: [line({ historicalCost: 90000 })], statedTotal: 100000 })],
        statedFormTotal: 100000,
      }),
    );
    expect(result.status).toBe('discrepant');
    expect(result.derivedTotal).toBe(90000);
    expect(result.statedTotal).toBe(100000);
    expect(result.lineCount).toBe(1);
  });

  it('flags a return filed under a different account as an error', () => {
    const result = verifyRendition(rendition({ accountId: '9999999' }), {
      expectedAccountId: '2349508',
    });
    expect(result.status).toBe('discrepant');
    expect(codes(result)).toContain('account-mismatch');
  });

  it('ignores account punctuation when comparing', () => {
    const result = verifyRendition(rendition({ accountId: '234-9508' }), {
      expectedAccountId: '2349508',
    });
    expect(codes(result)).not.toContain('account-mismatch');
  });

  /** A prior return is a prior year by definition — that is not an error. */
  it('treats a different tax year as a warning, not an error', () => {
    const result = verifyRendition(rendition({ taxYear: 2026 }), { expectedTaxYear: 2027 });
    expect(result.status).toBe('verified');
    expect(codes(result)).toContain('tax-year-mismatch');
  });

  it('rejects a negative amount, which a cost basis cannot produce', () => {
    const result = verifyRendition(
      rendition({
        schedules: [schedule({ lines: [line({ historicalCost: -500 })], statedTotal: -500 })],
        statedFormTotal: -500,
      }),
    );
    expect(result.status).toBe('discrepant');
    expect(codes(result)).toContain('negative-line');
  });

  it('rejects a year the return could not possibly report', () => {
    const result = verifyRendition(
      rendition({
        schedules: [schedule({ lines: [line({ yearAcquired: 2031 })] })],
      }),
    );
    expect(result.status).toBe('discrepant');
    expect(codes(result)).toContain('implausible-year');
  });

  it('warns when Schedule E lines carry no year to age them by', () => {
    const result = verifyRendition(
      rendition({ schedules: [schedule({ lines: [line({ yearAcquired: null })] })] }),
    );
    expect(result.status).toBe('verified');
    expect(codes(result)).toContain('schedule-e-missing-year');
  });

  it('warns when Schedule A is at or above the ceiling the form reserves it for', () => {
    const result = verifyRendition(
      rendition({
        schedules: [
          schedule({
            key: 'A',
            lines: [line({ schedule: 'A', yearAcquired: null, historicalCost: 24000 })],
            statedTotal: 24000,
          }),
        ],
        statedFormTotal: 24000,
      }),
    );
    expect(codes(result)).toContain('schedule-a-over-ceiling');
  });

  /**
   * Without a printed total the lines corroborate nothing — that has to be said,
   * or an unchecked extraction reads as a checked one.
   */
  it('says so when a schedule has no printed total to check against', () => {
    const result = verifyRendition(
      rendition({
        schedules: [schedule({ statedTotal: null })],
        statedFormTotal: 185000,
      }),
    );
    expect(codes(result)).toContain('no-stated-total');
  });

  it('errors when nothing was read at all', () => {
    const result = verifyRendition(rendition({ schedules: [], statedFormTotal: null }));
    expect(result.status).toBe('discrepant');
    expect(codes(result)).toContain('no-lines');
  });

  it('surfaces regions the extractor said it could not read', () => {
    const result = verifyRendition(rendition({ unreadable: ['Schedule B total, handwritten'] }));
    expect(codes(result)).toContain('unreadable-regions');
    expect(result.issues.find((i) => i.code === 'unreadable-regions')?.message).toContain(
      'handwritten',
    );
  });

  /**
   * Schedule E asks for cost and year; an estimate written beside it is
   * supplementary. Summing both would double-count the same property.
   */
  it('counts a line once when it carries both a cost and an estimate', () => {
    const result = verifyRendition(
      rendition({
        schedules: [
          schedule({
            lines: [line({ historicalCost: 100000, goodFaithEstimate: 60000 })],
            statedTotal: 100000,
          }),
        ],
        statedFormTotal: 100000,
      }),
    );
    expect(result.status).toBe('verified');
    expect(result.derivedTotal).toBe(100000);
  });

  it('falls back to the estimate when the filer reported no cost', () => {
    const result = verifyRendition(
      rendition({
        basis: 'estimate',
        schedules: [
          schedule({
            lines: [line({ historicalCost: null, goodFaithEstimate: 60000 })],
            statedTotal: 60000,
          }),
        ],
        statedFormTotal: 60000,
      }),
    );
    expect(result.status).toBe('verified');
    expect(result.derivedTotal).toBe(60000);
  });

  it('warns about a line carrying neither figure', () => {
    const result = verifyRendition(
      rendition({
        schedules: [
          schedule({
            lines: [line({ historicalCost: null, goodFaithEstimate: null })],
            statedTotal: 0,
          }),
        ],
        statedFormTotal: 0,
      }),
    );
    expect(codes(result)).toContain('line-without-value');
  });
});

describe('rollupReported', () => {
  it('rolls to the form’s own grain and merges repeated lines', () => {
    const rolled = rollupReported(
      rendition({
        schedules: [
          schedule({
            lines: [
              line({ type: 'Machinery & Equipment', yearAcquired: 2019, historicalCost: 100000 }),
              line({ type: 'machinery & equipment', yearAcquired: 2019, historicalCost: 25000 }),
              line({ type: 'Machinery & Equipment', yearAcquired: 2020, historicalCost: 40000 }),
            ],
            statedTotal: 165000,
          }),
        ],
        statedFormTotal: 165000,
      }),
    );

    expect(rolled.size).toBe(2);
    expect(rolled.get('E|machinery & equipment|2019')?.value).toBe(125000);
    expect(rolled.get('E|machinery & equipment|2020')?.value).toBe(40000);
    // The filer's own wording is preserved, not normalized away — mapping it to
    // our vocabulary is a separate judgement with its own review.
    expect(rolled.get('E|machinery & equipment|2019')?.type).toBe('Machinery & Equipment');
  });

  it('skips lines with nothing to contribute rather than counting them as zero', () => {
    const rolled = rollupReported(
      rendition({
        schedules: [
          schedule({
            lines: [line({ historicalCost: null, goodFaithEstimate: null })],
            statedTotal: 0,
          }),
        ],
      }),
    );
    expect(rolled.size).toBe(0);
  });
});
