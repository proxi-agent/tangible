import { describe, expect, it } from 'vitest';
import { TX_HARRIS_2026 as S } from '@tangible/valuation';
import { buildRendition, type RenditionAsset, type RenditionInput } from './rendition.js';
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
