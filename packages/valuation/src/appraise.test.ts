import { describe, expect, it } from 'vitest';
import { appraise, lookupSicProfile, totalPortfolio } from './appraise.js';
import { HCAD_CATEGORIES, HCAD_CATEGORY_KEYS } from './categories.js';
import { TX_HARRIS_2026 as S } from './schedules/tx-harris-2026.js';
import { LIFE_CLASSES, SPECIAL_SCHEDULES } from './types.js';

const value = (input: Parameters<typeof appraise>[0]) => {
  const result = appraise(input, S);
  if (!result.ok) throw new Error(`expected an appraisal, got gap: ${result.gap.detail}`);
  return result.value;
};

describe('the published schedule', () => {
  // Spot values read straight off pages 3 and 4 of the guide. If a transcription
  // ever drifts, this is what catches it.
  it('matches the printed tables', () => {
    expect(S.indexFactors[2025]).toBe(1.0);
    expect(S.indexFactors[2021]).toBe(1.252);
    expect(S.indexFactors[1983]).toBe(3.129);

    expect(S.percentGood[8][2025]).toBe(90);
    expect(S.percentGood[8][2020]).toBe(33);
    expect(S.percentGood[10][2023]).toBe(76);
    expect(S.percentGood[3][2022]).toBe(13);

    expect(S.specialPercentGood.pc[2025]).toBe(78);
    expect(S.specialPercentGood.pc[2021]).toBe(10);
    expect(S.specialPercentGood.mf[2022]).toBe(40);
  });

  // The property every one of these tables must have: an asset never becomes a
  // larger share of its cost by getting older.
  it('never lets percent good rise as an asset ages', () => {
    for (const life of LIFE_CLASSES) {
      const years = Object.keys(S.percentGood[life])
        .map(Number)
        .sort((a, b) => b - a);
      for (let i = 1; i < years.length; i++) {
        expect(S.percentGood[life][years[i]!]!).toBeLessThanOrEqual(
          S.percentGood[life][years[i - 1]!]!,
        );
      }
    }
    for (const key of SPECIAL_SCHEDULES) {
      const years = Object.keys(S.specialPercentGood[key])
        .map(Number)
        .sort((a, b) => b - a);
      for (let i = 1; i < years.length; i++) {
        expect(S.specialPercentGood[key][years[i]!]!).toBeLessThanOrEqual(
          S.specialPercentGood[key][years[i - 1]!]!,
        );
      }
    }
  });

  // A longer-lived class holds value better at every age — the whole reason
  // misclassification costs money.
  it('holds value longer on longer lives', () => {
    for (const year of [2024, 2022, 2020]) {
      const published = LIFE_CLASSES.filter((l) => S.percentGood[l][year] !== undefined);
      for (let i = 1; i < published.length; i++) {
        expect(S.percentGood[published[i]!][year]!).toBeGreaterThanOrEqual(
          S.percentGood[published[i - 1]!][year]!,
        );
      }
    }
  });

  // The enum the AI answers with is spelled out separately so structured
  // outputs get a literal tuple. This is what keeps the two spellings honest.
  it('keeps the category key tuple in step with the category table', () => {
    expect([...HCAD_CATEGORY_KEYS]).toEqual(HCAD_CATEGORIES.map((c) => c.key));
  });

  it('has a rule for every category it lists', () => {
    for (const category of HCAD_CATEGORIES) {
      if (category.schedule === 'none') continue;
      const table =
        typeof category.schedule === 'number'
          ? S.percentGood[category.schedule]
          : S.specialPercentGood[category.schedule];
      expect(table, `no schedule for ${category.key}`).toBeDefined();
    }
  });
});

describe('appraise', () => {
  it('applies cost x index x percent good', () => {
    // A 2022 lathe on the 10-year machinery schedule: 1.066 index, 67% good.
    const lathe = value({
      originalCost: 100_000,
      acquisitionYear: 2022,
      categoryKey: 'machinery-equipment',
    });
    expect(lathe.indexFactor).toBe(1.066);
    expect(lathe.percentGood).toBe(67);
    expect(lathe.replacementCostNew).toBeCloseTo(106_600, 2);
    expect(lathe.marketValue).toBeCloseTo(71_422, 0);
  });

  it('does not index the schedules that are not indexed', () => {
    const pc = value({ originalCost: 20_000, acquisitionYear: 2023, categoryKey: 'computer-pc' });
    expect(pc.indexFactor).toBe(1);
    expect(pc.percentGood).toBe(35);
    expect(pc.marketValue).toBeCloseTo(7_000, 2);
  });

  // The single most valuable thing this engine does: price the difference
  // between two classifications of the same asset.
  it('prices a misclassification', () => {
    const asComputer = value({
      originalCost: 20_000,
      acquisitionYear: 2022,
      categoryKey: 'computer-pc',
    });
    const asMachinery = value({
      originalCost: 20_000,
      acquisitionYear: 2022,
      categoryKey: 'machinery-equipment',
    });
    expect(asComputer.marketValue).toBeCloseTo(2_600, 2);
    expect(asMachinery.marketValue).toBeCloseTo(14_284.4, 1);
    // Rendering computers as generic machinery multiplies their taxable value.
    expect(asMachinery.marketValue / asComputer.marketValue).toBeGreaterThan(5);
  });

  it('carries inventory at full cost without a year', () => {
    const inventory = value({
      originalCost: 250_000,
      acquisitionYear: Number.NaN,
      categoryKey: 'inventory',
    });
    expect(inventory.marketValue).toBe(250_000);
    expect(inventory.percentGood).toBe(100);
  });

  // An asset older than its schedule is fully depreciated in the district's own
  // model. Saying so is the ghost-asset and frozen-value finding.
  it('floors an asset older than its schedule and flags it', () => {
    const old = value({ originalCost: 50_000, acquisitionYear: 2005, categoryKey: 'computer-pc' });
    expect(old.percentGood).toBe(10);
    expect(old.atFloor).toBe(true);

    const current = value({
      originalCost: 50_000,
      acquisitionYear: 2024,
      categoryKey: 'computer-pc',
    });
    expect(current.atFloor).toBe(false);
  });

  it('reports what it cannot value instead of guessing', () => {
    const noYear = appraise(
      { originalCost: 1000, acquisitionYear: Number.NaN, categoryKey: 'furniture-fixtures' },
      S,
    );
    expect(noYear.ok).toBe(false);
    if (!noYear.ok) expect(noYear.gap.reason).toBe('no-year');

    const noCost = appraise(
      { originalCost: Number.NaN, acquisitionYear: 2022, categoryKey: 'furniture-fixtures' },
      S,
    );
    expect(noCost.ok).toBe(false);
    if (!noCost.ok) expect(noCost.gap.reason).toBe('no-cost');

    const unknown = appraise({ originalCost: 1000, acquisitionYear: 2022, categoryKey: 'nope' }, S);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.gap.reason).toBe('unknown-category');
  });

  it('honours a life-class override', () => {
    const base = value({
      originalCost: 10_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
    });
    const longer = value({
      originalCost: 10_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
      lifeClassOverride: 20,
    });
    expect(base.percentGood).toBe(49);
    expect(longer.percentGood).toBe(78);
    expect(longer.marketValue).toBeGreaterThan(base.marketValue);
  });
});

describe('the SIC tables', () => {
  it('carries every published life class and nothing else', () => {
    const lives = new Set(Object.values(S.sicProfiles).map((p) => p.machineryLife));
    for (const life of lives) expect(LIFE_CLASSES).toContain(life);
    // The 2026 guide lists 1,063 codes, read twice from two printings.
    expect(Object.keys(S.sicProfiles).length).toBe(1063);
  });

  // Spot values read straight off the guide's alphabetical listing.
  it('matches the printed rows', () => {
    expect(S.sicProfiles['5075']).toMatchObject({
      description: 'A/C & HEATING EQUIPMENT & SUPPLIES',
      machineryLife: 8,
    });
    expect(S.sicProfiles['3553']).toMatchObject({
      description: 'WOODWORKING MACHINERY',
      machineryLife: 15,
    });
    expect(S.sicProfiles['3585']).toMatchObject({ machineryLife: 10 });
    // An HCAD sub-code, which is where a naive four-digit parse would break.
    expect(S.sicProfiles['8049A']).toMatchObject({ machineryLife: 8 });
  });
});

describe('lookupSicProfile', () => {
  it('takes an exact code, including a sub-code', () => {
    expect(lookupSicProfile(S, '8049A')?.sic).toBe('8049A');
    expect(lookupSicProfile(S, '3553')?.sic).toBe('3553');
  });

  it('tolerates how a code actually gets typed', () => {
    expect(lookupSicProfile(S, ' 3553 ')?.sic).toBe('3553');
    expect(lookupSicProfile(S, '35-53')?.sic).toBe('3553');
    expect(lookupSicProfile(S, '8049a')?.sic).toBe('8049A');
  });

  // Never invent a life: a code with only lettered variants has several
  // possible answers, and picking one silently chooses a client's schedule.
  it('returns nothing rather than guessing', () => {
    expect(lookupSicProfile(S, '9999')).toBeNull();
    expect(lookupSicProfile(S, '')).toBeNull();
    expect(lookupSicProfile(S, 'nonsense')).toBeNull();
  });
});

describe('the life the SIC decides', () => {
  // The reason this table is worth extracting at all.
  it('prices the same machine differently by line of business', () => {
    const input = {
      originalCost: 100_000,
      acquisitionYear: 2022,
      categoryKey: 'machinery-equipment',
    };
    // 3553 woodworking machinery is a 15-year life; 5075 A/C supply is 8.
    const woodshop = value({ ...input, businessSic: '3553' });
    const supplier = value({ ...input, businessSic: '5075' });
    expect(woodshop.schedule).toBe(15);
    expect(supplier.schedule).toBe(8);
    expect(woodshop.marketValue).toBeGreaterThan(supplier.marketValue);
    expect(woodshop.lifeSource).toBe('sic');
    expect(woodshop.sicProfile).toMatchObject({ sic: '3553', defaultLife: 10 });
  });

  it('falls back to the category default and says so', () => {
    const noSic = value({
      originalCost: 100_000,
      acquisitionYear: 2022,
      categoryKey: 'machinery-equipment',
    });
    expect(noSic.schedule).toBe(10);
    expect(noSic.lifeSource).toBe('category');
    expect(noSic.sicProfile).toBeNull();

    const unknown = value({
      originalCost: 100_000,
      acquisitionYear: 2022,
      categoryKey: 'machinery-equipment',
      businessSic: '9999',
    });
    expect(unknown.lifeSource).toBe('category');
  });

  it('lets an explicit override beat the SIC', () => {
    // A reviewer who has decided this asset's life outranks a table keyed to
    // the business as a whole.
    const overridden = value({
      originalCost: 100_000,
      acquisitionYear: 2022,
      categoryKey: 'machinery-equipment',
      businessSic: '3553',
      lifeClassOverride: 5,
    });
    expect(overridden.schedule).toBe(5);
    expect(overridden.lifeSource).toBe('override');
  });

  it('leaves categories the SIC does not govern alone', () => {
    // Furniture is 8 years by the guide's page 1 whatever the business does.
    const desk = value({
      originalCost: 10_000,
      acquisitionYear: 2022,
      categoryKey: 'furniture-fixtures',
      businessSic: '3553',
    });
    expect(desk.schedule).toBe(8);
    expect(desk.lifeSource).toBe('category');

    const pc = value({
      originalCost: 10_000,
      acquisitionYear: 2022,
      categoryKey: 'computer-pc',
      businessSic: '3553',
    });
    expect(pc.schedule).toBe('pc');
  });
});

describe('totalPortfolio', () => {
  it('separates what was valued from what was not', () => {
    const inputs = [
      { originalCost: 100_000, acquisitionYear: 2022, categoryKey: 'machinery-equipment' },
      { originalCost: 20_000, acquisitionYear: 2023, categoryKey: 'computer-pc' },
      { originalCost: 8_000, acquisitionYear: 2005, categoryKey: 'computer-pc' },
      { originalCost: 5_000, acquisitionYear: Number.NaN, categoryKey: 'furniture-fixtures' },
    ];
    const totals = totalPortfolio(inputs.map((input) => ({ input, result: appraise(input, S) })));

    expect(totals.valued).toBe(3);
    expect(totals.gaps['no-year']).toBe(1);
    expect(totals.originalCost).toBe(128_000);
    expect(totals.flooredCount).toBe(1);
    expect(totals.flooredMarketValue).toBeCloseTo(800, 2);
    expect(totals.marketValue).toBeCloseTo(71_422 + 7_000 + 800, 0);
  });
});
