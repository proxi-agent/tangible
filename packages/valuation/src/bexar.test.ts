import { describe, expect, it } from 'vitest';
import { appraise } from './appraise.js';
import { categoriesFor, categoryFor } from './categories.js';
import { scheduleFor } from './registry.js';
import { TX_BEXAR_2026 as B } from './schedules/tx-bexar-2026.js';
import { TX_HARRIS_2026 as H } from './schedules/tx-harris-2026.js';
import { TX_TARRANT_2026 as T } from './schedules/tx-tarrant-2026.js';
import { LIFE_CLASSES, type DepreciationSchedule, type LifeClass } from './types.js';

/**
 * The sixth jurisdiction, and the first added without widening a type — which
 * was not obvious from the document, because BCAD heads its nine columns 0410,
 * 0520, 0620, 0820, 1020, 1220, 1520, 2020 and 3020 and never says in words
 * what those are.
 *
 * They are life and residual. The whole transcription rests on that reading, so
 * this file tests it twice, from the two halves independently, and the two
 * halves are not the same evidence. Every column bottoms out at exactly the
 * figure its last two digits name. And every column stops at exactly the year
 * its first two digits name, one past the life. Nine columns, two properties,
 * eighteen agreements, none of them arranged by the transcriber.
 */
describe('Bexar', () => {
  /** BCAD's own column headings, split into what each pair of digits says. */
  const COLUMN_CODES: ReadonlyArray<{ code: string; life: LifeClass; residual: number }> = [
    { code: '0410', life: 4, residual: 10 },
    { code: '0520', life: 5, residual: 20 },
    { code: '0620', life: 6, residual: 20 },
    { code: '0820', life: 8, residual: 20 },
    { code: '1020', life: 10, residual: 20 },
    { code: '1220', life: 12, residual: 20 },
    { code: '1520', life: 15, residual: 20 },
    { code: '2020', life: 20, residual: 20 },
    { code: '3020', life: 30, residual: 20 },
  ];

  const column = (life: LifeClass) => {
    const table = B.percentGood[life];
    if (!table) throw new Error(`Bexar publishes no ${life}-year column`);
    return Object.entries(table)
      .map(([year, pct]) => ({ year: Number(year), pct }))
      .sort((a, b) => b.year - a.year);
  };

  const value = (input: Parameters<typeof appraise>[0], schedule: DepreciationSchedule = B) => {
    const result = appraise(input, schedule);
    if (!result.ok) throw new Error(`expected an appraisal, got gap: ${result.gap.detail}`);
    return result.value;
  };

  it('matches the printed table', () => {
    expect(B.percentGood[8]![2019]).toBe(33);
    expect(B.percentGood[4]![2024]).toBe(56);
    expect(B.percentGood[10]![2020]).toBe(55);
    expect(B.percentGood[20]![2021]).toBe(88);
    expect(B.percentGood[30]![1995]).toBe(20);
  });

  it('publishes exactly the nine columns BCAD prints, and no others', () => {
    const published = LIFE_CLASSES.filter((life) => B.percentGood[life] !== undefined);
    expect(published).toEqual(COLUMN_CODES.map((c) => c.life));
    // The three the union carries for other districts and Bexar does not print.
    expect(B.percentGood[3]).toBeUndefined();
    expect(B.percentGood[7]).toBeUndefined();
    expect(B.percentGood[9]).toBeUndefined();
    expect(B.percentGood[18]).toBeUndefined();
    expect(B.percentGood[25]).toBeUndefined();
  });

  it('bottoms out at exactly the residual each column heading names', () => {
    for (const { code, life, residual } of COLUMN_CODES) {
      const rows = column(life);
      const lowest = rows[rows.length - 1]!;
      expect(`${code}:${lowest.pct}`).toBe(`${code}:${residual}`);
      // And nothing above the bottom has already reached it, so the residual is
      // where the column ends rather than somewhere it passes through.
      for (const row of rows.slice(0, -1)) expect(row.pct).toBeGreaterThan(residual);
    }
  });

  it('stops at exactly the age each column heading names, one year past the life', () => {
    // The other half of the code, and independent of the residual: a column
    // headed with a life of L publishes years acquired back to L+1 years before
    // the tax year, and no further. Nine columns agree. A reading of these
    // headings as anything but a life would have to explain that.
    for (const { code, life } of COLUMN_CODES) {
      const rows = column(life);
      expect(`${code}:${rows[0]!.year}`).toBe(`${code}:${B.taxYear - 1}`);
      expect(`${code}:${rows[rows.length - 1]!.year}`).toBe(`${code}:${B.taxYear - life - 1}`);
    }
  });

  it('publishes contiguous years in every column', () => {
    for (const { code, life } of COLUMN_CODES) {
      const rows = column(life);
      for (let i = 1; i < rows.length; i += 1) {
        expect(`${code}:${rows[i]!.year}`).toBe(`${code}:${rows[i - 1]!.year - 1}`);
      }
    }
  });

  it('falls with age and never exceeds 100, though it has already been trended', () => {
    // Dallas and Collin also set `costIndexIncluded` and do neither, because
    // they publish the raw product of an index and a percent good. Bexar
    // publishes a conclusion — Marshall & Swift trends "calibrated based on
    // local appraisal experience" — so the trending is inside the figure
    // without the figure behaving like an unbounded product. The flag means
    // "already trended"; it does not mean "expect nonsense".
    expect(B.costIndexIncluded).toBe(true);
    for (const { code, life } of COLUMN_CODES) {
      const rows = column(life);
      for (const row of rows) expect(`${code}:${row.pct <= 100}`).toBe(`${code}:true`);
      for (let i = 1; i < rows.length; i += 1) {
        expect(`${code}:${rows[i]!.pct <= rows[i - 1]!.pct}`).toBe(`${code}:true`);
      }
    }
  });

  it('never trends again, whatever a category rule claims', () => {
    // Tarrant relies on all twelve rules saying `indexed: false`, and a rule
    // flipped by hand there would gap. Here the flag is authoritative, so the
    // same mistake is absorbed rather than caught — asserted so that the
    // difference between the two protections is on the record.
    const miswired: DepreciationSchedule = {
      ...B,
      indexFactors: { 2022: 1.2 },
      categories: {
        ...B.categories,
        'furniture-fixtures': { ...B.categories!['furniture-fixtures']!, indexed: true },
      },
    };
    const straight = value({
      originalCost: 10_000,
      acquisitionYear: 2022,
      categoryKey: 'furniture-fixtures',
    });
    const bent = value(
      { originalCost: 10_000, acquisitionYear: 2022, categoryKey: 'furniture-fixtures' },
      miswired,
    );
    expect(straight.indexFactor).toBe(1);
    expect(bent.indexFactor).toBe(1);
    expect(bent.marketValue).toBe(straight.marketValue);
    // And the real schedule has nothing to trend with in the first place.
    expect(Object.keys(B.indexFactors)).toHaveLength(0);
  });

  it('holds at the residual for an asset older than its column', () => {
    const floored = value({
      originalCost: 9_000,
      acquisitionYear: 2015,
      categoryKey: 'computer-pc',
    });
    expect(floored.percentGood).toBe(10);
    expect(floored.atFloor).toBe(true);
    // Ten, not twenty: computers are the one column BCAD gives a lower residual
    // to, and reading every code's last pair as "20" would lose exactly this.
    const other = value({
      originalCost: 9_000,
      acquisitionYear: 1990,
      categoryKey: 'office-equipment',
    });
    expect(other.percentGood).toBe(20);
    expect(other.atFloor).toBe(true);
  });

  it('reaches no special schedule column, because it publishes none', () => {
    for (const table of Object.values(B.specialPercentGood)) {
      expect(Object.keys(table)).toHaveLength(0);
    }
    for (const category of categoriesFor(B)) {
      expect(typeof category.schedule === 'number' || category.schedule === 'none').toBe(true);
    }
    // Tarrant does the same; Harris, Dallas and Collin all point at least one
    // category at a column keyed by equipment rather than by years.
    expect(
      categoriesFor(T).every((c) => typeof c.schedule === 'number' || c.schedule === 'none'),
    ).toBe(true);
    expect(
      categoriesFor(H).some((c) => typeof c.schedule === 'string' && c.schedule !== 'none'),
    ).toBe(true);
  });

  it('reads no SIC, and says so by not asking for one', () => {
    expect(Object.keys(B.sicProfiles)).toHaveLength(0);
    for (const category of categoriesFor(B)) expect(category.sicDriven).toBeUndefined();
    const input = {
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
    };
    expect(value({ ...input, businessSic: '3599' }).marketValue).toBe(value(input).marketValue);
    expect(value({ ...input, businessSic: '3599' }).lifeSource).toBe('category');
  });

  it('publishes an answer for solar that most districts leave to a default', () => {
    // The 2020 column names "Solar Panel Equipment" outright. Harris is the
    // only other district here with a published answer, and it is a different
    // one — ten years on an un-indexed column of its own.
    expect(B.categories!['solar']!.schedule).toBe(20);
    expect(categoryFor(H, 'solar')!.schedule).toBe(10);
    expect(
      value({ originalCost: 400_000, acquisitionYear: 2021, categoryKey: 'solar' }).marketValue,
    ).toBe(352_000);
  });

  it('answers seven shared keys differently from Harris County', () => {
    const differs = categoriesFor(B).filter(
      (rule) => categoryFor(H, rule.key)?.schedule !== rule.schedule,
    );
    expect(differs.map((r) => r.key).sort()).toEqual([
      'computer-mainframe',
      'computer-pc',
      'leasehold-improvements',
      'office-equipment',
      'solar',
      'specific-equipment',
      'telecom-8',
    ]);
  });

  it('offers every shared key', () => {
    expect(
      categoriesFor(B)
        .map((rule) => rule.key)
        .sort(),
    ).toEqual(
      categoriesFor(H)
        .map((rule) => rule.key)
        .sort(),
    );
  });

  it('keeps Texas counties on their own tables', () => {
    expect(scheduleFor('tx-bexar', 2026)?.jurisdictionId).toBe('tx-bexar');
    expect(scheduleFor('tx-harris', 2026)?.jurisdictionId).toBe('tx-harris');
    expect(scheduleFor('tx-fort-bend', 2026)).toBeUndefined();
  });
});
