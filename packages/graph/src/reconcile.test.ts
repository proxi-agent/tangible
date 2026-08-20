import { describe, expect, it } from 'vitest';
import type { AssetDraft } from '@tangible/far';
import { keyDrafts, naturalKeyFor } from './identity.js';
import { reconcile, type PriorAsset } from './reconcile.js';

function draft(over: Partial<AssetDraft> = {}): AssetDraft {
  return {
    sourceSheet: 'FAR',
    sourceRow: 1,
    assetTag: null,
    description: 'Haas VF-2SS vertical mill',
    category: null,
    glAccount: null,
    acquisitionDate: '2019-04-02',
    acquisitionYear: 2019,
    inServiceDate: null,
    originalCost: 185000,
    accumulatedDepreciation: null,
    netBookValue: null,
    quantity: null,
    serialNumber: null,
    entity: null,
    location: null,
    department: null,
    vendor: null,
    usefulLife: null,
    depreciationMethod: null,
    disposalDate: null,
    disposalIndicator: null,
    isDisposed: false,
    warnings: [],
    raw: [],
    ...over,
  };
}

/** A prior asset built from the draft that would have produced it. */
function prior(id: string, source: AssetDraft, over: Partial<PriorAsset> = {}): PriorAsset {
  const { key } = naturalKeyFor(source);
  return {
    id,
    naturalKey: key,
    ordinal: 0,
    isAbsent: false,
    isDisposed: source.isDisposed,
    values: {
      description: source.description,
      category: source.category,
      glAccount: source.glAccount,
      entity: source.entity,
      location: source.location,
      department: source.department,
      serialNumber: source.serialNumber,
      originalCost: source.originalCost,
      quantity: source.quantity,
      acquisitionDate: source.acquisitionDate,
      acquisitionYear: source.acquisitionYear,
      inServiceDate: source.inServiceDate,
      usefulLife: source.usefulLife,
      depreciationMethod: source.depreciationMethod,
      accumulatedDepreciation: source.accumulatedDepreciation,
      netBookValue: source.netBookValue,
    },
    ...over,
  };
}

describe('identity', () => {
  it('prefers the register’s own tag over the description', () => {
    const tagged = draft({ assetTag: 'A-1042' });
    expect(naturalKeyFor(tagged)).toEqual({ key: 'tag:a1042', basis: 'asset-tag' });
  });

  it('folds tag punctuation, case and leading zeros to one key', () => {
    const keys = ['A-1042', 'a1042', 'A 1042', '0001042'].map(
      (assetTag) => naturalKeyFor(draft({ assetTag })).key,
    );
    expect(new Set(keys.slice(0, 3)).size).toBe(1);
    // "0001042" folds to "1042", which is a different tag from "a1042" — the
    // letter is part of the identifier and must not be dropped.
    expect(keys[3]).toBe('tag:1042');
  });

  it('keeps Sage extensions apart: .001 and .002 are different assets', () => {
    const a = naturalKeyFor(draft({ assetTag: '1042.001' })).key;
    const b = naturalKeyFor(draft({ assetTag: '1042.002' })).key;
    expect(a).not.toBe(b);
  });

  it('falls back to description, cost and acquisition when there is no tag', () => {
    const { basis, key } = naturalKeyFor(draft());
    expect(basis).toBe('fingerprint');
    expect(key).toContain('haas vf 2ss vertical mill');
    expect(key).toContain('18500000');
  });

  it('treats cent-level float noise as the same asset', () => {
    const clean = naturalKeyFor(draft({ originalCost: 1200 })).key;
    const noisy = naturalKeyFor(draft({ originalCost: 1199.9999999998 })).key;
    expect(noisy).toBe(clean);
  });

  it('gives identical rows distinct ordinals so ten desks stay ten assets', () => {
    const desks = Array.from({ length: 10 }, (_, i) =>
      draft({ description: 'Task chair', originalCost: 450, sourceRow: i + 2 }),
    );
    const keyed = keyDrafts(desks);
    expect(new Set(keyed.map((k) => k.key)).size).toBe(1);
    expect(keyed.map((k) => k.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(keyed.every((k) => k.ambiguous)).toBe(true);
  });

  it('still identifies a row carrying nothing at all', () => {
    const blank = draft({
      description: null,
      originalCost: null,
      acquisitionDate: null,
      acquisitionYear: null,
    });
    expect(naturalKeyFor(blank).key).toBe('fp:~|~|~');
  });
});

describe('reconcile', () => {
  it('discovers every row on a first import', () => {
    const drafts = [draft(), draft({ description: 'Forklift', originalCost: 42500 })];
    const plan = reconcile({ priorAssets: [], drafts });

    expect(plan.counts).toMatchObject({ total: 2, new: 2, matched: 0, absent: 0, changed: 0 });
    expect(plan.events.every((e) => e.kind === 'discovered')).toBe(true);
    // A discovery has no asset id yet — the caller mints it on insert.
    expect(plan.events.every((e) => e.assetId === null && e.draftIndex !== null)).toBe(true);
  });

  it('matches an unchanged asset and writes no events at all', () => {
    const source = draft({ assetTag: 'A-1042' });
    const plan = reconcile({ priorAssets: [prior('asset-1', source)], drafts: [source] });

    expect(plan.counts).toMatchObject({ new: 0, matched: 1, changed: 0 });
    expect(plan.events).toEqual([]);
    expect(plan.resolutions[0]).toMatchObject({ assetId: 'asset-1', matchMethod: 'asset-tag' });
  });

  it('records a cost restatement as a field change on the same asset', () => {
    const before = draft({ assetTag: 'A-1042', originalCost: 185000 });
    const after = draft({ assetTag: 'A-1042', originalCost: 172400 });
    const plan = reconcile({ priorAssets: [prior('asset-1', before)], drafts: [after] });

    expect(plan.counts.changed).toBe(1);
    const [event] = plan.events;
    expect(event).toMatchObject({
      assetId: 'asset-1',
      kind: 'field-changed',
      field: 'originalCost',
      previousValue: '185000',
      value: '172400',
      significance: 'material',
    });
    expect(event?.summary).toBe('Original cost down from $185,000 to $172,400');
  });

  it('ignores float noise in money but not a real cent difference', () => {
    const before = draft({ assetTag: 'A-1', originalCost: 1200 });
    const noise = reconcile({
      priorAssets: [prior('asset-1', before)],
      drafts: [draft({ assetTag: 'A-1', originalCost: 1199.9999999998 })],
    });
    expect(noise.events).toEqual([]);

    const real = reconcile({
      priorAssets: [prior('asset-1', before)],
      drafts: [draft({ assetTag: 'A-1', originalCost: 1199.5 })],
    });
    expect(real.events).toHaveLength(1);
  });

  /**
   * The rule that keeps the history readable. Book depreciation moves on every
   * asset every year; if those changes counted as material, the first real
   * import of a 4,000-row register would bury every restatement worth seeing.
   */
  it('marks book depreciation routine and does not count it as a change', () => {
    const before = draft({
      assetTag: 'A-1042',
      accumulatedDepreciation: 40000,
      netBookValue: 145000,
    });
    const after = draft({
      assetTag: 'A-1042',
      accumulatedDepreciation: 58500,
      netBookValue: 126500,
    });
    const plan = reconcile({ priorAssets: [prior('asset-1', before)], drafts: [after] });

    expect(plan.events).toHaveLength(2);
    expect(plan.events.every((e) => e.significance === 'routine')).toBe(true);
    expect(plan.counts.changed).toBe(0);
  });

  it('records a move as a location change rather than a new asset', () => {
    const before = draft({ assetTag: 'A-1042', location: 'Houston Plant 2' });
    const after = draft({ assetTag: 'A-1042', location: 'Dallas DC' });
    const plan = reconcile({ priorAssets: [prior('asset-1', before)], drafts: [after] });

    expect(plan.counts.new).toBe(0);
    expect(plan.events[0]).toMatchObject({ field: 'location', significance: 'material' });
    expect(plan.events[0]?.summary).toBe('Location changed from Houston Plant 2 to Dallas DC');
  });

  it('emits a disposal event when the register starts marking it disposed', () => {
    const before = draft({ assetTag: 'A-1042' });
    const after = draft({ assetTag: 'A-1042', isDisposed: true, disposalDate: '2026-09-14' });
    const plan = reconcile({ priorAssets: [prior('asset-1', before)], drafts: [after] });

    expect(plan.events.map((e) => e.kind)).toContain('disposed');
    expect(plan.events.find((e) => e.kind === 'disposed')?.summary).toBe(
      'Marked disposed on the register (2026-09-14)',
    );
  });

  it('emits undisposed when a disposal mark is taken back off', () => {
    const before = draft({ assetTag: 'A-1042', isDisposed: true, disposalDate: '2026-09-14' });
    const after = draft({ assetTag: 'A-1042' });
    const plan = reconcile({ priorAssets: [prior('asset-1', before)], drafts: [after] });

    expect(plan.events.map((e) => e.kind)).toContain('undisposed');
  });

  /**
   * The load-bearing judgement in this file. A row that stops appearing may be
   * an untracked retirement — real money — or an export run with a filter on.
   * The file cannot tell them apart, so neither does the event.
   */
  it('calls a vanished row absent, never disposed', () => {
    const gone = draft({ assetTag: 'A-1042' });
    const plan = reconcile({
      priorAssets: [prior('asset-1', gone)],
      drafts: [draft({ assetTag: 'B-2000', description: 'Forklift' })],
    });

    expect(plan.counts.absent).toBe(1);
    expect(plan.absent[0]?.id).toBe('asset-1');
    const event = plan.events.find((e) => e.assetId === 'asset-1');
    expect(event?.kind).toBe('absent');
    expect(event?.summary).toContain('never marked disposed');
    expect(plan.events.some((e) => e.kind === 'disposed')).toBe(false);
  });

  it('does not re-announce an asset that was already absent', () => {
    const gone = draft({ assetTag: 'A-1042' });
    const plan = reconcile({
      priorAssets: [prior('asset-1', gone, { isAbsent: true })],
      drafts: [],
    });

    expect(plan.counts.absent).toBe(1);
    expect(plan.events).toEqual([]);
  });

  it('says so when an absent asset comes back', () => {
    const source = draft({ assetTag: 'A-1042' });
    const plan = reconcile({
      priorAssets: [prior('asset-1', source, { isAbsent: true })],
      drafts: [source],
    });

    expect(plan.events.map((e) => e.kind)).toEqual(['reappeared']);
  });

  it('separates the fungible case: two of ten desks leaving is two absences', () => {
    const desk = (row: number) =>
      draft({ description: 'Task chair', originalCost: 450, sourceRow: row });
    const priors = Array.from({ length: 10 }, (_, i) => ({
      ...prior(`desk-${i}`, desk(i + 2)),
      ordinal: i,
    }));

    const plan = reconcile({
      priorAssets: priors,
      drafts: Array.from({ length: 8 }, (_, i) => desk(i + 2)),
    });

    expect(plan.counts).toMatchObject({ new: 0, matched: 8, absent: 2 });
    // The highest ordinals go absent, and the match is recorded as the weaker
    // ordinal match rather than passed off as a clean fingerprint hit.
    expect(plan.absent.map((a) => a.id)).toEqual(['desk-8', 'desk-9']);
    expect(plan.resolutions.every((r) => r.matchMethod === 'fingerprint-ordinal')).toBe(true);
  });

  it('records a clean fingerprint match as fingerprint, not ordinal', () => {
    const source = draft();
    const plan = reconcile({ priorAssets: [prior('asset-1', source)], drafts: [source] });
    expect(plan.resolutions[0]?.matchMethod).toBe('fingerprint');
  });

  /**
   * A description edit under a stable tag is a rename. Without the tag it is a
   * different fingerprint and therefore a new asset plus an absence — which is
   * the honest answer, since nothing in the file connects them.
   */
  it('follows a renamed asset by tag, and cannot follow one without', () => {
    const before = draft({ assetTag: 'A-1042', description: 'Mill' });
    const renamed = draft({ assetTag: 'A-1042', description: 'Haas VF-2SS mill' });
    const tagged = reconcile({ priorAssets: [prior('asset-1', before)], drafts: [renamed] });
    expect(tagged.counts).toMatchObject({ new: 0, matched: 1, absent: 0 });

    const untagged = reconcile({
      priorAssets: [prior('asset-1', draft({ description: 'Mill' }))],
      drafts: [draft({ description: 'Haas VF-2SS mill' })],
    });
    expect(untagged.counts).toMatchObject({ new: 1, matched: 0, absent: 1 });
  });
});
