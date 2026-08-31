import { describe, expect, it } from 'vitest';
import { appraise } from './appraise.js';
import { categoriesFor, categoryFor } from './categories.js';
import { scheduleFor } from './registry.js';
import { TX_DALLAS_2026 as D } from './schedules/tx-dallas-2026.js';
import { TX_HARRIS_2026 as H } from './schedules/tx-harris-2026.js';
import { LIFE_CLASSES, type DepreciationSchedule } from './types.js';

/**
 * The third jurisdiction, and the first that does not publish its method the
 * way the first two do. Florida proved Harris County was not the abstraction;
 * Dallas proves the *tables* were not either.
 */
describe('Dallas', () => {
  const value = (input: Parameters<typeof appraise>[0], schedule: DepreciationSchedule = D) => {
    const result = appraise(input, schedule);
    if (!result.ok) throw new Error(`expected an appraisal, got gap: ${result.gap.detail}`);
    return result.value;
  };

  it('matches the printed worksheet', () => {
    expect(D.percentGood[10]![2019]).toBe(66);
    expect(D.percentGood[5]![2023]).toBe(54);
    expect(D.percentGood[25]![2020]).toBe(107);
    expect(D.specialPercentGood.pc[2024]).toBe(56);
    // Dallas stops at twenty-five and Harris has no eighteen. Between them they
    // are why the life classes are a union and the tables are partial.
    expect(D.percentGood[30]).toBeUndefined();
    expect(H.percentGood[18]).toBeUndefined();
  });

  it('reproduces the worksheet’s own worked footnote', () => {
    // "For example on 5 year life assets, any assets purchased prior to 2018,
    // total the assets' cost and apply 13% RCLND." This is the one figure DCAD
    // states in prose as well as printing in the grid, so it is the only
    // independent check the document offers on the transcription.
    const older = value({
      originalCost: 100_000,
      acquisitionYear: 2011,
      categoryKey: 'office-equipment',
    });
    expect(older.percentGood).toBe(13);
    expect(older.atFloor).toBe(true);
  });

  it('bottoms out at the lowest figure in every column, which is what makes the floor rule the district’s own', () => {
    // The other footnote — "For prior year assets ... apply the lowest
    // percentage shown" — is `lookupPercentGood`'s floor rule only because the
    // oldest published year in each column is also the smallest figure in it.
    // That is not automatic for a non-monotonic table, so it is checked rather
    // than assumed.
    for (const life of LIFE_CLASSES) {
      const table = D.percentGood[life];
      if (!table) continue;
      const years = Object.keys(table).map(Number);
      const oldest = Math.min(...years);
      const lowest = Math.min(...years.map((year) => table[year]!));
      expect(table[oldest]).toBe(lowest);
    }
  });

  it('publishes figures that rise with age, and does not apologise for it', () => {
    // RCLND is percent good times a cost index, and for a few years after 2020
    // the index wins. A future change that "restores monotonicity" here is
    // changing the district's published table, and this is what stops it.
    expect(D.percentGood[10]![2021]!).toBeGreaterThan(D.percentGood[10]![2022]!);
    expect(D.percentGood[25]![2020]!).toBeGreaterThan(100);
    const gain = value({
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
      lifeClassOverride: 25,
    });
    expect(gain.marketValue).toBeGreaterThan(250_000);
  });

  it('runs the Computers column as ordinary percent good, unlike the life columns', () => {
    const years = Object.keys(D.specialPercentGood.pc)
      .map(Number)
      .sort((a, b) => b - a);
    for (let i = 1; i < years.length; i += 1) {
      expect(D.specialPercentGood.pc[years[i]!]!).toBeLessThanOrEqual(
        D.specialPercentGood.pc[years[i - 1]!]!,
      );
    }
    expect(Math.max(...years.map((year) => D.specialPercentGood.pc[year]!))).toBeLessThanOrEqual(
      100,
    );
  });

  it('never indexes anything, whatever a category rule claims', () => {
    // The fact belongs to the district's arithmetic, not to the twelve category
    // rules, so it is enforced from the schedule. A Dallas schedule whose rules
    // were edited to say `indexed: true` still indexes nothing — which is the
    // only way to be sure a trended table is never trended twice.
    for (const category of categoriesFor(D)) {
      const result = appraise(
        { originalCost: 1_000, acquisitionYear: 2022, categoryKey: category.key },
        D,
      );
      // `specific-equipment` has no Dallas column and gaps; the rest value.
      if (result.ok) expect(result.value.indexFactor).toBe(1);
    }
    const miswired: DepreciationSchedule = {
      ...D,
      categories: {
        ...D.categories,
        'furniture-fixtures': { ...categoryFor(D, 'furniture-fixtures')!, indexed: true },
      },
      indexFactors: { 2022: 1.2 },
    };
    expect(
      value(
        { originalCost: 1_000, acquisitionYear: 2022, categoryKey: 'furniture-fixtures' },
        miswired,
      ).indexFactor,
    ).toBe(1);
  });

  it('sends four shared categories to a different column than Harris County does', () => {
    const pairs: [string, number | string, number | string][] = [
      ['furniture-fixtures', 10, 8],
      ['office-equipment', 5, 6],
      ['telecom-8', 5, 'telecom8'],
      ['vehicles', 5, 6],
    ];
    for (const [key, dallas, harris] of pairs) {
      expect(categoryFor(D, key)?.schedule).toBe(dallas);
      expect(categoryFor(H, key)?.schedule).toBe(harris);
    }
  });

  it('offers every shared key, so a client that opens a Dallas site stays classified', () => {
    expect(categoriesFor(D).map((c) => c.key)).toEqual(categoriesFor(H).map((c) => c.key));
  });

  it('reads no SIC, because DCAD publishes no table to read one against', () => {
    const input = {
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
      businessSic: '3599',
    };
    const dallas = value(input);
    expect(dallas.lifeSource).toBe('category');
    expect(dallas.sicProfile).toBeNull();
    // The same asset and the same SIC in Harris County. This is the largest
    // single lever on a Texas rendition and it does not exist in Dallas.
    expect(value(input, H).lifeSource).toBe('sic');
  });

  it('gaps rather than guessing where DCAD publishes no column at all', () => {
    const spc = appraise(
      { originalCost: 12_000, acquisitionYear: 2023, categoryKey: 'specific-equipment' },
      D,
    );
    expect(spc.ok).toBe(false);
    expect(!spc.ok && spc.gap.reason).toBe('no-schedule');

    const thirty = appraise(
      {
        originalCost: 12_000,
        acquisitionYear: 2023,
        categoryKey: 'machinery-equipment',
        lifeClassOverride: 30,
      },
      D,
    );
    expect(thirty.ok).toBe(false);
  });

  it('keeps Texas counties on their own tables', () => {
    expect(scheduleFor('tx-dallas', 2026)?.jurisdictionId).toBe('tx-dallas');
    expect(scheduleFor('tx-harris', 2026)?.jurisdictionId).toBe('tx-harris');
    // Neither the Florida statewide fallback nor a Texas neighbour reaches a
    // county with nothing published of its own. Bexar used to stand for that
    // here and now has tables; Fort Bend carries it, and will hand it on the
    // same way when its guide is read.
    expect(scheduleFor('tx-fort-bend', 2026)).toBeUndefined();
  });
});
