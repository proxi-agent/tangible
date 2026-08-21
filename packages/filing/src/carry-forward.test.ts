import { describe, expect, it } from 'vitest';
import {
  carryForward,
  type CarriedAsset,
  type CarryForwardInput,
  type CarryVerdict,
  type PriorReturn,
} from './carry-forward.js';

let nextId = 0;
const asset = (over: Partial<CarriedAsset> = {}): CarriedAsset => ({
  id: `a${nextId++}`,
  assetTag: null,
  description: 'Lathe',
  acquisitionYear: 2020,
  originalCost: 100_000,
  isDisposed: false,
  disposalDate: null,
  ...over,
});

const filed = (over: Partial<PriorReturn> = {}): PriorReturn => ({
  locationId: 'site-1',
  locationLabel: 'Houston Office',
  accountId: '2349508',
  taxYear: 2026,
  status: 'filed',
  filedOn: '2026-04-10',
  assetIds: [],
  assetCount: 0,
  totalHistoricalCost: 0,
  ...over,
});

const run = (over: Partial<CarryForwardInput> = {}) =>
  carryForward({ taxYear: 2027, returns: [], register: [], ...over });

const verdicts = (result: ReturnType<typeof carryForward>) =>
  Object.fromEntries(result.groups.map((one) => [one.verdict, one.count])) as Record<
    CarryVerdict,
    number | undefined
  >;

const keys = (result: ReturnType<typeof carryForward>) => result.findings.map((one) => one.key);

describe('carryForward', () => {
  describe('choosing the prior season', () => {
    it('reports nothing on a first season', () => {
      const result = run({ register: [asset(), asset()] });
      expect(result.priorYear).toBeNull();
      expect(result.groups).toEqual([]);
      expect(result.findings).toEqual([]);
      // The register is still described — the card can say "nothing to compare
      // against" and still show what this season holds.
      expect(result.registerCount).toBe(2);
      expect(result.registerCost).toBe(200_000);
    });

    it('takes the most recent year before this one, not the most recent overall', () => {
      const result = run({
        taxYear: 2027,
        returns: [
          filed({ taxYear: 2024, assetIds: ['old'] }),
          filed({ taxYear: 2026, assetIds: ['recent'] }),
          // A return already recorded for the season being prepared. Comparing
          // against it would compare the register with itself.
          filed({ taxYear: 2027, assetIds: ['current'] }),
        ],
      });
      expect(result.priorYear).toBe(2026);
      expect(result.consideredCount).toBe(1);
    });

    it('skips a year the firm did not file', () => {
      const result = run({
        taxYear: 2028,
        returns: [filed({ taxYear: 2026, assetIds: ['x'] })],
      });
      expect(result.priorYear).toBe(2026);
    });

    it('ignores superseded and void returns', () => {
      const result = run({
        returns: [
          filed({ taxYear: 2026, status: 'superseded', assetIds: ['wrong'] }),
          filed({ taxYear: 2025, status: 'void', assetIds: ['never'] }),
        ],
      });
      expect(result.priorYear).toBeNull();
    });

    it('compares against the standing return where a superseded one shares its year', () => {
      const result = run({
        returns: [
          filed({ taxYear: 2026, status: 'superseded', assetIds: ['a', 'b', 'c'] }),
          filed({ taxYear: 2026, status: 'filed', assetIds: ['a'] }),
        ],
      });
      expect(result.consideredCount).toBe(1);
    });
  });

  describe('membership is client-wide', () => {
    it('does not report an asset that moved between sites', () => {
      const moved = asset({ id: 'moved', acquisitionYear: 2019 });
      const result = run({
        returns: [
          filed({ locationId: 'site-1', locationLabel: 'Houston', assetIds: ['moved'] }),
          filed({ locationId: 'site-2', locationLabel: 'Dallas', assetIds: ['stayed'] }),
        ],
        register: [moved],
        absent: [asset({ id: 'stayed' })],
      });
      expect(verdicts(result).carried).toBe(1);
      expect(verdicts(result).omitted).toBeUndefined();
    });

    it('counts an asset on two returns once', () => {
      const result = run({
        returns: [
          filed({ locationId: 'site-1', assetIds: ['shared', 'x'] }),
          filed({ locationId: 'site-2', locationLabel: 'Dallas', assetIds: ['shared', 'y'] }),
        ],
        register: [asset({ id: 'shared' })],
      });
      expect(result.consideredCount).toBe(3);
    });

    it('lists the returns it compared against, in site order', () => {
      const result = run({
        returns: [
          filed({ locationId: 'b', locationLabel: 'Waco' }),
          filed({ locationId: 'a', locationLabel: 'Amarillo' }),
        ],
      });
      expect(result.returns.map((one) => one.locationLabel)).toEqual(['Amarillo', 'Waco']);
      // The frozen slice is not part of the output — it is an internal id list,
      // and every consumer wants the verdicts instead.
      expect(result.returns[0]).not.toHaveProperty('assetIds');
    });
  });

  describe('verdicts', () => {
    // A return that considered one asset, and one that considered none. The
    // empty slice is what the verdict tests want: anything on the register is
    // then unrendered, with nothing dropping out the other side to confuse it.
    const prior = [filed({ taxYear: 2026, assetIds: ['on-it'] })];
    const nothing = [filed({ taxYear: 2026, assetIds: [] })];

    it('carries an asset that was on the prior slice', () => {
      const result = run({ returns: prior, register: [asset({ id: 'on-it' })] });
      expect(verdicts(result)).toEqual({ carried: 1 });
    });

    it('calls an asset acquired during the prior year new, not omitted', () => {
      // Owned on January 1, 2027 but not on January 1, 2026 — it could not have
      // been on the 2026 return.
      const result = run({ returns: nothing, register: [asset({ acquisitionYear: 2026 })] });
      expect(verdicts(result)).toEqual({ acquired: 1 });
      expect(keys(result)).toEqual([]);
    });

    it('calls an asset acquired after the prior year new', () => {
      const result = run({ returns: nothing, register: [asset({ acquisitionYear: 2027 })] });
      expect(verdicts(result)).toEqual({ acquired: 1 });
    });

    it('flags an asset owned before the prior lien date and never considered', () => {
      const result = run({ returns: nothing, register: [asset({ acquisitionYear: 2025 })] });
      expect(verdicts(result)).toEqual({ omitted: 1 });
      expect(keys(result)).toContain('omitted-from-prior-return');
    });

    it('sets an asset with no acquisition year apart rather than guessing', () => {
      const result = run({ returns: nothing, register: [asset({ acquisitionYear: null })] });
      expect(verdicts(result)).toEqual({ undated: 1 });
      expect(keys(result)).toEqual(['undated-and-unrendered']);
    });

    it('reports property on the prior return that this register does not carry', () => {
      const result = run({ returns: prior, register: [] });
      expect(verdicts(result)).toEqual({ dropped: 1 });
      expect(keys(result)).toEqual(['dropped-from-register']);
    });

    it('describes a dropped asset from the last time the graph saw it', () => {
      const result = run({
        returns: prior,
        register: [],
        absent: [asset({ id: 'on-it', description: 'Forklift', originalCost: 42_000 })],
      });
      const [dropped] = result.groups;
      expect(dropped.sample[0]).toMatchObject({
        assetId: 'on-it',
        description: 'Forklift',
        originalCost: 42_000,
        verdict: 'dropped',
      });
      expect(dropped.cost).toBe(42_000);
      expect(dropped.costless).toBe(0);
    });

    it('still counts a dropped asset it cannot describe', () => {
      const result = run({ returns: prior, register: [] });
      const [dropped] = result.groups;
      expect(dropped.count).toBe(1);
      expect(dropped.cost).toBe(0);
      // The number that keeps the zero honest: one asset counted, one with no
      // cost behind it, so a reader is not told the property was worthless.
      expect(dropped.costless).toBe(1);
    });

    it('does not report an asset dropped from a return it was never on', () => {
      const result = run({ returns: prior, register: [], absent: [asset({ id: 'unrelated' })] });
      expect(result.groups).toHaveLength(1);
      expect(result.groups[0].sample[0].assetId).toBe('on-it');
    });
  });

  describe('totals', () => {
    it('sums cost over the whole group, not the sample', () => {
      const register = Array.from({ length: 30 }, (_, n) =>
        asset({ acquisitionYear: 2020, originalCost: 1_000 + n }),
      );
      const result = run({ returns: [filed({ assetIds: ['nothing'] })], register });
      const [omitted] = result.groups.filter((one) => one.verdict === 'omitted');
      expect(omitted.count).toBe(30);
      expect(omitted.cost).toBe(30 * 1_000 + (29 * 30) / 2);
      expect(omitted.sample).toHaveLength(12);
      expect(result.findings[0].count).toBe(30);
      expect(result.findings[0].cost).toBe(omitted.cost);
    });

    it('samples the largest first and puts costless assets last', () => {
      const result = run({
        returns: [filed({ assetIds: ['nothing'] })],
        register: [
          asset({ id: 'small', originalCost: 10 }),
          asset({ id: 'none', originalCost: null }),
          asset({ id: 'big', originalCost: 900 }),
        ],
      });
      const [omitted] = result.groups;
      expect(omitted.sample.map((one) => one.assetId)).toEqual(['big', 'small', 'none']);
      expect(omitted.costless).toBe(1);
    });

    it('drops empty groups rather than reporting zeroes', () => {
      const result = run({
        returns: [filed({ assetIds: ['on-it'] })],
        register: [asset({ id: 'on-it' })],
      });
      expect(result.groups.map((one) => one.verdict)).toEqual(['carried']);
    });
  });

  describe('findings', () => {
    it('ranks the omission first', () => {
      const result = run({
        returns: [filed({ assetIds: ['gone', 'kept'] })],
        register: [
          asset({ id: 'kept', isDisposed: true, disposalDate: '2027-03-01' }),
          asset({ acquisitionYear: 2019 }),
          asset({ acquisitionYear: null }),
        ],
      });
      expect(keys(result)).toEqual([
        'omitted-from-prior-return',
        'dropped-from-register',
        'undated-and-unrendered',
        'carried-now-disposed',
      ]);
      expect(result.findings[0].severity).toBe('critical');
      expect(result.findings[1].severity).toBe('warning');
    });

    it('names the two-year reach of 25.21 on the omission', () => {
      const result = run({ returns: [filed({ assetIds: [] })], register: [asset({ acquisitionYear: 2019 })] });
      expect(result.findings[0].detail).toContain('25.21');
      expect(result.findings[0].detail).toContain('two preceding years');
      expect(result.findings[0].detail).toContain('22.28');
      // Two ways this finding is wrong without anybody omitting anything, and
      // the copy names both. The second is the one live data surfaced: a client
      // with two sites where only one return was ever recorded reads its whole
      // second site as never rendered.
      expect(result.findings[0].detail).toContain('wrong acquisition year');
      expect(result.findings[0].detail).toContain('without ever being recorded here');
    });

    it('flags carried property the register now marks disposed', () => {
      const result = run({
        returns: [filed({ assetIds: ['x'] })],
        register: [asset({ id: 'x', isDisposed: true, disposalDate: '2026-11-02' })],
      });
      expect(verdicts(result)).toEqual({ carried: 1 });
      expect(keys(result)).toEqual(['carried-now-disposed']);
      expect(result.findings[0].detail).toContain('January 1, 2027');
    });

    it('does not flag a disposal on property that was never rendered', () => {
      const result = run({
        returns: [filed({ assetIds: [] })],
        register: [asset({ acquisitionYear: 2026, isDisposed: true })],
      });
      expect(keys(result)).toEqual([]);
    });

    it('agrees in number and plurality with the returns it compared', () => {
      const one = run({
        returns: [filed({ assetIds: [] })],
        register: [asset({ acquisitionYear: 2019 })],
      });
      expect(one.findings[0].headline).toContain('1 asset');
      expect(one.findings[0].headline).toContain("year's return");
      expect(one.findings[0].detail).toContain('The 2026 return for Houston Office was');

      const many = run({
        returns: [filed({ assetIds: [] }), filed({ locationId: 'b', locationLabel: 'Waco', assetIds: [] })],
        register: [asset({ acquisitionYear: 2019 }), asset({ acquisitionYear: 2018 })],
      });
      expect(many.findings[0].headline).toContain('2 assets');
      expect(many.findings[0].headline).toContain("year's returns");
      expect(many.findings[0].detail).toContain('The 2026 returns for Houston Office, Waco were');
    });
  });
});
