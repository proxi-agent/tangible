import { describe, expect, it } from 'vitest';
import { TX_HARRIS_2026 as S } from '@tangible/valuation';
import { analyzeSavings, type SavingsAsset, type SavingsInput } from './analyze.js';
import { exemptionFor, TX_EXEMPTION_2026 } from './exemptions.js';

let nextId = 0;
const asset = (over: Partial<SavingsAsset> = {}): SavingsAsset => ({
  id: `a${nextId++}`,
  description: 'Lathe',
  acquisitionYear: 2022,
  originalCost: 100_000,
  isDisposed: false,
  registerCategory: 'Machinery',
  categoryKey: 'machinery-equipment',
  lifeClassOverride: null,
  status: 'confirmed',
  ...over,
});

const run = (assets: SavingsAsset[], over: Partial<SavingsInput> = {}) =>
  analyzeSavings({
    engagementId: 'e1',
    clientName: 'Acme',
    taxYear: 2026,
    jurisdictionId: 'tx-harris',
    assets,
    schedule: S,
    assessed: null,
    businessSic: null,
    blendedTaxRate: 0.025,
    exemptionAmount: TX_EXEMPTION_2026,
    generatedAt: '2026-08-19T00:00:00.000Z',
    ...over,
  });

const find = (report: ReturnType<typeof run>, key: string) =>
  report.findings.find((f) => f.key === key);

describe('what reaches the corrected position', () => {
  it('counts only settled, in-service, taxable property', () => {
    const report = run([
      asset(),
      asset({ isDisposed: true }),
      asset({ categoryKey: 'excluded-intangible' }),
      asset({ status: 'needs-review' }),
      asset({ status: null, categoryKey: null }),
    ]);
    expect(report.coverage.valuedCount).toBe(1);
    expect(report.coverage.needsReviewCount).toBe(1);
    expect(report.coverage.unclassifiedCount).toBe(1);
    expect(report.farOriginalCost).toBe(100_000);
    // The disposed and non-taxable rows are settled and accounted for — in the
    // findings rather than the total. Counting them separately is what stops
    // the coverage line reading as though five assets went missing.
    expect(report.coverage.inFindingsCount).toBe(2);
    const { valuedCount, inFindingsCount, needsReviewCount, unclassifiedCount, unvaluableCount } =
      report.coverage;
    expect(
      valuedCount + inFindingsCount + needsReviewCount + unclassifiedCount + unvaluableCount,
    ).toBe(report.coverage.assetCount);
  });

  // The rule the whole report rests on: an unreviewed guess never becomes a
  // dollar figure in front of a client.
  it('never prices an asset still in the review queue', () => {
    const queued = run([asset({ status: 'needs-review', originalCost: 1_000_000 })]);
    expect(queued.farImpliedValue).toBe(0);
    expect(queued.findings).toHaveLength(0);
  });

  it('reports assets it cannot value rather than counting them as zero', () => {
    const report = run([asset({ acquisitionYear: null }), asset({ originalCost: null })]);
    expect(report.coverage.unvaluableCount).toBe(2);
    expect(report.coverage.valuedCount).toBe(0);
  });
});

describe('findings', () => {
  it('values a ghost asset on its own schedule, not a reference', () => {
    // A disposed lathe was a lathe. What it would carry if still rendered is a
    // computed number, which is why this finding is measured rather than modeled.
    const report = run([asset({ isDisposed: true })]);
    const ghost = find(report, 'ghost-assets')!;
    expect(ghost.kind).toBe('measured');
    expect(ghost.assumption).toBeNull();
    expect(ghost.originalCost).toBe(100_000);
    expect(ghost.valueRemoved).toBeCloseTo(71_422, 0);
  });

  it('labels the exclusion finding as modeled and says what it assumed', () => {
    const report = run([
      asset({ categoryKey: 'excluded-intangible', description: 'ERP implementation' }),
    ]);
    const excluded = find(report, 'non-taxable')!;
    expect(excluded.kind).toBe('modeled');
    // The reference schedule has to be stated, or the number cannot be argued with.
    expect(excluded.assumption).toContain('ten-year machinery');
    expect(excluded.valueRemoved).toBeGreaterThan(0);
  });

  it('leaves screening findings without a number', () => {
    const report = run([
      asset({ categoryKey: 'leasehold-improvements', description: 'Buildout' }),
      asset({ categoryKey: 'inventory', description: 'Raw stock', acquisitionYear: 2025 }),
      asset({ acquisitionYear: 1990, description: 'Old press' }),
    ]);
    for (const key of ['leasehold-double-tax', 'freeport', 'fully-depreciated']) {
      const finding = find(report, key)!;
      expect(finding, key).toBeDefined();
      expect(finding.kind).toBe('screening');
      // Inventing a number for an open question is the one dishonest thing
      // this report could do, so the type makes it impossible to forget.
      expect(finding.valueRemoved).toBeNull();
      expect(finding.originalCost).toBeGreaterThan(0);
    }
  });

  it('keeps questions out of the savings total', () => {
    const report = run([
      asset({ isDisposed: true, originalCost: 50_000 }),
      asset({ categoryKey: 'leasehold-improvements', originalCost: 400_000 }),
    ]);
    const ghost = find(report, 'ghost-assets')!;
    expect(report.totalValueRemoved).toBeCloseTo(ghost.valueRemoved!, 6);
  });

  it('carries evidence for every finding, biggest first', () => {
    const report = run([
      asset({ isDisposed: true, originalCost: 10_000, description: 'Small' }),
      asset({ isDisposed: true, originalCost: 90_000, description: 'Large' }),
    ]);
    const ghost = find(report, 'ghost-assets')!;
    expect(ghost.evidence.map((e) => e.description)).toEqual(['Large', 'Small']);
  });

  it('says nothing it has no evidence for', () => {
    expect(run([asset()]).findings).toHaveLength(0);
  });
});

describe('duplicate capitalization', () => {
  it('asks about identical valued lines and never prices the question', () => {
    const report = run([
      asset({ description: 'CNC lathe HAAS ST-20', originalCost: 185_000 }),
      asset({ description: 'CNC lathe HAAS ST-20', originalCost: 185_000 }),
      asset({ description: 'Forklift', originalCost: 30_000 }),
    ]);
    const finding = find(report, 'duplicate-capitalization')!;
    expect(finding).toBeDefined();
    expect(finding.kind).toBe('screening');
    expect(finding.valueRemoved).toBeNull();
    expect(finding.assetCount).toBe(2);
    // The scale is every line involved; the excess past one copy per group is
    // stated in the summary, not invented as a saving.
    expect(finding.originalCost).toBe(370_000);
    expect(finding.summary).toContain('$185,000');
    expect(report.totalValueRemoved).toBe(0);
    // Both copies still stand in the corrected position until somebody answers.
    expect(report.farOriginalCost).toBe(400_000);
  });

  it('folds case, whitespace and punctuation the way the asset graph does', () => {
    const report = run([
      asset({ description: 'CNC Lathe — HAAS ST-20' }),
      asset({ description: 'cnc lathe  haas st 20' }),
    ]);
    expect(find(report, 'duplicate-capitalization')).toBeDefined();
  });

  it('treats a different cost or year as a different asset', () => {
    const report = run([
      asset({ originalCost: 100_000 }),
      asset({ originalCost: 100_000.5 }),
      asset({ originalCost: 90_000, acquisitionYear: 2021 }),
    ]);
    expect(find(report, 'duplicate-capitalization')).toBeUndefined();
  });

  it('ignores duplicates already leaving the rendition for their own reason', () => {
    // Disposed and excluded rows are ghost/non-taxable findings; flagging them
    // again as duplicates would double-count the same dollars as two questions.
    const report = run([
      asset({ isDisposed: true }),
      asset({ isDisposed: true }),
      asset({ categoryKey: 'excluded-intangible' }),
      asset({ categoryKey: 'excluded-intangible' }),
    ]);
    expect(find(report, 'duplicate-capitalization')).toBeUndefined();
  });

  it('counts the group in the leakage leads', () => {
    const report = run([asset(), asset()]);
    expect(find(report, 'duplicate-capitalization')).toBeDefined();
    expect(report.leakage.leadCount).toBe(1);
    expect(report.leakage.leadCost).toBe(200_000);
  });
});

describe('the bottom line', () => {
  it('applies the exemption and prices the corrected position', () => {
    const report = run([asset({ originalCost: 1_000_000 })]);
    expect(report.farImpliedValue).toBeCloseTo(714_220, 0);
    expect(report.exemption.applied).toBe(TX_EXEMPTION_2026);
    expect(report.proposedTaxableValue).toBeCloseTo(714_220 - 125_000, 0);
    expect(report.proposedTax).toBeCloseTo((714_220 - 125_000) * 0.025, 0);
  });

  it('never exempts more value than exists', () => {
    const report = run([asset({ originalCost: 10_000 })]);
    expect(report.exemption.applied).toBe(report.farImpliedValue);
    expect(report.proposedTaxableValue).toBe(0);
    expect(report.proposedTax).toBe(0);
  });

  // Without the roll there is no "before", so there is no saving to claim.
  it('claims no saving until an account is linked', () => {
    const report = run([asset()]);
    expect(report.valueReduction).toBeNull();
    expect(report.estimatedAnnualSaving).toBeNull();
  });

  it('measures the reduction against the assessed value once it is', () => {
    const report = run([asset({ originalCost: 1_000_000 })], {
      assessed: {
        accountId: '1234567',
        taxYear: 2026,
        appraisedValue: 900_000,
        assessedValue: 900_000,
        renditionFiled: true,
        ownerName: 'Acme',
      },
    });
    expect(report.valueReduction).toBeCloseTo(900_000 - report.proposedTaxableValue, 6);
    expect(report.estimatedAnnualSaving).toBeCloseTo(report.valueReduction! * 0.025, 6);
  });

  it('degrades to a coverage report when no schedule is published', () => {
    const report = run([asset()], { schedule: null, jurisdictionId: 'tx-nowhere' });
    expect(report.schedule).toBeNull();
    expect(report.farImpliedValue).toBe(0);
    expect(report.coverage.unvaluableCount).toBe(1);
  });
});

describe('exemptionFor', () => {
  it('tracks the year the raise took effect', () => {
    expect(exemptionFor('tx-harris', 2026)).toBe(TX_EXEMPTION_2026);
    expect(exemptionFor('tx-harris', 2025)).toBe(2_500);
  });

  it('assumes nothing for a jurisdiction it has not looked up', () => {
    expect(exemptionFor('fl-miami-dade', 2026)).toBe(0);
    expect(exemptionFor(null, 2026)).toBe(0);
  });
});
