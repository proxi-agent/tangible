import { describe, expect, it } from 'vitest';
import { appraise } from './appraise.js';
import { project } from './projection.js';
import { TX_HARRIS_2026 as S } from './schedules/tx-harris-2026.js';

const RATE = 0.025;

const projected = (input: Parameters<typeof project>[0]) => {
  const result = project(input, S, RATE);
  if (!result.ok) throw new Error(`expected a projection, got gap: ${result.gap.detail}`);
  return result.value;
};

const purchase = {
  originalCost: 100_000,
  acquisitionYear: 2026,
  categoryKey: 'furniture-fixtures',
};

describe('projecting a purchase', () => {
  // The whole point of reading the table by age: year one of the projection has
  // to be exactly what the district would assess an asset of age one.
  it('reads the published table at each age', () => {
    const stream = projected(purchase);
    const ageOne = appraise({ ...purchase, acquisitionYear: S.taxYear - 1 }, S);
    if (!ageOne.ok) throw new Error('expected an appraisal');
    expect(stream.years[0]!.marketValue).toBe(ageOne.value.marketValue);
    expect(stream.first.percentGood).toBe(ageOne.value.percentGood);
  });

  // January 1 is the whole rule. A purchase in 2026 is first assessed in 2027,
  // and the stream is calendar years from there.
  it('starts the January after the purchase', () => {
    const stream = projected(purchase);
    expect(stream.firstTaxYear).toBe(2027);
    expect(stream.years.map((y) => y.taxYear).slice(0, 3)).toEqual([2027, 2028, 2029]);
    expect(stream.years[0]!.age).toBe(1);
  });

  it('stops at the floor rather than repeating it', () => {
    const stream = projected(purchase);
    const last = stream.years[stream.years.length - 1]!;
    expect(last.atFloor).toBe(true);
    expect(stream.years.filter((y) => y.atFloor)).toHaveLength(1);
    expect(stream.truncated).toBe(false);
  });

  it('adds the stream up and prices a thousand dollars of it', () => {
    const stream = projected(purchase);
    const summed = stream.years.reduce((total, year) => total + year.tax, 0);
    expect(stream.lifetimeTax).toBeCloseTo(summed, 6);
    expect(stream.firstYearTax).toBe(stream.years[0]!.tax);
    // Per thousand is the same ratio at any cost, which is what makes it usable
    // for a split nobody has the amounts for yet.
    const bigger = projected({ ...purchase, originalCost: 750_000 });
    expect(bigger.perThousand).toBeCloseTo(stream.perThousand, 6);
  });

  // The lever the advisor is built to price: a shorter life is a smaller stream,
  // every year of it.
  it('makes a shorter life cheaper at every age', () => {
    const short = projected({ ...purchase, lifeClassOverride: 5 });
    const long = projected({ ...purchase, lifeClassOverride: 15 });
    expect(short.lifetimeTax).toBeLessThan(long.lifetimeTax);
    for (let i = 0; i < short.years.length; i++) {
      expect(short.years[i]!.marketValue).toBeLessThanOrEqual(long.years[i]!.marketValue);
    }
  });

  // Inventory is rendered at cost in Texas and never depreciates, so a
  // projection of it would otherwise run to the horizon printing one number.
  it('does not run a non-depreciating class out to the horizon', () => {
    const stream = projected({ ...purchase, categoryKey: 'inventory' });
    expect(stream.years).toHaveLength(1);
    expect(stream.truncated).toBe(false);
  });

  it('reports the gap rather than a stream when the asset cannot be valued', () => {
    const result = project({ ...purchase, categoryKey: 'not-a-category' }, S, RATE);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.gap.reason).toBe('unknown-category');
  });
});
