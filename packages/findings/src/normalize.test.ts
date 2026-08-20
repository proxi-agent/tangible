import { describe, expect, it } from 'vitest';
import type { RegisterComparison } from '@tangible/filing';
import type { SavingsFinding, SavingsReport } from '@tangible/types';
import { fromRegisterComparison, fromSavingsReport } from './normalize.js';

function savingsFinding(overrides: Partial<SavingsFinding> = {}): SavingsFinding {
  return {
    key: 'non-taxable',
    title: 'Non-taxable property on the register',
    kind: 'modeled',
    valueRemoved: 40_000,
    originalCost: 96_000,
    assetCount: 12,
    summary: 'Software and licences that are not tangible personal property.',
    basis: 'Tax Code 1.04(5).',
    assumption: 'Assumes the client rendered them.',
    evidence: [],
    ...overrides,
  };
}

function savingsReport(overrides: Partial<SavingsReport> = {}): SavingsReport {
  return {
    engagementId: 'e1',
    clientName: 'Acme',
    taxYear: 2027,
    jurisdictionId: 'tx-harris',
    jurisdictionName: 'Harris',
    generatedAt: '2026-08-20T00:00:00.000Z',
    schedule: null,
    assessed: null,
    sic: null,
    farImpliedValue: 500_000,
    farOriginalCost: 900_000,
    findings: [savingsFinding()],
    totalValueRemoved: 40_000,
    exemption: { label: '', basis: '', amount: 0, applied: 0, caveat: '' },
    proposedTaxableValue: 460_000,
    blendedTaxRate: 0.025,
    proposedTax: 11_500,
    valueReduction: null,
    estimatedAnnualSaving: null,
    coverage: {
      assetCount: 100,
      valuedCount: 100,
      inFindingsCount: 0,
      needsReviewCount: 0,
      unclassifiedCount: 0,
      unvaluableCount: 0,
    },
    ...overrides,
  } as SavingsReport;
}

function comparison(overrides: Partial<RegisterComparison> = {}): RegisterComparison {
  return {
    taxYear: 2025,
    hasSchedule: true,
    scheduleJurisdiction: 'tx-harris',
    scheduleTaxYear: 2025,
    registerTotal: 1_000_000,
    comparedRegisterCost: 900_000,
    reportedTotal: 950_000,
    comparedReportedCost: 900_000,
    matchedCost: 800_000,
    reallocatedCost: 50_000,
    overReportedCost: 30_000,
    underReportedCost: 20_000,
    registerValue: 400_000,
    reportedValue: 430_000,
    valueDifference: 30_000,
    unpricedRegisterCost: 0,
    unpricedReportedCost: 0,
    categories: [],
    years: [],
    registerAside: [],
    reportedAside: [],
    coverage: {} as RegisterComparison['coverage'],
    findings: [],
    ...overrides,
  } as RegisterComparison;
}

describe('fromSavingsReport', () => {
  it('marks every savings finding as a saving, including screening ones', () => {
    const set = fromSavingsReport(
      savingsReport({
        findings: [
          savingsFinding({ key: 'ghost-assets', kind: 'measured' }),
          savingsFinding({ key: 'freeport', kind: 'screening', valueRemoved: null }),
        ],
      }),
    );

    expect(set.findings.map((f) => f.effect)).toEqual(['saving', 'saving']);
    expect(set.exposureCount).toBe(0);
    expect(set.savingCount).toBe(2);
  });

  it('carries a screening finding through with a null value rather than a zero', () => {
    const set = fromSavingsReport(
      savingsReport({ findings: [savingsFinding({ kind: 'screening', valueRemoved: null })] }),
    );

    expect(set.findings[0]?.value).toBeNull();
  });

  it("takes totalValue from the engine's own figure, not a re-sum of the rows", () => {
    // The report counts measured and modeled only. A re-sum here would agree by
    // accident today and diverge the first time that rule changed in one place.
    const set = fromSavingsReport(
      savingsReport({
        findings: [savingsFinding({ valueRemoved: 40_000 }), savingsFinding({ key: 'x', valueRemoved: 10_000 })],
        totalValueRemoved: 40_000,
      }),
    );

    expect(set.totalValue).toBe(40_000);
  });

  it('numbers findings in the order the report made them', () => {
    const set = fromSavingsReport(
      savingsReport({
        findings: [savingsFinding({ key: 'a' }), savingsFinding({ key: 'b' }), savingsFinding({ key: 'c' })],
      }),
    );

    expect(set.findings.map((f) => [f.key, f.ordinal])).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });

  it('says why the headline is null when no account is linked', () => {
    const set = fromSavingsReport(savingsReport({ estimatedAnnualSaving: null }));

    expect(set.headline.value).toBeNull();
    expect(set.headline.caveat).toMatch(/no account is linked/i);
  });

  it('names unreviewed assets in the caveat when there is a figure', () => {
    const set = fromSavingsReport(
      savingsReport({
        estimatedAnnualSaving: 12_000,
        coverage: {
          assetCount: 100,
          valuedCount: 80,
          inFindingsCount: 0,
          needsReviewCount: 15,
          unclassifiedCount: 5,
          unvaluableCount: 0,
        },
      }),
    );

    expect(set.headline.value).toBe(12_000);
    expect(set.headline.caveat).toContain('20 assets');
  });

  it('reads as English when exactly one asset is unreviewed', () => {
    const set = fromSavingsReport(
      savingsReport({
        estimatedAnnualSaving: 12_000,
        coverage: {
          assetCount: 100,
          valuedCount: 99,
          inFindingsCount: 0,
          needsReviewCount: 1,
          unclassifiedCount: 0,
          unvaluableCount: 0,
        },
      }),
    );

    expect(set.headline.caveat).toContain('1 asset is still unreviewed');
    expect(set.headline.caveat).toContain('contributes nothing');
  });
});

describe('fromRegisterComparison', () => {
  const finding = (over: Partial<RegisterComparison['findings'][number]> = {}) =>
    ({
      key: 'over-reported',
      title: 'Over-reported',
      kind: 'measured',
      effect: 'saving',
      cost: 30_000,
      value: 12_000,
      summary: '',
      basis: '',
      assumption: null,
      cells: [],
      assets: [],
      ...over,
    }) as RegisterComparison['findings'][number];

  it('keeps the effect the engine assigned, exposure included', () => {
    const set = fromRegisterComparison(
      comparison({
        findings: [finding(), finding({ key: 'under-reported', effect: 'exposure', value: -8_000 })],
      }),
    );

    expect(set.findings.map((f) => f.effect)).toEqual(['saving', 'exposure']);
    expect(set.savingCount).toBe(1);
    expect(set.exposureCount).toBe(1);
  });

  it('totals value off the priced findings instead of nulling the column', () => {
    // One unpriceable finding taking $712,600 with it is a bug this codebase
    // has already shipped once. It does not get to happen at this layer too.
    const set = fromRegisterComparison(
      comparison({ findings: [finding({ value: 12_000 }), finding({ key: 'misscheduled', value: null })] }),
    );

    expect(set.totalValue).toBe(12_000);
  });

  it('nulls totalValue only when nothing at all could be priced', () => {
    const set = fromRegisterComparison(
      comparison({ findings: [finding({ value: null }), finding({ key: 'b', value: null })] }),
    );

    expect(set.totalValue).toBeNull();
  });

  it('labels the headline a floor when compared cost went unpriced', () => {
    const set = fromRegisterComparison(
      comparison({ unpricedRegisterCost: 3_850, unpricedReportedCost: 0 }),
    );

    expect(set.headline.caveat).toContain('$3,850');
    expect(set.headline.caveat).toMatch(/floor/i);
  });

  it('says so when no schedule priced anything', () => {
    const set = fromRegisterComparison(comparison({ hasSchedule: false, valueDifference: null }));

    expect(set.headline.value).toBeNull();
    expect(set.headline.caveat).toMatch(/no published schedule/i);
  });

  it('takes evidence from the register side and cells from the return side', () => {
    const set = fromRegisterComparison(
      comparison({
        findings: [
          finding({
            assets: [
              {
                assetId: 'a1',
                description: 'Forklift',
                acquisitionYear: 2019,
                originalCost: 30_000,
                scheduleValue: 12_000,
                categoryKey: 'machinery',
              },
            ],
          }),
        ],
      }),
    );

    expect(set.findings[0]?.assetCount).toBe(1);
    expect(set.findings[0]?.evidence[0]?.assetId).toBe('a1');
  });
});
