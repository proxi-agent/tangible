import { describe, expect, it } from 'vitest';
import { accountRate, taxForAccount, TX_HARRIS_2026 as S, type AccountRate } from '@tangible/valuation';
import { analyzeSavings, type SavingsAsset, type SavingsInput } from './analyze.js';
import { exemptionFor, exemptionForSites, FL_EXEMPTION, TX_EXEMPTION_2026 } from './exemptions.js';

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
  it('prices near-identical lines rather than asking about them', () => {
    const report = run([
      asset({ description: 'CNC lathe HAAS ST-20', originalCost: 185_000 }),
      asset({ description: 'CNC lathe HAAS ST-20', originalCost: 185_000 }),
      asset({ description: 'Forklift', originalCost: 30_000 }),
    ]);
    const finding = find(report, 'duplicate-capitalization')!;
    expect(finding).toBeDefined();
    // Four things agreeing — wording, cost, timing, department — is a position,
    // not a question, which is the whole change here.
    expect(finding.kind).toBe('modeled');
    expect(finding.assetCount).toBe(2);
    // The scale is every line involved; the saving is the excess past one copy.
    expect(finding.originalCost).toBe(370_000);
    expect(finding.valueRemoved).toBeGreaterThan(0);
    expect(finding.valueRemoved).toBeCloseTo(finding.rows[1]!.valueRemoved!, 6);
    expect(report.totalValueRemoved).toBeCloseTo(finding.valueRemoved!, 6);
  });

  it('keeps one copy per group on the return', () => {
    const report = run([asset(), asset()]);
    const rows = find(report, 'duplicate-capitalization')!.rows;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.valueRemoved === 0)).toHaveLength(1);
    expect(rows[0]!.confidence.signals.some((s) => s.code === 'kept-copy')).toBe(true);
  });

  it('folds case, whitespace and punctuation the way the asset graph does', () => {
    const report = run([
      asset({ description: 'CNC Lathe — HAAS ST-20' }),
      asset({ description: 'cnc lathe  haas st 20' }),
    ]);
    expect(find(report, 'duplicate-capitalization')).toBeDefined();
  });

  it('matches a phase split across two invoices that no exact key would see', () => {
    // The case the old exact-match detector was blind to, and the reason the
    // finding is worth pricing: a project booked in two parts, three weeks and
    // $150 apart, in the same department.
    const report = run([
      asset({
        description: 'CONVEYOR SYSTEM',
        originalCost: 84_000,
        acquisitionDate: '2023-03-02',
        costCenter: 'PLANT 1',
      }),
      asset({
        description: 'CONVEYOR SYSTEM PHASE 2',
        originalCost: 84_150,
        acquisitionDate: '2023-03-23',
        costCenter: 'PLANT 1',
      }),
    ]);
    expect(find(report, 'duplicate-capitalization')).toBeDefined();
  });

  it('will not match across cost centres, or past the cost tolerance', () => {
    const separate = run([
      asset({ description: 'Laptop', originalCost: 2_400, costCenter: 'SALES' }),
      asset({ description: 'Laptop', originalCost: 2_400, costCenter: 'ENGINEERING' }),
    ]);
    expect(find(separate, 'duplicate-capitalization')).toBeUndefined();

    const apart = run([asset({ originalCost: 100_000 }), asset({ originalCost: 130_000 })]);
    expect(find(apart, 'duplicate-capitalization')).toBeUndefined();
  });

  it('will not match two different model numbers', () => {
    const report = run([
      asset({ description: 'PUMP MDX-400' }),
      asset({ description: 'PUMP MDX-700' }),
    ]);
    expect(find(report, 'duplicate-capitalization')).toBeUndefined();
  });

  it('ignores duplicates already leaving the rendition for their own reason', () => {
    // Disposed and excluded rows are ghost/non-taxable findings; flagging them
    // again as duplicates would double-count the same dollars twice.
    const report = run([
      asset({ isDisposed: true }),
      asset({ isDisposed: true }),
      asset({ categoryKey: 'excluded-intangible' }),
      asset({ categoryKey: 'excluded-intangible' }),
    ]);
    expect(find(report, 'duplicate-capitalization')).toBeUndefined();
  });

  it('counts the group in the jurisdiction rollup at the excess, not the whole', () => {
    const report = run([asset(), asset()]);
    const finding = find(report, 'duplicate-capitalization')!;
    const rollup = report.leakage.byJurisdiction[0]!;
    expect(rollup.modeledValue).toBeCloseTo(finding.valueRemoved!, 6);
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

  it('measures the reduction against the assessed value, net of the same exemption', () => {
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
    // The district grants the $125,000 whether or not the register is corrected,
    // so the "before" is $775,000 of taxable value, not $900,000 of appraised.
    expect(report.valueReduction).toBeCloseTo(
      900_000 - TX_EXEMPTION_2026 - report.proposedTaxableValue,
      6,
    );
    expect(report.estimatedAnnualSaving).toBeCloseTo(report.valueReduction! * 0.025, 6);
  });

  it('claims no saving from the exemption alone', () => {
    // Register and roll agree; the only thing between the two sides is the
    // exemption, which the district applies to both.
    const report = run([asset({ originalCost: 1_000_000 })], {
      assessed: {
        accountId: '1234567',
        taxYear: 2026,
        appraisedValue: 714_220,
        assessedValue: 714_220,
        renditionFiled: true,
        ownerName: 'Acme',
      },
    });
    expect(report.valueReduction).toBeCloseTo(0, 0);
    expect(report.estimatedAnnualSaving).toBeCloseTo(0, 0);
  });

  it('measures nothing below the threshold on either side', () => {
    const report = run([asset({ originalCost: 10_000 })], {
      assessed: {
        accountId: '1234567',
        taxYear: 2026,
        appraisedValue: 100_000,
        assessedValue: 100_000,
        renditionFiled: true,
        ownerName: 'Acme',
      },
    });
    expect(report.proposedTaxableValue).toBe(0);
    expect(report.valueReduction).toBe(0);
    expect(report.estimatedAnnualSaving).toBe(0);
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
    // Georgia is a real BPP state with a real exemption. Nobody here has read
    // it, and the honest answer to that is zero rather than a neighbour's.
    expect(exemptionFor('ga-fulton', 2026)).toBe(0);
    expect(exemptionFor(null, 2026)).toBe(0);
  });

  it('knows Florida, and knows a Florida return is per location', () => {
    expect(exemptionFor('fl-miami-dade', 2026)).toBe(FL_EXEMPTION);
    // Four sites in Florida is four returns and four exemptions; four sites in
    // Texas is still one exemption against the account.
    expect(exemptionForSites('fl-miami-dade', 2026, 4)).toBe(FL_EXEMPTION * 4);
    expect(exemptionForSites('tx-harris', 2026, 4)).toBe(TX_EXEMPTION_2026);
  });
});

describe('per-asset rows', () => {
  it('prices each row, and the rows add to the category', () => {
    const report = run([
      asset({ isDisposed: true, originalCost: 100_000, disposalDate: '2025-03-04' }),
      asset({ isDisposed: true, originalCost: 40_000, disposalDate: '2025-06-01' }),
    ]);
    const ghost = find(report, 'ghost-assets')!;
    expect(ghost.rows).toHaveLength(2);
    // Every row's own arithmetic: what it carries as filed, what it should
    // carry, the difference, and the difference priced.
    for (const row of ghost.rows) {
      expect(row.correctedValue).toBe(0);
      expect(row.valueRemoved).toBe(row.assessedAsFiled);
      expect(row.taxAtRisk).toBeCloseTo((row.valueRemoved ?? 0) * 0.025, 6);
      // Phase 3: the row is scored, not pending. Discounted by how sure we
      // are and how often a district agrees, so it is always below the raw
      // tax at risk and never zero for a row worth something.
      expect(row.expectedRecovery).toBeGreaterThan(0);
      expect(row.expectedRecovery!).toBeLessThan(row.taxAtRisk!);
    }
    // And the category total is the sum of them, not a parallel figure.
    const summed = ghost.rows.reduce((total, row) => total + (row.valueRemoved ?? 0), 0);
    expect(summed).toBeCloseTo(ghost.valueRemoved ?? 0, 6);
  });

  it('prints a sample that is literally the top of the population', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      asset({ isDisposed: true, originalCost: (i + 1) * 1_000, disposalDate: '2025-02-02' }),
    );
    const ghost = find(run(many), 'ghost-assets')!;
    expect(ghost.rows).toHaveLength(40);
    expect(ghost.evidence).toHaveLength(25);
    // Same objects, same order — the two cannot disagree.
    expect(ghost.evidence.map((e) => e.assetId)).toEqual(
      ghost.rows.slice(0, 25).map((r) => r.assetId),
    );
    expect(ghost.rows[0].originalCost).toBe(40_000);
  });

  it('carries the filters a client will reach for', () => {
    const report = run([
      asset({
        isDisposed: true,
        disposalDate: '2025-01-30',
        costCenter: 'Plant 2',
        locationId: 'loc-1',
        site: { label: 'Houston', jurisdictionId: 'tx-harris', jurisdictionName: 'Harris County' },
        serialNumber: 'SN-4471',
      }),
    ]);
    const row = find(report, 'ghost-assets')!.rows[0];
    expect(row.costCenter).toBe('Plant 2');
    expect(row.locationId).toBe('loc-1');
    expect(row.siteLabel).toBe('Houston');
    expect(row.jurisdictionName).toBe('Harris County');
    expect(row.evidencePresent).toBe(true);
    expect(row.categoryLabel).toBe('Machinery and equipment');
    // Stable across runs, because a disposition is recorded against it.
    expect(row.rowKey).toBe(`ghost-assets:${row.assetId}`);
  });
});

describe('confidence', () => {
  it('drops a disposal that had not happened by January 1', () => {
    // The rendition is a snapshot of January 1. An asset sold in March was
    // owned on the lien date and belongs on that year's return, however plainly
    // the register says it is gone.
    const report = run([
      asset({ isDisposed: true, disposalDate: '2025-11-02' }),
      asset({ isDisposed: true, disposalDate: '2026-03-15' }),
    ]);
    const rows = find(report, 'ghost-assets')!.rows;
    const before = rows.find((r) =>
      r.confidence.signals.some((s) => s.code === 'gone-before-january'),
    )!;
    const after = rows.find((r) =>
      r.confidence.signals.some((s) => s.code === 'owned-on-january-1'),
    )!;
    expect(before.confidence.tier).toBe('high');
    expect(after.confidence.tier).toBe('low');
    expect(after.confidence.score).toBeLessThan(before.confidence.score);
  });

  it('says what is working against a row, not only for it', () => {
    const report = run([asset({ isDisposed: true, disposalDate: null })]);
    const row = find(report, 'ghost-assets')!.rows[0];
    expect(row.confidence.why).toContain('Against it:');
    expect(row.confidence.why.toLowerCase()).toContain('no date recorded');
  });

  it('backs off a duplicate group whose lines carry their own serial numbers', () => {
    const twins = (over: Partial<SavingsAsset>) =>
      asset({ description: 'Forklift', originalCost: 55_000, acquisitionYear: 2023, ...over });
    const anonymous = find(run([twins({}), twins({})]), 'duplicate-capitalization')!;
    const serialled = find(
      run([twins({ serialNumber: 'A1' }), twins({ serialNumber: 'B2' })]),
      'duplicate-capitalization',
    )!;
    expect(anonymous.rows[0].confidence.score).toBeGreaterThan(serialled.rows[0].confidence.score);
    expect(serialled.confidenceMix.low).toBe(2);
    // One copy per group stays on the return, and is printed anyway.
    expect(serialled.rows).toHaveLength(2);
    expect(serialled.rows.filter((r) => r.valueRemoved === 0)).toHaveLength(1);
  });

  it('counts the tiers and the signals it counted them from', () => {
    const report = run([
      asset({ isDisposed: true, disposalDate: '2025-02-02' }),
      asset({ isDisposed: true, disposalDate: null }),
    ]);
    const ghost = find(report, 'ghost-assets')!;
    expect(ghost.confidenceMix.high + ghost.confidenceMix.medium + ghost.confidenceMix.low).toBe(2);
    const basis = ghost.detection.find((d) => d.code === 'no-disposal-date')!;
    expect(basis.assetCount).toBe(1);
    expect(basis.originalCost).toBe(100_000);
  });
});

/**
 * A real 2025 Harris rate — Houston ISD, the city, the county and the five
 * others that levy alongside them, each taxing the whole account. Built from
 * the adopted table rather than invented so that what the report prices off is
 * the same object the roll produces.
 */
const HOUSTON = (() => {
  const result = accountRate({
    jurisdictionId: 'tx-harris',
    taxYear: 2025,
    placements: ['001', '040', '041', '042', '043', '044', '048', '061'].map((unitCode) => ({
      unitCode,
      share: 1,
    })),
  });
  if (!result.ok) throw new Error(result.reason);
  return result.rate;
})();
/** The same units, as though 2026 rates had been adopted at the 2025 figures. */
const HOUSTON_2026: AccountRate = { ...HOUSTON, taxYear: 2026 };

describe('which rate the report says it used', () => {
  const assessed = {
    accountId: '0044891',
    taxYear: 2026,
    appraisedValue: 500_000,
    assessedValue: 500_000,
    renditionFiled: true,
    ownerName: 'Acme',
  };

  it('calls the county-wide constant an estimate when no rate is supplied', () => {
    const report = run([asset()]);
    expect(report.rateSource.kind).toBe('estimated');
    expect(report.blendedTaxRate).toBeCloseTo(0.025, 9);
  });

  it('calls a rate for the reported year adopted', () => {
    const report = run([asset()], { accountRate: HOUSTON_2026 });
    expect(report.rateSource.kind).toBe('adopted');
    expect(report.rateSource.label).toBe('adopted rates');
  });

  it('names the borrowed year when the reported year has no adopted table', () => {
    const report = run([asset()], { accountRate: HOUSTON });
    expect(report.rateSource.kind).toBe('prior-year');
    expect(report.rateSource.label).toBe('2025 adopted rates');
    expect(report.rateSource.detail).toContain('2026 rates are not adopted yet');
  });

  /**
   * The bug this exists to stop: the headline priced off `blendedTaxRate` while
   * every row priced off the account's own rate, so a caller that supplied a
   * real rate and left the constant alone got a "tax a year" that the findings
   * under it did not add up to.
   */
  it('prices the headline off the same basis the rows do', () => {
    const report = run([asset()], {
      assessed,
      blendedTaxRate: 0.025,
      accountRate: HOUSTON_2026,
    });
    expect(report.blendedTaxRate).toBeCloseTo(0.0212522, 9);
    const before = taxForAccount({
      rate: HOUSTON_2026,
      marketValue: assessed.appraisedValue,
      exemptionPerUnit: TX_EXEMPTION_2026,
    }).tax;
    expect(report.estimatedAnnualSaving).toBeCloseTo(before - report.proposedTax, 6);
    expect(report.valueReduction).toBeCloseTo(before / 0.0212522 - report.proposedTaxableValue, 3);
    expect(report.proposedTax).toBeCloseTo(report.proposedTaxableValue * 0.0212522, 6);
  });
});

describe('how the exemption is granted', () => {
  /** Enough property that the exemption bites without wiping the position out. */
  const big = [asset({ originalCost: 900_000, acquisitionYear: 2025 })];

  it('subtracts once, and says so, where it has no units to grant against', () => {
    const report = run(big);
    expect(report.exemption.perUnit).toBeNull();
    expect(report.exemption.applied).toBeCloseTo(TX_EXEMPTION_2026, 6);
    expect(report.exemption.caveat).toContain('applied once here against a blended rate');
  });

  /**
   * The surprise worth pinning: for one site whose units all tax the whole
   * account, granting the exemption eight separate times against eight separate
   * levies comes to exactly the same number as subtracting it once. Everything
   * else here is a departure from this case, not from the old arithmetic.
   */
  it('lands on the single subtraction for one site whose units all overlap', () => {
    const report = run(big, { accountRate: HOUSTON_2026 });
    expect(report.exemption.applied).toBeCloseTo(TX_EXEMPTION_2026, 6);
    expect(report.proposedTaxableValue).toBeCloseTo(report.farImpliedValue - TX_EXEMPTION_2026, 6);
    expect(report.exemption.perUnit).toEqual({ units: 8, locations: 1 });
    expect(report.exemption.caveat).toContain('each of the 8 units');
  });

  it('keeps the page’s own arithmetic true after granting it per unit', () => {
    const report = run(big, {
      accountRate: HOUSTON_2026,
      exemptionGrants: { '001': 3, '061': 3 },
    });
    // The three identities a reader checks by hand.
    expect(report.proposedTax).toBeCloseTo(report.proposedTaxableValue * report.blendedTaxRate, 6);
    expect(report.proposedTaxableValue).toBeCloseTo(
      report.farImpliedValue - report.exemption.applied,
      6,
    );
    expect(report.exemption.amount).toBe(TX_EXEMPTION_2026);
  });

  it('claims it at every location inside a unit, per 11.145(c)', () => {
    const one = run(big, { accountRate: HOUSTON_2026 });
    const three = run(big, {
      accountRate: HOUSTON_2026,
      exemptionGrants: { '001': 3, '061': 3 },
    });
    expect(three.exemption.applied).toBeGreaterThan(one.exemption.applied);
    expect(three.proposedTax).toBeLessThan(one.proposedTax);
    expect(three.exemption.perUnit).toEqual({ units: 8, locations: 3 });
    expect(three.exemption.caveat).toContain('at up to 3 locations each');
    // Houston ISD and the city are 1.3975 of the 2.12522 total, and three
    // grants against each takes 250,000 more off both of those two levies. The
    // rest of the exemption is unchanged, so the value it is worth rises by
    // 250,000 × 1.3975 / 2.12522.
    expect(three.exemption.applied - one.exemption.applied).toBeCloseTo(
      (250_000 * (0.8783 + 0.51919)) / 2.12522,
      2,
    );
  });

  it('grants each side of a split account its own exemption', () => {
    const split = accountRate({
      jurisdictionId: 'tx-harris',
      taxYear: 2025,
      placements: [
        { unitCode: '040', share: 1 },
        { unitCode: '054', share: 0.5 }, // CITY OF DEER PARK
        { unitCode: '074', share: 0.5 }, // CITY OF PASADENA
      ],
    });
    if (!split.ok) throw new Error(split.reason);
    const report = run(big, { accountRate: { ...split.rate, taxYear: 2026 } });
    // Both cities exempt 125,000 of their own half, so the exemption is worth
    // more than 125,000 of value even though no unit granted more than one.
    expect(report.exemption.applied).toBeGreaterThan(TX_EXEMPTION_2026);
    expect(report.exemption.perUnit).toEqual({ units: 3, locations: 1 });
  });

  it('never exempts more than there is, however many units grant it', () => {
    const small = run([asset({ originalCost: 40_000, acquisitionYear: 2025 })], {
      accountRate: HOUSTON_2026,
      exemptionGrants: { '001': 4 },
    });
    expect(small.proposedTaxableValue).toBe(0);
    expect(small.proposedTax).toBe(0);
    expect(small.exemption.applied).toBeCloseTo(small.farImpliedValue, 6);
  });
});
