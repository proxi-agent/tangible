import { describe, expect, it } from 'vitest';
import { appraise } from './appraise.js';
import { categoriesFor, categoryFor } from './categories.js';
import { scheduleFor } from './registry.js';
import { TX_COLLIN_2026 as C } from './schedules/tx-collin-2026.js';
import { TX_DALLAS_2026 as D } from './schedules/tx-dallas-2026.js';
import { TX_HARRIS_2026 as H } from './schedules/tx-harris-2026.js';
import type { DepreciationSchedule } from './types.js';

/**
 * The fifth jurisdiction, and the one that added two things to the type. Collin
 * publishes seven- and nine-year lives no other district here prints, and its
 * own column for vehicles that is close to its five-year line without being it.
 * Both widenings are asserted below, because the cheap thing to have done in
 * either case was to round onto a neighbouring column, and a rounding is a
 * transcription that reads as a fact.
 */
describe('Collin', () => {
  const value = (input: Parameters<typeof appraise>[0], schedule: DepreciationSchedule = C) => {
    const result = appraise(input, schedule);
    if (!result.ok) throw new Error(`expected an appraisal, got gap: ${result.gap.detail}`);
    return result.value;
  };

  it('matches the printed sheet', () => {
    expect(C.percentGood[9]![2019]).toBe(45);
    expect(C.percentGood[5]![2023]).toBe(54);
    expect(C.percentGood[20]![2020]).toBe(106);
    expect(C.specialPercentGood.veh[2023]).toBe(51);
    // Collin stops at twenty and prints no eighteen.
    expect(C.percentGood[18]).toBeUndefined();
    expect(C.percentGood[25]).toBeUndefined();
    expect(C.percentGood[30]).toBeUndefined();
  });

  it('agrees cell for cell with two other districts, which is the only outside check there is', () => {
    // CCAD's COMPUTERS column is HCAD's personal computer table, and its
    // three-year column is Dallas's. Nothing forced that; two independent
    // transcriptions of two independent PDFs landing on identical figures is
    // stronger evidence than any invariant this file could assert.
    expect(C.specialPercentGood.pc).toEqual(H.specialPercentGood.pc);
    expect(C.percentGood[3]).toEqual(D.percentGood[3]);
  });

  it('publishes seven- and nine-year lives that no other district here does', () => {
    expect(C.percentGood[7]).toBeDefined();
    expect(C.percentGood[9]).toBeDefined();
    for (const other of [H, D]) {
      expect(other.percentGood[7]).toBeUndefined();
      expect(other.percentGood[9]).toBeUndefined();
    }
    // And furniture is on the nine, which is the whole reason the class exists
    // in the type at all.
    expect(categoryFor(C, 'furniture-fixtures')?.schedule).toBe(9);
  });

  it('keeps vehicles on their own column rather than rounding onto the five-year line', () => {
    expect(categoryFor(C, 'vehicles')?.schedule).toBe('veh');
    const veh = C.specialPercentGood.veh;
    const five = C.percentGood[5]!;
    // Close enough that rounding would be tempting, different enough that it
    // would be wrong on every year the client owns.
    for (const year of [2025, 2024, 2023, 2022]) {
      expect(veh[year]).not.toBe(five[year]);
      expect(Math.abs(veh[year]! - five[year]!)).toBeLessThan(10);
    }
    // No other district publishes one, and an empty table is unreachable
    // because their `vehicles` category points at a life class instead.
    for (const other of [H, D]) {
      expect(Object.keys(other.specialPercentGood.veh)).toHaveLength(0);
      expect(typeof categoryFor(other, 'vehicles')?.schedule).toBe('number');
    }
  });

  it('publishes figures that rise with age, and does not apologise for it', () => {
    // A Percent Value Factor is the product of a cost index and a percent good,
    // and in the long-life columns the index wins for a stretch. Anything in
    // this package that asserts monotonic decline is asserting something true
    // of percent good and false of a PVF.
    expect(C.percentGood[10]![2021]).toBeGreaterThan(C.percentGood[10]![2022]!);
    expect(C.percentGood[12]![2021]).toBeGreaterThan(C.percentGood[12]![2022]!);
    expect(C.percentGood[20]![2024]).toBeGreaterThan(C.percentGood[20]![2025]!);
    // And above 100, which a percent good cannot be.
    expect(C.percentGood[20]![2020]).toBeGreaterThan(100);
  });

  it('never indexes anything, whatever a category rule claims', () => {
    expect(C.costIndexIncluded).toBe(true);
    expect(Object.keys(C.indexFactors)).toHaveLength(0);
    for (const category of categoriesFor(C)) {
      const result = appraise(
        { originalCost: 1_000, acquisitionYear: 2022, categoryKey: category.key },
        C,
      );
      if (result.ok) expect(result.value.indexFactor).toBe(1);
    }
    // `costIndexIncluded` is authoritative: trending an already-trended table
    // would value the asset above cost twice over, which overstates the
    // client's claim and would be invisible for exactly that reason.
    const miswired: DepreciationSchedule = {
      ...C,
      categories: {
        ...C.categories,
        'furniture-fixtures': { ...categoryFor(C, 'furniture-fixtures')!, indexed: true },
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

  it('bottoms out at the lowest figure in every column', () => {
    for (const table of [...Object.values(C.percentGood), C.specialPercentGood.veh]) {
      const years = Object.keys(table!).map(Number);
      const oldest = Math.min(...years);
      const lowest = Math.min(...Object.values(table!));
      expect(table![oldest]).toBe(lowest);
      // and the years are contiguous, which is what catches a row read off the
      // wrong column anchor.
      expect(years).toHaveLength(Math.max(...years) - oldest + 1);
    }
  });

  it('sends four shared categories to a different table than Harris County does', () => {
    const pairs: [string, number | string, number | string][] = [
      ['furniture-fixtures', 9, 8],
      ['computer-mainframe', 4, 'mf'],
      ['telecom-8', 4, 'telecom8'],
      ['vehicles', 'veh', 6],
    ];
    for (const [key, collin, harris] of pairs) {
      expect(categoryFor(C, key)?.schedule).toBe(collin);
      expect(categoryFor(H, key)?.schedule).toBe(harris);
    }
  });

  it('offers every shared key, so a client that opens a Collin site stays classified', () => {
    const keys = new Set(categoriesFor(C).map((c) => c.key));
    for (const category of categoriesFor(H)) expect(keys.has(category.key)).toBe(true);
  });

  it('reads no SIC, because CCAD publishes business lines but no table to look one up in', () => {
    expect(Object.keys(C.sicProfiles)).toHaveLength(0);
    expect(categoryFor(C, 'machinery-equipment')?.sicDriven).toBeUndefined();
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
    expect(scheduleFor('tx-collin', 2026)).toBe(C);
    expect(scheduleFor('tx-dallas', 2026)).toBe(D);
  });
});
