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
    // its own must not quietly be valued on a neighbour's. Dallas stood for
    // that here, then Bexar; both have tables of their own now, so Fort Bend
    // carries it. The swapping is the point. Every district that has taken a
    // turn here has gone on to disagree with Harris County about something,
    // which is what makes the fallback the wrong answer rather than a
    // harmless one.
    expect(scheduleFor('tx-fort-bend', 2026)).toBeUndefined();
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
   * The one that matters most, and it has changed sides.
   *
   * While Attachments B, C and D were untranscribed this asserted that Florida
   * produced a question rather than a number, because a missing index factor
   * read as 1.000 understates the district's value, which overstates the
   * client's overpayment. The tables are now read off the published guidelines,
   * so the same asset must produce an actual appraisal — and the rest of this
   * block exists to prove the reading is the Department's and not ours.
   */
  it('values a Florida asset off the transcribed tables instead of gapping', () => {
    const result = appraise(
      { originalCost: 120_000, acquisitionYear: 2022, categoryKey: 'furniture-fixtures' },
      FL_DOR_2026,
    );
    // Ten-year life at age four: index 1.06, percent good 67.
    expect(result.ok && result.value.percentGood).toBe(67);
    expect(result.ok && result.value.indexFactor).toBe(1.06);
    expect(result.ok && Math.round(result.value.marketValue)).toBe(85_224);
  });

  it('carries no outstanding transcription now the attachments are read', () => {
    expect(FL_DOR_2026.status).toBe('committed');
    expect(FL_DOR_2026.awaiting).toBeUndefined();
  });

  /**
   * The Department's own arithmetic, from the worked example in section VIII.G:
   * a ten-year asset at an effective age of seven takes a 39% untrended
   * depreciation factor. This is the single strongest check on the whole of
   * Attachment C, because it is the only cell the guidelines themselves compute
   * in prose — every other cell was read off a grid, and a grid read one column
   * out would still look plausible.
   */
  it("reproduces the Department's own worked example for a ten-year asset at age seven", () => {
    const result = appraise(
      { originalCost: 10_000, acquisitionYear: 2019, categoryKey: 'machinery-equipment' },
      FL_DOR_2026,
    );
    expect(result.ok && result.value.schedule).toBe(10);
    expect(result.ok && result.value.percentGood).toBe(39);
  });

  /**
   * The checkpoint this schedule carried in writing for the whole time it was
   * awaiting transcription: "a reading of Attachment C that does not reproduce
   * them was read wrong." Pinned permanently, so a future re-transcription has
   * to clear the same bar.
   */
  it('reads the four-year column as 83 / 65 / 43 / 24', () => {
    expect([2025, 2024, 2023, 2022].map((year) => FL_DOR_2026.percentGood[4][year])).toEqual([
      83, 65, 43, 24,
    ]);
  });

  /**
   * Both tables descend from Marshall Valuation Service Section 97, so the
   * short lives agreeing cell for cell is the expected result rather than a
   * coincidence — and a column read one position out would break this long
   * before it broke anything a client would notice.
   */
  it('agrees with Harris County exactly on the five- and six-year columns', () => {
    for (const life of [5, 6] as const) {
      const florida = FL_DOR_2026.percentGood[life];
      const harris = TX_HARRIS_2026.percentGood[life];
      const shared = Object.keys(florida).filter((year) => harris[Number(year)] !== undefined);
      expect(shared.length).toBeGreaterThan(4);
      for (const year of shared) {
        expect(florida[Number(year)]).toBe(harris[Number(year)]);
      }
    }
  });

  /** And parts company exactly where the schedule says it does. */
  it('values a four-year asset above Harris County, which is what puts PCs in play', () => {
    const input = { originalCost: 50_000, acquisitionYear: 2023, categoryKey: 'computer-pc' };
    // Florida lifes a PC at four years on the age/life table; Harris runs it
    // down its own `pc` schedule off cost with no index at all.
    expect(appraise(input, FL_DOR_2026).ok && appraise(input, FL_DOR_2026).value.schedule).toBe(4);
    expect(
      appraise(input, TX_HARRIS_2026).ok && appraise(input, TX_HARRIS_2026).value.schedule,
    ).toBe('pc');
  });

  /**
   * `specialPercentGood` is empty for Florida on purpose, so a category that
   * still pointed at one of Harris's named equipment schedules would gap on
   * every asset — silently, and only for the categories nobody tested. This is
   * the invariant that makes the empty tables safe to leave empty.
   */
  it('routes no Florida category to one of the empty Harris equipment schedules', () => {
    for (const category of categoriesFor(FL_DOR_2026)) {
      const { schedule } = category;
      if (schedule === 'none' || schedule === 'exempt') continue;
      const table =
        typeof schedule === 'number'
          ? FL_DOR_2026.percentGood[schedule]
          : FL_DOR_2026.specialPercentGood[schedule];
      expect({ key: category.key, cells: Object.keys(table).length > 0 }).toEqual({
        key: category.key,
        cells: true,
      });
    }
  });

  /**
   * Attachment C stops one or two years past each life at a floor of 18-21%.
   * An asset older than that is fully depreciated in the Department's own
   * model, and a client still carrying it at cost is the finding.
   */
  it('floors an asset older than its own column rather than refusing to value it', () => {
    const result = appraise(
      { originalCost: 90_000, acquisitionYear: 2009, categoryKey: 'computer-pc' },
      FL_DOR_2026,
    );
    expect(result.ok && result.value.atFloor).toBe(true);
    expect(result.ok && result.value.percentGood).toBe(18);
  });

  it('leaves the SIC lives to Harris County, which is the district that publishes them', () => {
    expect(Object.keys(FL_DOR_2026.sicProfiles)).toHaveLength(0);
    expect(Object.keys(TX_HARRIS_2026.sicProfiles).length).toBeGreaterThan(0);
  });
});
