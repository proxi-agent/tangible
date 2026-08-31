import { describe, expect, it } from 'vitest';
import { rollupMapped, type MappableLine } from './mapped-basis.js';

function line(over: Partial<MappableLine> = {}): MappableLine {
  return {
    schedule: 'E',
    type: 'Mach & Equip',
    yearAcquired: 2019,
    historicalCost: 100000,
    goodFaithEstimate: null,
    categoryKey: 'machinery-equipment',
    mappingStatus: 'auto-accepted',
    ...over,
  };
}

describe('rollupMapped', () => {
  it('rolls settled lines to category and year', () => {
    const basis = rollupMapped([
      line({ yearAcquired: 2019, historicalCost: 100000 }),
      line({ yearAcquired: 2020, historicalCost: 40000 }),
      line({ yearAcquired: 2019, type: 'Shop Equipment', historicalCost: 25000 }),
    ]);

    expect(basis.placed).toHaveLength(2);
    const y2019 = basis.placed.find((b) => b.yearAcquired === 2019)!;
    expect(y2019.reported).toBe(125000);
    expect(y2019.lineCount).toBe(2);
    // Both of the filer's wordings are kept, so the bucket can be argued with.
    expect(y2019.wordings).toEqual(['Mach & Equip', 'Shop Equipment']);
    expect(basis.placedTotal).toBe(165000);
    expect(basis.unplacedTotal).toBe(0);
  });

  /**
   * The property this whole module exists for. Every dollar the form reported is
   * either placed or explicitly unplaced — a rollup that silently dropped what
   * it could not read would manufacture an under-reporting finding out of our
   * own gaps, and it would look exactly like a real one.
   */
  it('reconciles: placed plus unplaced is always the whole reported total', () => {
    const basis = rollupMapped([
      line({ historicalCost: 100000 }),
      line({
        type: 'Furniture, Fixtures & Equipment',
        categoryKey: 'mixed',
        historicalCost: 60000,
      }),
      line({
        type: 'Widgets',
        categoryKey: null,
        mappingStatus: 'needs-review',
        historicalCost: 9000,
      }),
      line({
        schedule: 'F',
        type: 'Leased copier',
        categoryKey: 'excluded-leased-in',
        historicalCost: 5000,
      }),
    ]);

    expect(basis.placedTotal).toBe(100000);
    expect(basis.unplacedTotal).toBe(74000);
    expect(basis.reportedTotal).toBe(174000);
    expect(basis.placedTotal + basis.unplacedTotal).toBe(basis.reportedTotal);
  });

  it('separates blended cost from unread cost from someone else’s property', () => {
    const basis = rollupMapped([
      line({ type: 'FF&E', categoryKey: 'mixed', historicalCost: 60000 }),
      line({
        type: 'Misc',
        categoryKey: null,
        mappingStatus: 'needs-review',
        historicalCost: 9000,
      }),
      line({
        schedule: 'F',
        type: 'Leased forklift',
        categoryKey: 'excluded-leased-in',
        historicalCost: 5000,
      }),
    ]);

    const reasons = Object.fromEntries(basis.unplaced.map((b) => [b.reason, b.reported]));
    expect(reasons).toEqual({ blended: 60000, 'needs-review': 9000, excluded: 5000 });
    expect(basis.unplaced.find((b) => b.reason === 'excluded')?.label).toContain('Leased in');
  });

  /**
   * An unsettled reading is not a reading. Measuring against it would put a
   * dollar figure in front of a client on the strength of a guess nobody signed.
   */
  it('holds a queued line out of the comparison even with a category on it', () => {
    const basis = rollupMapped([
      line({ categoryKey: 'machinery-equipment', mappingStatus: 'needs-review' }),
    ]);
    expect(basis.placedTotal).toBe(0);
    expect(basis.unplaced[0]?.reason).toBe('needs-review');
  });

  /**
   * Schedule F is real reported cost, but the lessor owns it. Placing it would
   * manufacture a discrepancy the size of every copier the client rents.
   */
  it('never places an exclusion, however settled', () => {
    const basis = rollupMapped([
      line({ schedule: 'F', categoryKey: 'excluded-leased-in', mappingStatus: 'confirmed' }),
    ]);
    expect(basis.placed).toHaveLength(0);
    expect(basis.unplaced[0]?.reason).toBe('excluded');
  });

  it('falls back to the estimate when the filer reported no cost', () => {
    const basis = rollupMapped([line({ historicalCost: null, goodFaithEstimate: 60000 })]);
    expect(basis.placedTotal).toBe(60000);
  });

  it('counts a line once when it carries both figures', () => {
    const basis = rollupMapped([line({ historicalCost: 100000, goodFaithEstimate: 60000 })]);
    expect(basis.placedTotal).toBe(100000);
  });

  it('skips a line with nothing on it rather than bucketing a zero', () => {
    const basis = rollupMapped([line({ historicalCost: null, goodFaithEstimate: null })]);
    expect(basis.placed).toHaveLength(0);
    expect(basis.unplaced).toHaveLength(0);
    expect(basis.reportedTotal).toBe(0);
  });

  /** Schedules B, C and D carry no year; the bucket says so rather than inventing one. */
  it('keeps yearless schedules in their own bucket', () => {
    const basis = rollupMapped([
      line({
        schedule: 'B',
        type: 'Inventory',
        yearAcquired: null,
        categoryKey: 'inventory',
        historicalCost: 220000,
        mappingStatus: 'auto-accepted',
      }),
    ]);
    expect(basis.placed[0]).toMatchObject({
      categoryKey: 'inventory',
      yearAcquired: null,
      reported: 220000,
    });
  });
});
