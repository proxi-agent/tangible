import { describe, expect, it } from 'vitest';
import { appraise } from './appraise.js';
import { categoriesFor, categoryFor, CATEGORY_BY_KEY } from './categories.js';
import { FL_DOR_2026 } from './schedules/fl-dor-2026.js';
import { TX_HARRIS_2026 } from './schedules/tx-harris-2026.js';
import { scheduleFor } from './registry.js';

/**
 * The second jurisdiction, which exists to prove the first one was not the
 * abstraction.
 */
describe('Florida', () => {
  it('gives a Florida county the state guidelines and a Texas county nothing but its own', () => {
    expect(scheduleFor('fl-miami-dade', 2026)?.jurisdictionId).toBe('fl');
    // The Texas rule is unchanged and load-bearing: a district with no guide of
    // its own must not quietly be valued on a neighbour's.
    expect(scheduleFor('tx-dallas', 2026)).toBeUndefined();
  });

  it('values the same category differently on each side of the state line', () => {
    expect(categoryFor(TX_HARRIS_2026, 'furniture-fixtures')?.schedule).toBe(8);
    expect(categoryFor(FL_DOR_2026, 'furniture-fixtures')?.schedule).toBe(10);
  });

  it('falls back to the shared table for a category the state does not re-answer', () => {
    expect(categoryFor(FL_DOR_2026, 'vessels')).toBe(CATEGORY_BY_KEY['vessels']);
  });

  it('offers every shared key in both jurisdictions, so a register stays classifiable', () => {
    expect(categoriesFor(FL_DOR_2026).map((c) => c.key)).toEqual(
      categoriesFor(TX_HARRIS_2026).map((c) => c.key),
    );
  });

  it('renders Texas inventory at full cost and takes Florida inventory off the roll', () => {
    const input = { originalCost: 400_000, acquisitionYear: 2024, categoryKey: 'inventory' };

    const texas = appraise(input, TX_HARRIS_2026);
    expect(texas.ok && texas.value.marketValue).toBe(400_000);
    expect(texas.ok && texas.value.exempt).toBe(false);

    const florida = appraise(input, FL_DOR_2026);
    expect(florida.ok && florida.value.marketValue).toBe(0);
    expect(florida.ok && florida.value.exempt).toBe(true);
    expect(florida.ok && florida.value.exemptReason).toContain('196.185');
  });

  it('excludes licensed vehicles from Florida tangible personal property', () => {
    const florida = appraise(
      { originalCost: 68_000, acquisitionYear: 2023, categoryKey: 'vehicles' },
      FL_DOR_2026,
    );
    expect(florida.ok && florida.value.exempt).toBe(true);
    expect(florida.ok && florida.value.exemptReason).toContain('192.001(11)(d)');
  });

  /**
   * The one that matters most. An untranscribed table must produce a question,
   * never a number — a missing index factor read as 1.000 understates the
   * district's value, which overstates the client's overpayment.
   */
  it('gaps rather than guessing while the tables are awaiting transcription', () => {
    const result = appraise(
      { originalCost: 120_000, acquisitionYear: 2022, categoryKey: 'furniture-fixtures' },
      FL_DOR_2026,
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.gap.reason).toBe('no-schedule');
  });

  it('names the document that has to be read before Florida values anything', () => {
    expect(FL_DOR_2026.status).toBe('awaiting-transcription');
    expect(FL_DOR_2026.awaiting?.missing.length).toBeGreaterThan(0);
    expect(FL_DOR_2026.awaiting?.document).toContain('Attachment');
  });

  it('leaves the SIC lives to Harris County, which is the district that publishes them', () => {
    expect(Object.keys(FL_DOR_2026.sicProfiles)).toHaveLength(0);
    expect(Object.keys(TX_HARRIS_2026.sicProfiles).length).toBeGreaterThan(0);
  });
});
