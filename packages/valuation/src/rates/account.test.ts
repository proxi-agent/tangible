import { describe, expect, it } from 'vitest';
import {
  accountRate,
  blendAccountRates,
  taxForAccount,
  type AccountRate,
  type UnitPlacement,
} from './account.js';
import { rateTableFor, ratedJurisdictions } from './registry.js';
import { TX_HARRIS_RATES_2025 } from './tx-harris-2025.js';

/**
 * Every case here is a real 2025 Harris County account, taken from the roll
 * with its own units and their adopted rates. Synthetic cases would prove the
 * arithmetic and nothing else; these also pin the table the arithmetic reads,
 * so a mis-generated rate shows up as a failing account rather than as a number
 * nobody has a reference for.
 */

/** Account 0003019 — Houston ISD and the City of Houston. The roll's median. */
const HOUSTON_MEDIAN: UnitPlacement[] = [
  { unitCode: '001', share: 1 }, // HOUSTON ISD           0.878300
  { unitCode: '040', share: 1 }, // HARRIS COUNTY         0.380960
  { unitCode: '041', share: 1 }, // HARRIS CO FLOOD CNTRL 0.049660
  { unitCode: '042', share: 1 }, // PORT OF HOUSTON AUTHY 0.005900
  { unitCode: '043', share: 1 }, // HARRIS CO HOSP DIST   0.187610
  { unitCode: '044', share: 1 }, // HARRIS CO EDUC DEPT   0.004798
  { unitCode: '048', share: 1 }, // HOUSTON CITY COLLEGE  0.098802
  { unitCode: '061', share: 1 }, // CITY OF HOUSTON       0.519190
];

/**
 * Account 0044891 — a Deer Park business whose value straddles the Deer Park /
 * Pasadena city line: 23,360 in one city, 21,563 in the other, 44,923 in every
 * unit that covers both. This is the case the obvious formula gets wrong.
 */
const STRADDLES_A_CITY_LINE: UnitPlacement[] = [
  { unitCode: '002', share: 1 }, // DEER PARK ISD         1.138900
  { unitCode: '040', share: 1 }, // HARRIS COUNTY         0.380960
  { unitCode: '041', share: 1 }, // HARRIS CO FLOOD CNTRL 0.049660
  { unitCode: '042', share: 1 }, // PORT OF HOUSTON AUTHY 0.005900
  { unitCode: '043', share: 1 }, // HARRIS CO HOSP DIST   0.187610
  { unitCode: '044', share: 1 }, // HARRIS CO EDUC DEPT   0.004798
  { unitCode: '047', share: 1 }, // SAN JACINTO COM COL D 0.154615
  { unitCode: '054', share: 23360 / 44923 }, // CITY OF DEER PARK     0.720000
  { unitCode: '074', share: 21563 / 44923 }, // CITY OF PASADENA      0.465586
];

/**
 * Not a real account. Account 2433701 used to be one here: every unit taxed
 * 288,040 of an account the business roll appraised at 24,320, which is the
 * unit file running a certification cycle behind the account file rather than
 * corrupt data. Normalizing the shares at load is what made that account
 * ordinary — all seven units tax all of it, which is true — so the contradiction
 * this guard exists for can no longer arrive from the warehouse, and what still
 * reaches it is a caller assembling placements by hand.
 */
const A_UNIT_TAXING_MORE_THAN_EXISTS: UnitPlacement[] = [
  { unitCode: '025', share: 1.4 }, // SPRING BRANCH ISD
  { unitCode: '040', share: 1 },
];

function harris(placements: UnitPlacement[], taxYear = 2025) {
  return accountRate({ jurisdictionId: 'tx-harris', taxYear, placements });
}

describe('the 2025 Harris rate table', () => {
  it('holds every unit on the roll, including the ones that levy nothing', () => {
    const units = Object.values(TX_HARRIS_RATES_2025.units);
    expect(units).toHaveLength(1072);
    // 437 units levied nothing in 2025. Dropping them would turn a unit that
    // correctly taxes nothing into a unit whose rate is missing.
    expect(units.filter((unit) => unit.ratePer100 === 0)).toHaveLength(437);
    expect(TX_HARRIS_RATES_2025.units['040']).toEqual({
      code: '040',
      name: 'HARRIS COUNTY',
      ratePer100: 0.38096,
    });
  });

  it('offers only the years whose rates are adopted', () => {
    expect(ratedJurisdictions()).toEqual([
      { id: 'tx-harris', name: 'Harris County, TX', taxYears: [2025] },
    ]);
    expect(rateTableFor('tx-harris', 2026)?.status).toBe('awaiting-adoption');
    expect(rateTableFor('tx-dallas', 2025)).toBeUndefined();
  });
});

describe('accountRate', () => {
  it('prices the median Harris account below the 2.5% constant it replaces', () => {
    const result = harris(HOUSTON_MEDIAN);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rate.percentOfValue).toBeCloseTo(2.12522, 5);
    expect(result.rate.basis).toEqual({ assessmentRatio: 1, millage: result.rate.basis.millage });
    expect(result.rate.basis.millage).toBeCloseTo(0.0212522, 7);
    // The whole point of the item: the constant is high, and high overstates
    // what the client overpaid.
    expect(result.rate.percentOfValue).toBeLessThan(2.5);
  });

  it('collapses to the sum of the rates when every unit taxes the whole account', () => {
    const result = harris(HOUSTON_MEDIAN);
    if (!result.ok) throw new Error(result.reason);
    const summed = result.rate.units.reduce((sum, unit) => sum + unit.ratePer100, 0);
    expect(result.rate.percentOfValue).toBeCloseTo(summed, 9);
    expect(result.rate.units.every((unit) => unit.share === 1)).toBe(true);
  });

  it('weights by value where the account straddles a city line, rather than summing', () => {
    const result = harris(STRADDLES_A_CITY_LINE);
    if (!result.ok) throw new Error(result.reason);
    const summed = result.rate.units.reduce((sum, unit) => sum + unit.ratePer100, 0);
    expect(summed).toBeCloseTo(3.108029, 6);
    expect(result.rate.percentOfValue).toBeCloseTo(2.5203245, 6);
    // Summing would price this account 23% high. Both cities are in the list;
    // neither taxes the whole account.
    expect(summed / result.rate.percentOfValue).toBeGreaterThan(1.23);
    const deerPark = result.rate.units.find((unit) => unit.code === '054');
    expect(deerPark?.share).toBeCloseTo(23360 / 44923, 12);
  });

  it('refuses an account whose units tax more than the account is worth', () => {
    const result = harris(A_UNIT_TAXING_MORE_THAN_EXISTS);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('SPRING BRANCH ISD');
    expect(result.reason).toContain('cannot tax more of it than there is');
  });

  it('refuses an account no unit taxes any of, rather than pricing it at zero', () => {
    const result = harris(HOUSTON_MEDIAN.map((placement) => ({ ...placement, share: 0 })));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('taxing none of this account');
  });

  it('refuses a year whose rates are not adopted instead of using last year’s', () => {
    const result = harris(HOUSTON_MEDIAN, 2026);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('is adopted yet');
    expect(result.provenance?.ruleId).toBe('rates:tx-harris:2026');
  });

  it('refuses a jurisdiction with no table and an empty unit list', () => {
    expect(
      accountRate({ jurisdictionId: 'tx-dallas', taxYear: 2025, placements: HOUSTON_MEDIAN }).ok,
    ).toBe(false);
    expect(harris([]).ok).toBe(false);
  });

  it('refuses rather than dropping a unit it has no rate for', () => {
    const result = harris([...HOUSTON_MEDIAN, { unitCode: 'ZZZ', share: 1 }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('ZZZ');
  });
});

describe('blendAccountRates', () => {
  const rateFor = (placements: UnitPlacement[]): AccountRate => {
    const result = harris(placements);
    if (!result.ok) throw new Error(result.reason);
    return result.rate;
  };
  const houston = rateFor(HOUSTON_MEDIAN);
  const deerPark = rateFor(STRADDLES_A_CITY_LINE);

  it('returns the account itself for a list of one, units and all', () => {
    expect(blendAccountRates([{ rate: houston, weight: 900_000 }])).toBe(houston);
    expect(blendAccountRates([])).toBeNull();
  });

  it('lands between the two accounts, at the weighted mean of their millages', () => {
    const blended = blendAccountRates([
      { rate: houston, weight: 750_000 },
      { rate: deerPark, weight: 250_000 },
    ]);
    if (!blended) throw new Error('expected a blend');
    const expected = 0.75 * houston.basis.millage + 0.25 * deerPark.basis.millage;
    expect(blended.basis.millage).toBeCloseTo(expected, 12);
    expect(blended.percentOfValue).toBeCloseTo(expected * 100, 10);
    expect(blended.basis.millage).toBeGreaterThan(houston.basis.millage);
    expect(blended.basis.millage).toBeLessThan(deerPark.basis.millage);
  });

  it('keeps every unit, at the share of the engagement each one taxes', () => {
    const blended = blendAccountRates([
      { rate: houston, weight: 750_000 },
      { rate: deerPark, weight: 250_000 },
    ]);
    if (!blended) throw new Error('expected a blend');
    // Harris County taxes both accounts whole; Houston ISD taxes only the
    // three-quarters that is the Houston account.
    expect(blended.units.find((unit) => unit.code === '040')?.share).toBeCloseTo(1, 12);
    expect(blended.units.find((unit) => unit.code === '001')?.share).toBeCloseTo(0.75, 12);
    expect(blended.units.find((unit) => unit.code === '002')?.share).toBeCloseTo(0.25, 12);
    // Deer Park's city line survives the blend, scaled by the account's weight.
    expect(blended.units.find((unit) => unit.code === '054')?.share).toBeCloseTo(
      0.25 * (23360 / 44923),
      12,
    );
    expect(blended.units.map((unit) => unit.code)).toEqual([
      '001',
      '002',
      '040',
      '041',
      '042',
      '043',
      '044',
      '047',
      '048',
      '054',
      '061',
      '074',
    ]);
  });

  it('weights the accounts equally when the district has them all at zero', () => {
    const blended = blendAccountRates([
      { rate: houston, weight: 0 },
      { rate: deerPark, weight: 0 },
    ]);
    if (!blended) throw new Error('expected a blend');
    expect(blended.basis.millage).toBeCloseTo(
      (houston.basis.millage + deerPark.basis.millage) / 2,
      12,
    );
  });

  it('leaves the blend with something for a per-unit exemption to apply against', () => {
    /**
     * The reason the units are merged rather than dropped. Two 400,000 sites
     * claim the exemption in each of their own units; a blend that emptied its
     * unit list would price them as one.
     */
    const blended = blendAccountRates([
      { rate: houston, weight: 400_000 },
      { rate: houston, weight: 400_000 },
    ]);
    if (!blended) throw new Error('expected a blend');
    const grants = Object.fromEntries(blended.units.map((unit) => [unit.code, 2]));
    const together = taxForAccount({
      rate: blended,
      marketValue: 800_000,
      exemptionPerUnit: 125_000,
      grants,
    });
    const apart = taxForAccount({ rate: houston, marketValue: 400_000, exemptionPerUnit: 125_000 });
    expect(together.tax).toBeCloseTo(apart.tax * 2, 6);
  });
});

describe('taxForAccount', () => {
  const rate = (() => {
    const result = harris(HOUSTON_MEDIAN);
    if (!result.ok) throw new Error(result.reason);
    return result.rate;
  })();

  it('agrees with a single subtraction against the blended rate, for one location', () => {
    /**
     * Worth pinning because it is the surprise: where every unit taxes the
     * whole account, the per-unit exemption and the blended-rate subtraction
     * are the same number. Each unit's taxable value is (V − 125,000), so the
     * tax is (V − 125,000) × Σ rates either way.
     */
    const marketValue = 400_000;
    const perUnit = taxForAccount({ rate, marketValue, exemptionPerUnit: 125_000 });
    const blended = (marketValue - 125_000) * rate.basis.millage;
    expect(perUnit.tax).toBeCloseTo(blended, 9);
  });

  it('caps each unit’s exemption at what that unit taxes', () => {
    // A 20,602 account under a 125,000 exemption owes nothing anywhere, and the
    // exempt value is what the units actually taxed — not eight times 125,000.
    const result = taxForAccount({ rate, marketValue: 20_602, exemptionPerUnit: 125_000 });
    expect(result.tax).toBe(0);
    expect(result.exemptValue).toBeCloseTo(20_602 * 8, 6);
  });

  it('grants the exemption once per location in a unit, per 11.145(c)', () => {
    const marketValue = 600_000;
    const one = taxForAccount({ rate, marketValue, exemptionPerUnit: 125_000 });
    const four = taxForAccount({
      rate,
      marketValue,
      exemptionPerUnit: 125_000,
      grants: { '001': 4 },
    });
    // Four sites inside Houston ISD claim it four times there and once in every
    // other unit. Only the ISD line moves.
    expect(four.tax).toBeLessThan(one.tax);
    const isd = four.byUnit.find((unit) => unit.code === '001');
    expect(isd?.exempt).toBe(500_000);
    for (const unit of four.byUnit) {
      if (unit.code === '001') continue;
      expect(unit.exempt).toBe(125_000);
    }
  });

  it('applies no exemption when the amount is zero', () => {
    const result = taxForAccount({ rate, marketValue: 400_000, exemptionPerUnit: 0 });
    expect(result.exemptValue).toBe(0);
    expect(result.tax).toBeCloseTo(400_000 * rate.basis.millage, 9);
  });
});
