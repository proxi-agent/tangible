import { describe, expect, it } from 'vitest';
import { appraise } from './appraise.js';
import { categoriesFor, categoryFor } from './categories.js';
import { scheduleFor } from './registry.js';
import { TX_HARRIS_2026 as H } from './schedules/tx-harris-2026.js';
import { TX_TARRANT_2026 as T } from './schedules/tx-tarrant-2026.js';
import type { DepreciationSchedule } from './types.js';

/**
 * The fourth jurisdiction, and the third structural shape. Harris and Florida
 * publish a cost index and a percent good separately; Dallas and Collin publish
 * their product. Tarrant publishes percent good and no index at all, which
 * means the properties that fail on Dallas hold here — and holding is now
 * something that has to be asserted rather than assumed.
 */
describe('Tarrant', () => {
  const value = (input: Parameters<typeof appraise>[0], schedule: DepreciationSchedule = T) => {
    const result = appraise(input, schedule);
    if (!result.ok) throw new Error(`expected an appraisal, got gap: ${result.gap.detail}`);
    return result.value;
  };

  it('matches the printed schedule', () => {
    expect(T.percentGood[10]![2019]).toBe(56);
    expect(T.percentGood[6]![2023]).toBe(62);
    expect(T.percentGood[4]![2024]).toBe(58);
    expect(T.percentGood[5]![2024]).toBe(66);
    // TAD prints no eighteen, twenty-five or thirty year column, and no
    // equipment-keyed table of any kind.
    expect(T.percentGood[18]).toBeUndefined();
    expect(T.percentGood[25]).toBeUndefined();
    expect(T.percentGood[30]).toBeUndefined();
    for (const table of Object.values(T.specialPercentGood)) {
      expect(Object.keys(table)).toHaveLength(0);
    }
  });

  it('reproduces the district’s own worked footnote', () => {
    // "For example, an 8 year assets acquired in 1993 would use 15 percent
    // good." 1993 is far older than the column's last printed row, so the
    // district is stating its own floor rule and its own floor value in prose.
    // It is the only independent check the document offers on the grid.
    const eight = T.percentGood[8]!;
    const oldest = Math.min(...Object.keys(eight).map(Number));
    expect(eight[oldest]).toBe(15);
  });

  it('falls monotonically with age, which Dallas and Collin do not', () => {
    for (const table of Object.values(T.percentGood)) {
      const years = Object.keys(table!)
        .map(Number)
        .sort((a, b) => b - a);
      for (let i = 1; i < years.length; i += 1) {
        expect(table![years[i]!]!).toBeLessThanOrEqual(table![years[i - 1]!]!);
      }
    }
  });

  it('never publishes a figure above 100, which Dallas and Collin do', () => {
    for (const table of Object.values(T.percentGood)) {
      for (const percent of Object.values(table!)) {
        expect(percent).toBeGreaterThan(0);
        expect(percent).toBeLessThanOrEqual(100);
      }
    }
  });

  it('trends nothing, because TAD publishes no cost index to trend with', () => {
    // Unlike Dallas and Collin this is not enforced by `costIndexIncluded`:
    // TAD's figures really are percent good, so claiming the index is folded
    // into them would be a false statement about the data. What holds it is
    // that all twelve category rules say `indexed: false`, with the empty
    // `indexFactors` as a failsafe that gaps loudly if one ever slips.
    expect(T.costIndexIncluded).toBeUndefined();
    expect(Object.keys(T.indexFactors)).toHaveLength(0);
    for (const category of categoriesFor(T)) {
      expect(category.indexed).toBe(false);
      const result = appraise(
        { originalCost: 1_000, acquisitionYear: 2022, categoryKey: category.key },
        T,
      );
      if (result.ok) expect(result.value.indexFactor).toBe(1);
    }
    // And if one did slip, the empty table gaps rather than defaulting to 1.
    const miswired: DepreciationSchedule = {
      ...T,
      categories: {
        ...T.categories,
        'furniture-fixtures': { ...categoryFor(T, 'furniture-fixtures')!, indexed: true },
      },
    };
    const slipped = appraise(
      { originalCost: 1_000, acquisitionYear: 2022, categoryKey: 'furniture-fixtures' },
      miswired,
    );
    expect(slipped.ok).toBe(false);
  });

  it('resolves effective age to year acquired against the schedule year', () => {
    // TAD prints ages, not years, and leaves the Year Acquired column blank, so
    // every row in this file is 2026 minus an age. The three-year column runs
    // ages 1 to 5, and its last row is the "& OLDER" line that carries no
    // numeral at all in the PDF. An off-by-one anywhere in that conversion
    // moves both ends of every column at once.
    const three = Object.keys(T.percentGood[3]!).map(Number);
    expect(Math.max(...three)).toBe(T.taxYear - 1);
    expect(Math.min(...three)).toBe(T.taxYear - 5);
    const twenty = Object.keys(T.percentGood[20]!).map(Number);
    expect(Math.max(...twenty)).toBe(T.taxYear - 1);
    expect(Math.min(...twenty)).toBe(T.taxYear - 30);
  });

  it('publishes contiguous years in every column', () => {
    for (const table of Object.values(T.percentGood)) {
      const years = Object.keys(table!).map(Number);
      const span = Math.max(...years) - Math.min(...years) + 1;
      expect(years).toHaveLength(span);
    }
  });

  it('splits point of sale away from mainframes, which no other district here does', () => {
    // TAD names POS equipment at five years and excludes it by name from the
    // four-year computers line. The five-year line is the higher percent good
    // of the two, which overstates our value for a genuine mainframe and
    // understates the client's claim — the safe direction, and still a call a
    // reviewer has to make.
    expect(categoryFor(T, 'computer-mainframe')?.schedule).toBe(5);
    expect(categoryFor(T, 'computer-pc')?.schedule).toBe(4);
    const pos = value({
      originalCost: 9_000,
      acquisitionYear: 2024,
      categoryKey: 'computer-mainframe',
    });
    const pc = value({ originalCost: 9_000, acquisitionYear: 2024, categoryKey: 'computer-pc' });
    expect(pos.marketValue).toBeGreaterThan(pc.marketValue);
  });

  it('sends four shared categories to a different life than Harris County does', () => {
    const pairs: [string, number | string, number | string][] = [
      ['furniture-fixtures', 10, 8],
      ['office-equipment', 6, 6],
      ['leasehold-improvements', 10, 6],
      ['telecom-8', 4, 'telecom8'],
    ];
    for (const [key, tarrant, harris] of pairs) {
      expect(categoryFor(T, key)?.schedule).toBe(tarrant);
      expect(categoryFor(H, key)?.schedule).toBe(harris);
    }
  });

  it('offers every shared key, so a client that opens a Tarrant site stays classified', () => {
    const keys = new Set(categoriesFor(T).map((c) => c.key));
    for (const category of categoriesFor(H)) expect(keys.has(category.key)).toBe(true);
  });

  it('reads no SIC, because TAD names codes for two lines of business and no more', () => {
    expect(Object.keys(T.sicProfiles)).toHaveLength(0);
    expect(categoryFor(T, 'machinery-equipment')?.sicDriven).toBeUndefined();
    const withSic = value({
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
      businessSic: '3599',
    });
    const without = value({
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
    });
    expect(withSic.marketValue).toBe(without.marketValue);
  });

  it('keeps Texas counties on their own tables', () => {
    expect(scheduleFor('tx-tarrant', 2026)).toBe(T);
    expect(scheduleFor('tx-harris', 2026)).toBe(H);
  });
});
