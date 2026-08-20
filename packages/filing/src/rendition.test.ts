import { describe, expect, it } from 'vitest';
import { TX_HARRIS_2026 as S } from '@tangible/valuation';
import { buildRendition, type RenditionAsset, type RenditionInput } from './rendition.js';
import type { RenditionPosition } from './positions.js';
import { deadlinesFor } from './deadlines.js';

let nextId = 0;
const asset = (over: Partial<RenditionAsset> = {}): RenditionAsset => ({
  id: `a${nextId++}`,
  description: 'Lathe',
  acquisitionYear: 2022,
  originalCost: 100_000,
  isDisposed: false,
  categoryKey: 'machinery-equipment',
  lifeClassOverride: null,
  status: 'confirmed',
  ...over,
});

const build = (assets: RenditionAsset[], over: Partial<RenditionInput> = {}) =>
  buildRendition({
    engagementId: 'e1',
    clientName: 'Acme',
    taxYear: 2027,
    jurisdictionId: 'tx-harris',
    accountId: '1234567',
    sicCode: '3599',
    assets,
    schedule: S,
    basis: 'cost',
    filedByAgent: true,
    generatedAt: '2026-08-19T00:00:00.000Z',
    ...over,
  });

const scheduleFor = (r: ReturnType<typeof build>, key: string) =>
  r.schedules.find((s) => s.key === key);
const blocker = (r: ReturnType<typeof build>, key: string) => r.blockers.find((b) => b.key === key);

describe('what lands on which schedule', () => {
  it('routes each category to the form schedule that covers it', () => {
    const rendition = build([
      asset({ categoryKey: 'machinery-equipment', originalCost: 500_000 }),
      asset({ categoryKey: 'inventory', originalCost: 200_000, acquisitionYear: 2026 }),
      asset({ categoryKey: 'vehicles', originalCost: 40_000 }),
      asset({ categoryKey: 'excluded-leased-in', originalCost: 30_000 }),
    ]);
    expect(scheduleFor(rendition, 'B')?.totalCost).toBe(200_000);
    expect(scheduleFor(rendition, 'D')?.totalCost).toBe(40_000);
    expect(scheduleFor(rendition, 'E')?.totalCost).toBe(500_000);
    // Property held but not owned is still reportable, on its own schedule.
    expect(scheduleFor(rendition, 'F')?.totalCost).toBe(30_000);
  });

  it('breaks Schedule E out by type and year acquired', () => {
    const rendition = build([
      asset({ categoryKey: 'machinery-equipment', acquisitionYear: 2022, originalCost: 100_000 }),
      asset({ categoryKey: 'machinery-equipment', acquisitionYear: 2022, originalCost: 50_000 }),
      asset({ categoryKey: 'machinery-equipment', acquisitionYear: 2019, originalCost: 70_000 }),
      asset({ categoryKey: 'furniture-fixtures', acquisitionYear: 2022, originalCost: 10_000 }),
    ]);
    const lines = scheduleFor(rendition, 'E')!.lines;
    // Two machinery years and one furniture year: three lines, not four assets.
    expect(lines).toHaveLength(3);
    const machinery2022 = lines.find(
      (l) => l.yearAcquired === 2022 && l.type.startsWith('Machinery'),
    )!;
    expect(machinery2022.historicalCost).toBe(150_000);
    expect(machinery2022.assetCount).toBe(2);
    // Newest year first, so the years carrying the most value read first.
    const machinery = lines.filter((l) => l.type.startsWith('Machinery'));
    expect(machinery.map((l) => l.yearAcquired)).toEqual([2022, 2019]);
  });

  it('leaves property off the form with a stated reason', () => {
    const rendition = build([
      asset({ categoryKey: 'excluded-intangible', originalCost: 96_000 }),
      asset({ isDisposed: true, originalCost: 40_000 }),
    ]);
    const reasons = rendition.exclusions.map((e) => e.reason).join(' ');
    expect(reasons).toContain('not renderable');
    expect(reasons).toContain('taxable tangible personal property');
    expect(rendition.exclusions.reduce((n, e) => n + e.assetCount, 0)).toBe(2);
  });
});

describe('the two filing bases', () => {
  // Tax Code 22.01(a)(5): cost and year, or a good faith estimate. Not both.
  it('files cost without an estimate by default', () => {
    const rendition = build([asset()]);
    expect(rendition.basis).toBe('cost');
    expect(rendition.totalGoodFaithEstimate).toBeNull();
    expect(scheduleFor(rendition, 'E')!.lines[0]!.goodFaithEstimate).toBeNull();
    // The district's own value is still computed and shown — just not filed.
    expect(rendition.scheduleValue).toBeGreaterThan(0);
  });

  it('carries an estimate on every line when that basis is chosen', () => {
    const rendition = build([asset()], { basis: 'estimate' });
    expect(rendition.totalGoodFaithEstimate).toBeCloseTo(rendition.scheduleValue, 6);
    expect(scheduleFor(rendition, 'E')!.lines[0]!.goodFaithEstimate).toBeGreaterThan(0);
  });

  // Zero is not "we don't know" — on a form signed under penalty of perjury it
  // is an assertion that the property is worthless.
  it('withholds an estimate it cannot compute rather than stating zero', () => {
    const rendition = build([asset({ acquisitionYear: null, originalCost: 3_850 })], {
      basis: 'estimate',
    });
    const line = scheduleFor(rendition, 'E')!.lines[0]!;
    expect(line.historicalCost).toBe(3_850);
    expect(line.goodFaithEstimate).toBeNull();
    expect(scheduleFor(rendition, 'E')!.totalEstimate).toBeNull();
    expect(rendition.totalGoodFaithEstimate).toBeNull();
    // And it stops being a note: there is no honest figure to swear to.
    expect(blocker(rendition, 'unvaluable')?.severity).toBe('blocking');
  });

  it('treats the same gap as a note when filing on cost', () => {
    // The cost basis asks for cost and year; the district does the arithmetic,
    // so a value we could not compute costs nothing.
    const rendition = build([asset({ acquisitionYear: null })], { basis: 'cost' });
    expect(blocker(rendition, 'unvaluable')?.severity).toBe('warning');
    expect(scheduleFor(rendition, 'E')!.lines[0]!.historicalCost).toBeGreaterThan(0);
  });
});

describe('notarization', () => {
  // 22.24(e) turns on the estimate, not the value — which is the whole reason
  // the cost basis is the default.
  it('is required for a large agent-filed estimate', () => {
    const rendition = build([asset({ originalCost: 1_000_000 })], { basis: 'estimate' });
    expect(rendition.scheduleValue).toBeGreaterThan(150_000);
    expect(rendition.notarization.required).toBe(true);
    expect(rendition.notarization.reason).toContain('22.24(e)');
  });

  it('is not required at any value when filing on cost', () => {
    const rendition = build([asset({ originalCost: 50_000_000 })], { basis: 'cost' });
    expect(rendition.notarization.required).toBe(false);
    expect(rendition.notarization.reason).toContain('historical cost');
  });

  it('is not required below the threshold, or when the owner files', () => {
    expect(
      build([asset({ originalCost: 20_000 })], { basis: 'estimate' }).notarization.required,
    ).toBe(false);
    expect(
      build([asset({ originalCost: 1_000_000 })], { basis: 'estimate', filedByAgent: false })
        .notarization.required,
    ).toBe(false);
  });
});

describe('the simplified path', () => {
  it('collapses a small rendition onto Schedule A', () => {
    const rendition = build([asset({ originalCost: 8_000, acquisitionYear: 2020 })]);
    expect(rendition.qualifiesForScheduleA).toBe(true);
    expect(rendition.schedules).toHaveLength(1);
    expect(rendition.schedules[0]!.key).toBe('A');
  });

  it('itemizes once the total clears the threshold', () => {
    const rendition = build([asset({ originalCost: 500_000 })]);
    expect(rendition.qualifiesForScheduleA).toBe(false);
    expect(rendition.schedules.some((s) => s.key === 'E')).toBe(true);
  });
});

describe('what blocks a signature', () => {
  it('refuses to quietly file around an unresolved asset', () => {
    const rendition = build([asset(), asset({ status: 'needs-review' })]);
    const queued = blocker(rendition, 'needs-review')!;
    expect(queued.severity).toBe('blocking');
    // The omitted asset must not appear on any schedule.
    expect(scheduleFor(rendition, 'E')!.lines.reduce((n, l) => n + l.assetCount, 0)).toBe(1);
  });

  it('blocks an unclassified register and an agent filing without an appointment', () => {
    const rendition = build([asset({ status: null, categoryKey: null }), asset()]);
    expect(blocker(rendition, 'unclassified')?.severity).toBe('blocking');
    expect(blocker(rendition, 'agent-appointment')?.severity).toBe('blocking');
  });

  it('warns rather than blocks on things that only make it worse', () => {
    const rendition = build([asset({ acquisitionYear: null })], {
      accountId: null,
      sicCode: null,
    });
    for (const key of ['no-account', 'no-sic', 'unvaluable']) {
      expect(blocker(rendition, key)?.severity, key).toBe('warning');
    }
  });

  it('blocks when there is no jurisdiction or nothing to file', () => {
    const empty = build([], { jurisdictionId: null, schedule: null });
    expect(blocker(empty, 'no-jurisdiction')?.severity).toBe('blocking');
    expect(blocker(empty, 'nothing-to-file')?.severity).toBe('blocking');
  });
});

describe('deadlines', () => {
  it('carries the statute with every date', () => {
    const dates = deadlinesFor(2027);
    for (const deadline of dates) expect(deadline.basis).toMatch(/Tax Code|SB /);
    expect(dates.find((d) => d.key === 'assessment-date')?.date).toBe('2027-01-01');
  });

  it('moves a weekend deadline to the next business day', () => {
    // 15 April 2028 is a Saturday.
    expect(deadlinesFor(2028).find((d) => d.key === 'rendition-due')?.date).toBe('2028-04-17');
    // 15 April 2027 is a Thursday and stands.
    expect(deadlinesFor(2027).find((d) => d.key === 'rendition-due')?.date).toBe('2027-04-15');
  });

  it('notes that an extension carries the Freeport application with it', () => {
    const freeport = deadlinesFor(2027).find((d) => d.key === 'freeport')!;
    expect(freeport.basis).toContain('May 15');
  });
});

// --- Committed findings reaching the form ----------------------------------

const position = (over: Partial<RenditionPosition> = {}): RenditionPosition => ({
  source: 'savings',
  key: 'leasehold-double-tax',
  title: 'Leasehold improvements possibly taxed twice',
  taxYear: 2027,
  status: 'accepted',
  decidedBy: 'dana@example.com',
  decidedAt: '2026-08-19T00:00:00.000Z',
  cost: 54_300,
  assetCount: 3,
  ...over,
});

const decision = (r: ReturnType<typeof build>, key: string) =>
  r.decisions.find((d) => d.key === key);

describe('what a decision does to the form', () => {
  it('takes leasehold improvements off Schedule E once 23.24 is accepted', () => {
    const assets = [
      asset({ categoryKey: 'machinery-equipment', originalCost: 500_000 }),
      asset({ categoryKey: 'leasehold-improvements', originalCost: 40_000 }),
      asset({ categoryKey: 'leasehold-improvements', originalCost: 14_300 }),
    ];
    const before = build(assets);
    expect(scheduleFor(before, 'E')?.totalCost).toBe(554_300);

    const after = build(assets, { positions: [position()] });
    expect(scheduleFor(after, 'E')?.totalCost).toBe(500_000);
    expect(after.exclusions.find((e) => e.categoryKey === 'leasehold-improvements')).toMatchObject({
      assetCount: 2,
      originalCost: 54_300,
    });
    expect(decision(after, 'leasehold-double-tax')).toMatchObject({
      removedCost: 54_300,
      removedAssetCount: 2,
      decidedBy: 'dana@example.com',
    });
  });

  /**
   * The whole reason a position names a category instead of the finding's own
   * evidence: that list is capped at twenty-five rows, so an id-driven removal
   * would file the twenty-sixth leasehold improvement and drop the rest.
   */
  it('removes property the finding never listed', () => {
    const many = Array.from({ length: 30 }, () =>
      asset({ categoryKey: 'leasehold-improvements', originalCost: 1_000 }),
    );
    const rendition = build(many, {
      // Committed when the register held three of them.
      positions: [position({ cost: 3_000, assetCount: 3 })],
    });
    expect(scheduleFor(rendition, 'E')).toBeUndefined();
    expect(decision(rendition, 'leasehold-double-tax')?.removedAssetCount).toBe(30);
  });

  it('leaves the property on the form until the finding is accepted', () => {
    const assets = [asset({ categoryKey: 'leasehold-improvements', originalCost: 54_300 })];
    for (const status of [null, 'pending-client', 'rejected'] as const) {
      const rendition = build(assets, { positions: [position({ status })] });
      expect(scheduleFor(rendition, 'E')?.totalCost).toBe(54_300);
      expect(decision(rendition, 'leasehold-double-tax')?.removedCost).toBe(0);
    }
  });

  it('warns while a 23.24 question is open against property still on the form', () => {
    const open = build([asset({ categoryKey: 'leasehold-improvements' })], {
      positions: [position({ status: null })],
    });
    expect(blocker(open, 'finding:savings:leasehold-double-tax')?.severity).toBe('warning');

    const pending = build([asset({ categoryKey: 'leasehold-improvements' })], {
      positions: [position({ status: 'pending-client' })],
    });
    expect(blocker(pending, 'finding:savings:leasehold-double-tax')?.severity).toBe('warning');

    const settled = build([asset({ categoryKey: 'leasehold-improvements' })], {
      positions: [position()],
    });
    expect(blocker(settled, 'finding:savings:leasehold-double-tax')).toBeUndefined();
  });

  /**
   * Under-rendering property because an exemption might apply is how a 22.28
   * penalty starts. Freeport is claimed on its own application.
   */
  it('keeps inventory on Schedule B even with freeport accepted', () => {
    const rendition = build([asset({ categoryKey: 'inventory', originalCost: 300_000 })], {
      positions: [position({ key: 'freeport', title: 'Freeport exemption on inventory' })],
    });
    expect(scheduleFor(rendition, 'B')?.totalCost).toBe(300_000);
    expect(decision(rendition, 'freeport')?.removedCost).toBe(0);
    expect(blocker(rendition, 'finding:savings:freeport')?.resolution).toContain('30 April');
  });

  it('drops the disposal warning once the disposals have been accepted', () => {
    const assets = [asset({ isDisposed: true }), asset()];
    expect(blocker(build(assets), 'disposed-present')?.severity).toBe('warning');

    const confirmed = build(assets, {
      positions: [
        position({ key: 'ghost-assets', title: 'Disposed assets still on the register' }),
      ],
    });
    expect(blocker(confirmed, 'disposed-present')).toBeUndefined();
    expect(decision(confirmed, 'ghost-assets')?.effectOnForm).toContain('ever on');
  });

  it('blocks when the decision log and the register disagree', () => {
    const rejected = build([asset({ isDisposed: true }), asset()], {
      positions: [
        position({
          key: 'ghost-assets',
          title: 'Disposed assets still on the register',
          status: 'rejected',
        }),
      ],
    });
    const found = blocker(rejected, 'finding:savings:ghost-assets');
    expect(found?.severity).toBe('blocking');
    expect(found?.message).toContain('disagree');
    // The form still follows the register — a rejected finding is a flag, not
    // an instruction to render property the register says is gone.
    expect(rejected.totalHistoricalCost).toBe(100_000);
  });

  it('says what a decision did even when the answer is nothing', () => {
    const rendition = build([asset()], {
      positions: [
        position({ key: 'fully-depreciated', title: 'Assets already at the schedule floor' }),
        position({
          source: 'register-comparison',
          key: 'over-reported',
          title: 'Cost reported that the register does not carry',
          taxYear: 2026,
        }),
      ],
    });
    expect(decision(rendition, 'fully-depreciated')?.effectOnForm).toMatch(/^None\./);
    expect(decision(rendition, 'over-reported')?.effectOnForm).toContain('2026');
    expect(rendition.blockers.some((b) => b.key.startsWith('finding:'))).toBe(false);
  });

  it('warns before a 25.21 disclosure goes out under the client’s signature', () => {
    const rendition = build([asset()], {
      positions: [
        position({
          source: 'register-comparison',
          key: 'under-reported',
          title: 'Property on the register the return does not account for',
          taxYear: 2026,
          cost: 210_000,
        }),
      ],
    });
    const found = blocker(rendition, 'finding:register-comparison:under-reported');
    expect(found?.severity).toBe('warning');
    expect(found?.message).toContain('25.21');
    expect(found?.message).toContain('2026');
  });

  it('describes a finding it has no rule for rather than failing', () => {
    const rendition = build([asset()], {
      positions: [position({ key: 'something-new', title: 'A finding from a newer engine' })],
    });
    expect(decision(rendition, 'something-new')?.effectOnForm).toContain('No rendition effect');
    expect(rendition.blockers.some((b) => b.key.includes('something-new'))).toBe(false);
  });

  it('is the form it always was when nothing has been committed', () => {
    const rendition = build([asset()]);
    expect(rendition.decisions).toEqual([]);
    expect(rendition.blockers.some((b) => b.key.startsWith('finding:'))).toBe(false);
  });
});
