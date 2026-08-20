import { describe, expect, it } from 'vitest';
import { TX_HARRIS_2026 as S } from '@tangible/valuation';
import {
  compareRegister,
  type CompareRegisterInput,
  type RegisterAsset,
} from './compare-register.js';
import type { MappableLine } from './mapped-basis.js';

let nextId = 0;
const asset = (over: Partial<RegisterAsset> = {}): RegisterAsset => ({
  id: `a${nextId++}`,
  description: 'Lathe',
  acquisitionYear: 2020,
  originalCost: 100_000,
  isDisposed: false,
  disposalDate: null,
  categoryKey: 'machinery-equipment',
  lifeClassOverride: null,
  status: 'confirmed',
  ...over,
});

const line = (over: Partial<MappableLine> = {}): MappableLine => ({
  schedule: 'E',
  type: 'Mach & Equip',
  yearAcquired: 2020,
  historicalCost: 100_000,
  goodFaithEstimate: null,
  categoryKey: 'machinery-equipment',
  mappingStatus: 'auto-accepted',
  ...over,
});

const run = (
  assets: RegisterAsset[],
  lines: MappableLine[],
  over: Partial<CompareRegisterInput> = {},
) =>
  compareRegister({
    taxYear: 2026,
    assets,
    lines,
    schedule: S,
    businessSic: null,
    ...over,
  });

const find = (c: ReturnType<typeof run>, key: string) => c.findings.find((f) => f.key === key);

describe('what the comparison reconciles', () => {
  /**
   * The two identities the whole engine rests on. Every compared dollar on each
   * side lands in exactly one bucket, so a reader can add the columns up and get
   * back the totals. Break these and the findings start double-counting without
   * anything looking wrong.
   */
  it('splits both sides into matched, reallocated and net, exactly', () => {
    const c = run(
      [
        asset({ acquisitionYear: 2020, originalCost: 100_000 }),
        asset({ acquisitionYear: 2021, originalCost: 60_000, categoryKey: 'computer-pc' }),
        asset({ acquisitionYear: 2019, originalCost: 25_000, categoryKey: 'furniture-fixtures' }),
      ],
      [
        line({ yearAcquired: 2020, historicalCost: 140_000 }),
        line({ yearAcquired: 2021, categoryKey: 'furniture-fixtures', historicalCost: 60_000 }),
        line({ yearAcquired: 2019, categoryKey: 'furniture-fixtures', historicalCost: 25_000 }),
      ],
    );

    expect(c.comparedRegisterCost).toBe(c.matchedCost + c.reallocatedCost + c.underReportedCost);
    expect(c.comparedReportedCost).toBe(c.matchedCost + c.reallocatedCost + c.overReportedCost);
  });

  /** Nothing leaves the register unaccounted for: compared, or set aside by name. */
  it('accounts for every register dollar, compared or set aside', () => {
    const c = run(
      [
        asset(),
        asset({ status: null }),
        asset({ acquisitionYear: 2026, originalCost: 40_000 }),
        asset({ isDisposed: true, disposalDate: '2025-06-01', originalCost: 15_000 }),
        asset({ categoryKey: 'excluded-leased-in', originalCost: 9_000 }),
      ],
      [line()],
    );

    const setAside = c.registerAside.reduce((sum, a) => sum + a.cost, 0);
    expect(c.registerTotal).toBe(c.comparedRegisterCost + setAside);
    expect(c.coverage.assetCount).toBe(c.coverage.comparedAssetCount + c.coverage.asideAssetCount);
  });

  it('carries the mapped basis total through unchanged', () => {
    const c = run(
      [asset()],
      [
        line({ historicalCost: 100_000 }),
        line({ type: 'Furniture, Fixtures & Equipment', categoryKey: 'mixed', historicalCost: 30_000 }),
      ],
    );
    expect(c.reportedTotal).toBe(130_000);
    expect(c.comparedReportedCost).toBe(100_000);
    expect(c.reportedAside.reduce((sum, b) => sum + b.reported, 0)).toBe(30_000);
  });
});

describe('scope: what was owned on January 1', () => {
  /**
   * The finding a naive subtraction manufactures first. Property bought during
   * the return's own tax year was not owned on its assessment date, so its
   * absence from the return is the calendar, not an omission.
   */
  it('holds out property acquired in or after the return year', () => {
    const c = run([asset({ acquisitionYear: 2026, originalCost: 80_000 })], []);

    expect(c.comparedRegisterCost).toBe(0);
    expect(c.underReportedCost).toBe(0);
    expect(find(c, 'under-reported')).toBeUndefined();
    expect(c.registerAside.find((a) => a.reason === 'acquired-later')?.cost).toBe(80_000);
  });

  it('compares property acquired before the return year', () => {
    const c = run([asset({ acquisitionYear: 2025, originalCost: 80_000 })], []);
    expect(c.comparedRegisterCost).toBe(80_000);
    expect(c.underReportedCost).toBe(80_000);
  });

  /** A disposal dated after January 1 leaves the asset on this return. */
  it('reads the disposal date, not just the flag', () => {
    const before = run([asset({ isDisposed: true, disposalDate: '2025-11-30' })], []);
    expect(before.comparedRegisterCost).toBe(0);
    expect(before.registerAside.find((a) => a.reason === 'disposed')?.cost).toBe(100_000);

    const after = run([asset({ isDisposed: true, disposalDate: '2026-07-01' })], []);
    expect(after.comparedRegisterCost).toBe(100_000);
    expect(after.registerAside.find((a) => a.reason === 'disposed')).toBeUndefined();
  });

  it('treats an undated disposal as gone before the assessment date', () => {
    const c = run([asset({ isDisposed: true, disposalDate: null })], []);
    expect(c.comparedRegisterCost).toBe(0);
  });

  it('sets aside unsettled and excluded property instead of comparing it', () => {
    const c = run(
      [
        asset({ status: 'needs-review', originalCost: 50_000 }),
        asset({ status: null, originalCost: 30_000 }),
        asset({ categoryKey: 'excluded-leased-in', originalCost: 20_000 }),
      ],
      [],
    );
    expect(c.comparedRegisterCost).toBe(0);
    expect(c.registerAside.map((a) => a.reason).sort()).toEqual([
      'excluded',
      'needs-review',
      'unclassified',
    ]);
  });
});

describe('findings', () => {
  /**
   * The point of decomposing by vintage before naming anything. One line filed
   * under the wrong heading is one problem, and a comparison that reported it as
   * both an over-statement and an omission would double the client's number and
   * be wrong twice.
   */
  it('calls a mis-scheduled line one finding, not two', () => {
    const c = run(
      [asset({ categoryKey: 'computer-pc', acquisitionYear: 2020, originalCost: 100_000 })],
      [line({ categoryKey: 'machinery-equipment', yearAcquired: 2020, historicalCost: 100_000 })],
    );

    expect(c.reallocatedCost).toBe(100_000);
    expect(c.overReportedCost).toBe(0);
    expect(c.underReportedCost).toBe(0);
    expect(c.findings.map((f) => f.key)).toEqual(['misscheduled']);

    // Computers depreciate faster than machinery on the district's tables, so
    // filing them as machinery costs the client value every year nobody looks.
    const finding = find(c, 'misscheduled')!;
    expect(finding.effect).toBe('saving');
    expect(finding.value).toBeGreaterThan(0);
    expect(finding.assumption).not.toBeNull();
  });

  it('attributes over-reported cost to disposals the register already dated', () => {
    const c = run(
      [
        asset({ acquisitionYear: 2020, originalCost: 100_000 }),
        asset({
          acquisitionYear: 2020,
          originalCost: 40_000,
          isDisposed: true,
          disposalDate: '2025-03-01',
          description: 'Retired press',
        }),
      ],
      [line({ yearAcquired: 2020, historicalCost: 140_000 })],
    );

    const ghost = find(c, 'rendered-after-disposal')!;
    expect(ghost.kind).toBe('measured');
    expect(ghost.effect).toBe('saving');
    expect(ghost.cost).toBe(40_000);
    expect(ghost.assets.map((a) => a.description)).toEqual(['Retired press']);
    // All of the excess is explained, so nothing is left to assume about.
    expect(find(c, 'over-reported')).toBeUndefined();
  });

  it('reports excess beyond the disposals as modeled, not measured', () => {
    const c = run(
      [
        asset({ acquisitionYear: 2020, originalCost: 100_000 }),
        asset({
          acquisitionYear: 2020,
          originalCost: 10_000,
          isDisposed: true,
          disposalDate: '2025-03-01',
        }),
      ],
      [line({ yearAcquired: 2020, historicalCost: 160_000 })],
    );

    expect(find(c, 'rendered-after-disposal')!.cost).toBe(10_000);
    const over = find(c, 'over-reported')!;
    expect(over.kind).toBe('modeled');
    expect(over.cost).toBe(50_000);
    expect(over.assumption).toContain('register being complete');
  });

  /**
   * Exposure is a separate axis from savings on purpose. Under-reporting has a
   * real dollar figure and it must never be able to reach a refund total.
   */
  it('names omitted property as exposure, never as a saving', () => {
    const c = run(
      [
        asset({ acquisitionYear: 2020, originalCost: 100_000, description: 'Unrendered press' }),
      ],
      [line({ yearAcquired: 2020, historicalCost: 60_000 })],
    );

    const under = find(c, 'under-reported')!;
    expect(under.effect).toBe('exposure');
    expect(under.cost).toBe(40_000);
    expect(under.kind).toBe('measured');
    expect(under.assets.map((a) => a.description)).toEqual(['Unrendered press']);
    expect(c.findings.every((f) => f.effect !== 'saving' || f.key !== 'under-reported')).toBe(true);
  });

  /**
   * A blended line can cover anything. Calling property omitted while a chunk of
   * the return is still unreadable would be an accusation the data cannot make.
   */
  it('downgrades omission to modeled when part of the return is unplaced', () => {
    const c = run(
      [asset({ acquisitionYear: 2020, originalCost: 100_000 })],
      [
        line({ yearAcquired: 2020, historicalCost: 60_000 }),
        line({
          yearAcquired: 2020,
          type: 'Furniture, Fixtures & Equipment',
          categoryKey: 'mixed',
          historicalCost: 35_000,
        }),
      ],
    );

    const under = find(c, 'under-reported')!;
    expect(under.kind).toBe('modeled');
    expect(under.assumption).toContain('$35,000');
  });

  /**
   * The bug the first live document found. Two rows sharing nothing but "nobody
   * recorded the year" are not the same property, and netting them produces a
   * mis-scheduling finding out of two unrelated gaps.
   */
  it('does not reallocate across a missing acquisition year', () => {
    const c = run(
      [asset({ acquisitionYear: null, categoryKey: 'furniture-fixtures', originalCost: 3_850 })],
      [line({ yearAcquired: null, categoryKey: 'inventory', historicalCost: 4_800 })],
    );

    expect(c.reallocatedCost).toBe(0);
    expect(c.overReportedCost).toBe(4_800);
    expect(c.underReportedCost).toBe(3_850);
    expect(find(c, 'misscheduled')).toBeUndefined();
    expect(find(c, 'over-reported')!.cost).toBe(4_800);
    expect(find(c, 'under-reported')!.cost).toBe(3_850);
    // And it still reconciles on both sides.
    expect(c.comparedRegisterCost).toBe(c.matchedCost + c.reallocatedCost + c.underReportedCost);
    expect(c.comparedReportedCost).toBe(c.matchedCost + c.reallocatedCost + c.overReportedCost);
  });

  it('finds nothing when the return matches the register', () => {
    const c = run([asset()], [line()]);
    expect(c.findings).toEqual([]);
    expect(c.categories[0]!.verdict).toBe('agrees');
  });

  /** Renditions are whole dollars; registers keep cents. A rounding penny is not a finding. */
  it('does not manufacture a finding out of sub-dollar rounding', () => {
    const c = run([asset({ originalCost: 100_000.4 })], [line({ historicalCost: 100_000 })]);
    expect(c.findings).toEqual([]);
    expect(c.categories[0]!.verdict).toBe('agrees');
    // The residual still reconciles rather than vanishing.
    expect(c.comparedRegisterCost).toBe(c.matchedCost + c.reallocatedCost + c.underReportedCost);
  });
});

describe('the shape a reader sees', () => {
  it('labels each category by what disagrees', () => {
    const c = run(
      [
        asset({ categoryKey: 'machinery-equipment', originalCost: 100_000 }),
        asset({ categoryKey: 'furniture-fixtures', originalCost: 20_000 }),
      ],
      [
        line({ categoryKey: 'machinery-equipment', historicalCost: 100_000 }),
        line({ categoryKey: 'office-equipment', historicalCost: 5_000 }),
      ],
    );

    const byKey = new Map(c.categories.map((cat) => [cat.categoryKey, cat]));
    expect(byKey.get('machinery-equipment')!.verdict).toBe('agrees');
    expect(byKey.get('furniture-fixtures')!.verdict).toBe('only-owned');
    expect(byKey.get('office-equipment')!.verdict).toBe('only-reported');
  });

  /**
   * A category can agree in total and be wrong in every year it contains, which
   * is worth more than the total: the vintage is half of what the district's
   * arithmetic uses.
   */
  it('flags a category that agrees in total but not by year', () => {
    const c = run(
      [
        asset({ acquisitionYear: 2020, originalCost: 100_000 }),
        asset({ acquisitionYear: 2015, originalCost: 50_000 }),
      ],
      [
        line({ yearAcquired: 2020, historicalCost: 50_000 }),
        line({ yearAcquired: 2015, historicalCost: 100_000 }),
      ],
    );

    const category = c.categories[0]!;
    expect(category.verdict).toBe('agrees');
    expect(category.yearsDisagree).toBe(true);
    expect(category.cells.map((cell) => cell.yearAcquired)).toEqual([2020, 2015]);
  });

  it('keeps the filer’s own wording on the cell it landed in', () => {
    const c = run([asset()], [line({ type: 'Shop Machinery & Tools' })]);
    expect(c.categories[0]!.cells[0]!.wordings).toEqual(['Shop Machinery & Tools']);
  });

  /**
   * One undated asset must not take the whole page's value with it. The value
   * totals carry what could be priced, and the cost that could not is printed
   * beside them so neither figure can be read as complete when it is not.
   */
  it('totals the value it can price and names the cost it cannot', () => {
    const c = run(
      [
        asset({ acquisitionYear: 2020, originalCost: 100_000 }),
        asset({ acquisitionYear: null, originalCost: 3_850 }),
      ],
      [line({ yearAcquired: 2020, historicalCost: 100_000 })],
    );

    expect(c.registerValue).toBeGreaterThan(0);
    expect(c.unpricedRegisterCost).toBe(3_850);
    expect(c.unpricedReportedCost).toBe(0);
    // The cell and the category it sits in still say null — that is the right
    // answer for a row, and the wrong one for the page.
    const undated = c.categories[0]!.cells.find((cell) => cell.yearAcquired === null)!;
    expect(undated.registerValue).toBeNull();
  });

  it('degrades to costs alone when no schedule is published', () => {
    const c = run([asset()], [line({ historicalCost: 140_000 })], { schedule: null });

    expect(c.hasSchedule).toBe(false);
    expect(c.registerValue).toBeNull();
    expect(c.reportedValue).toBeNull();
    expect(c.valueDifference).toBeNull();
    // The cost finding still stands — it never needed the tables.
    expect(find(c, 'over-reported')!.cost).toBe(40_000);
    expect(find(c, 'over-reported')!.value).toBeNull();
  });

  it('values the return on its own year, not the engagement’s', () => {
    const c = run([asset({ acquisitionYear: 2018 })], [line({ yearAcquired: 2018 })], {
      taxYear: 2024,
    });
    expect(c.taxYear).toBe(2024);
    expect(c.comparedRegisterCost).toBe(100_000);
  });
});
