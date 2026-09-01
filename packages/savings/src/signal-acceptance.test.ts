import { describe, expect, it } from 'vitest';
import type { DetectionSignal } from '@tangible/types';
import {
  MAX_LIFT,
  MIN_ARM,
  adjustAcceptance,
  learnSignalLifts,
  liftFor,
  type SignalOutcome,
} from './signal-acceptance.js';

const sig = (code: string, weight = 0.1): DetectionSignal => ({
  code,
  label: `${code} label`,
  weight,
  detail: null,
});

function outcomes(
  findingKey: string,
  spec: { codes: string[]; share: number; times: number }[],
): SignalOutcome[] {
  const rows: SignalOutcome[] = [];
  for (const one of spec) {
    for (let i = 0; i < one.times; i += 1) {
      rows.push({ findingKey, signals: one.codes.map((code) => sig(code)), share: one.share });
    }
  }
  return rows;
}

describe('learnSignalLifts', () => {
  it('finds a signal the district pays for', () => {
    const model = learnSignalLifts(
      outcomes('ghost-assets', [
        { codes: ['disposal-date'], share: 1, times: 12 },
        { codes: ['category-only'], share: 0.1, times: 12 },
      ]),
    );
    const lift = model.lifts.find((one) => one.code === 'disposal-date')!;
    expect(lift.withCount).toBe(12);
    expect(lift.withoutCount).toBe(12);
    expect(lift.lift).toBeGreaterThan(0);
    expect(lift.published).toBe(true);
    expect(lift.basis).toContain('Applied to the estimate');
  });

  it('reports the mirror image of that comparison on the other code', () => {
    const model = learnSignalLifts(
      outcomes('ghost-assets', [
        { codes: ['disposal-date'], share: 1, times: 12 },
        { codes: ['category-only'], share: 0.1, times: 12 },
      ]),
    );
    const good = model.lifts.find((one) => one.code === 'disposal-date')!;
    const bad = model.lifts.find((one) => one.code === 'category-only')!;
    expect(bad.lift).toBeLessThan(0);
    expect(bad.lift).toBeCloseTo(-good.lift, 6);
  });

  it('refuses to compare against a thin arm', () => {
    const model = learnSignalLifts(
      outcomes('ghost-assets', [
        { codes: ['everywhere'], share: 1, times: 20 },
        { codes: ['everywhere', 'rare'], share: 0.1, times: MIN_ARM - 1 },
      ]),
    );
    const rare = model.lifts.find((one) => one.code === 'rare')!;
    expect(rare.published).toBe(false);
    expect(rare.basis).toContain(`${MIN_ARM} closed positions on each side`);
    // 'everywhere' is on every row, so it has no comparison group at all.
    const all = model.lifts.find((one) => one.code === 'everywhere')!;
    expect(all.withoutCount).toBe(0);
    expect(all.published).toBe(false);
  });

  it('measures a signal that turns out not to matter, and says so', () => {
    const model = learnSignalLifts(
      outcomes('misclassification', [
        { codes: ['life-class-mismatch'], share: 0.6, times: 15 },
        { codes: ['other'], share: 0.6, times: 15 },
      ]),
    );
    const lift = model.lifts.find((one) => one.code === 'life-class-mismatch')!;
    expect(lift.lift).toBe(0);
    expect(lift.published).toBe(false);
    expect(lift.basis).toContain('found not to matter');
  });

  it('shrinks a lopsided arm toward the finding it belongs to', () => {
    // Six perfect wins against thirty at 50%. Unshrunk the with-arm is 1.0;
    // with a prior of ten anchored at the finding's own mean it lands well
    // below, which is the whole point.
    const model = learnSignalLifts(
      outcomes('freeport', [
        { codes: ['bol-on-file'], share: 1, times: 6 },
        { codes: ['none'], share: 0.5, times: 30 },
      ]),
    );
    const lift = model.lifts.find((one) => one.code === 'bol-on-file')!;
    expect(lift.withShare).toBeLessThan(0.85);
    expect(lift.withShare).toBeGreaterThan(0.58);
  });

  it('caps however flatly the outcomes separate', () => {
    const model = learnSignalLifts(
      outcomes('ghost-assets', [
        { codes: ['always-wins'], share: 1, times: 60 },
        { codes: ['always-loses'], share: 0, times: 60 },
      ]),
    );
    for (const lift of model.lifts) expect(Math.abs(lift.lift)).toBeLessThanOrEqual(MAX_LIFT);
  });

  it('ignores weightless signals, which are appended after pricing', () => {
    const rows: SignalOutcome[] = [
      ...Array.from({ length: 10 }, () => ({
        findingKey: 'ghost-assets',
        signals: [sig('disposal-date'), sig('prior-years-open', 0)],
        share: 1,
      })),
      ...Array.from({ length: 10 }, () => ({
        findingKey: 'ghost-assets',
        signals: [sig('category-only')],
        share: 0.1,
      })),
    ];
    const model = learnSignalLifts(rows);
    expect(model.lifts.map((one) => one.code)).toEqual(['category-only', 'disposal-date']);
  });

  it('keeps findings apart', () => {
    const model = learnSignalLifts([
      ...outcomes('ghost-assets', [
        { codes: ['shared'], share: 1, times: 10 },
        { codes: ['other'], share: 0.1, times: 10 },
      ]),
      ...outcomes('freeport', [
        { codes: ['shared'], share: 0.1, times: 10 },
        { codes: ['other'], share: 1, times: 10 },
      ]),
    ]);
    const ghost = model.lifts.find(
      (one) => one.findingKey === 'ghost-assets' && one.code === 'shared',
    )!;
    const freeport = model.lifts.find(
      (one) => one.findingKey === 'freeport' && one.code === 'shared',
    )!;
    expect(ghost.lift).toBeGreaterThan(0);
    expect(freeport.lift).toBeLessThan(0);
  });

  it('drops shares that are not fractions', () => {
    const model = learnSignalLifts([
      { findingKey: 'ghost-assets', signals: [sig('a')], share: Number.NaN },
      { findingKey: 'ghost-assets', signals: [sig('a')], share: 1.4 },
      { findingKey: 'ghost-assets', signals: [sig('a')], share: 0.5 },
    ]);
    expect(model.observations).toBe(1);
  });

  it('is empty on no outcomes at all', () => {
    const model = learnSignalLifts([]);
    expect(model).toEqual({ lifts: [], observations: 0, published: 0 });
  });
});

describe('liftFor', () => {
  const model = learnSignalLifts(
    outcomes('ghost-assets', [
      { codes: ['strong'], share: 1, times: 20 },
      { codes: ['mild'], share: 0.62, times: 20 },
      { codes: ['weak'], share: 0.1, times: 20 },
    ]),
  );

  it('gives a row nothing when it carries no measured signal', () => {
    expect(liftFor(model.lifts, 'ghost-assets', [sig('unseen')])).toBeNull();
  });

  it('gives a row nothing for a finding that was never measured', () => {
    expect(liftFor(model.lifts, 'freeport', [sig('strong')])).toBeNull();
  });

  it('takes the largest single lift, never the sum', () => {
    const strong = liftFor(model.lifts, 'ghost-assets', [sig('strong')])!;
    const both = liftFor(model.lifts, 'ghost-assets', [sig('strong'), sig('mild')])!;
    expect(both.code).toBe('strong');
    expect(both.lift).toBe(strong.lift);
  });

  it('lets a signal the district punishes outweigh one it rewards', () => {
    const applied = liftFor(model.lifts, 'ghost-assets', [sig('mild'), sig('weak')])!;
    expect(applied.code).toBe('weak');
    expect(applied.lift).toBeLessThan(0);
  });

  it('never returns an unpublished lift', () => {
    const thin = learnSignalLifts(
      outcomes('ghost-assets', [
        { codes: ['rare'], share: 1, times: 2 },
        { codes: ['common'], share: 0.2, times: 20 },
      ]),
    );
    expect(liftFor(thin.lifts, 'ghost-assets', [sig('rare')])).toBeNull();
  });
});

describe('adjustAcceptance', () => {
  it('leaves the rate alone when nothing was measured', () => {
    expect(adjustAcceptance(0.62, null)).toBe(0.62);
  });

  it('moves in log-odds, so it cannot push a rate past certainty', () => {
    const up = { code: 'a', label: 'a', lift: MAX_LIFT, basis: '' };
    expect(adjustAcceptance(0.95, up)).toBeLessThan(0.99);
    expect(adjustAcceptance(0.95, up)).toBeGreaterThan(0.95);
  });

  it('moves a middling rate by a recognisable amount', () => {
    const applied = adjustAcceptance(0.5, { code: 'a', label: 'a', lift: 1, basis: '' });
    expect(applied).toBeCloseTo(0.731, 2);
  });

  it('is symmetric in the sign of the lift', () => {
    const up = adjustAcceptance(0.5, { code: 'a', label: 'a', lift: 0.8, basis: '' });
    const down = adjustAcceptance(0.5, { code: 'a', label: 'a', lift: -0.8, basis: '' });
    expect(up + down).toBeCloseTo(1, 6);
  });
});
