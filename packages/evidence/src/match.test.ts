import { describe, expect, it } from 'vitest';
import { gatherEvidence, matchOne, type ExternalRecord, type RegisterSubject } from './match.js';
import { evidenceSignals, negativeStatements } from './signals.js';

const record = (over: Partial<ExternalRecord> = {}): ExternalRecord => ({
  recordId: 'r1',
  assetTag: null,
  serial: null,
  model: null,
  description: null,
  amount: null,
  lastSeenOn: null,
  ...over,
});

const subject = (over: Partial<RegisterSubject> = {}): RegisterSubject => ({
  assetId: 'a1',
  assetTag: null,
  serial: null,
  model: null,
  description: null,
  originalCost: null,
  categoryKey: 'machinery-equipment',
  ...over,
});

/** Enough records that a negative statement is allowed to stand. */
const bulk = (n: number): ExternalRecord[] =>
  Array.from({ length: n }, (_, i) => record({ recordId: `bulk-${i}`, description: 'unrelated' }));

describe('matching carries its method', () => {
  it('prefers an identifier over a closer description', () => {
    const match = matchOne(
      subject({ assetTag: 'FA-1042', description: 'Hyster forklift 5000lb' }),
      'cmms',
      [
        record({ recordId: 'wo-9', description: 'Hyster forklift 5000lb' }),
        record({ recordId: 'wo-1', assetTag: 'fa 1042', description: 'unit 12' }),
      ],
    );
    expect(match?.method).toBe('asset-tag');
    expect(match?.recordId).toBe('wo-1');
    expect(match?.score).toBeGreaterThan(0.9);
  });

  it('scores a description match well below an identifier, and says what it compared', () => {
    const match = matchOne(subject({ description: 'Hyster forklift 5000lb' }), 'cmms', [
      record({ description: 'forklift Hyster 5000lb yard' }),
    ]);
    expect(match?.method).toBe('description');
    expect(match?.score).toBeLessThan(0.6);
    expect(match?.on).toContain('Hyster forklift');
  });

  it('will not match a model without the cost agreeing', () => {
    const near = matchOne(subject({ model: 'H50FT', originalCost: 42_000 }), 'cmms', [
      record({ model: 'H50FT', amount: 41_500 }),
    ]);
    expect(near?.method).toBe('model-and-cost');
    const far = matchOne(subject({ model: 'H50FT', originalCost: 42_000 }), 'cmms', [
      record({ model: 'H50FT', amount: 12_000 }),
    ]);
    expect(far).toBeNull();
  });

  it('returns one match per source however many records hit', () => {
    const found = gatherEvidence(subject({ assetTag: 'FA-1' }), [
      {
        kind: 'cmms',
        records: [
          record({ recordId: 'wo-1', assetTag: 'FA-1' }),
          record({ recordId: 'wo-2', assetTag: 'FA-1' }),
          record({ recordId: 'wo-3', assetTag: 'FA-1' }),
        ],
      },
    ]);
    expect(found.matches).toHaveLength(1);
  });
});

describe('absence, and the three things it can mean', () => {
  it('makes a negative statement when a covering source searched and found nothing', () => {
    const found = gatherEvidence(subject({ assetTag: 'FA-1' }), [
      { kind: 'cmms', records: bulk(60) },
    ]);
    expect(found.negatives).toHaveLength(1);
    expect(found.negatives[0]!.searched).toBe(60);
    expect(negativeStatements(found)[0]).toContain('No match found in maintenance system');
  });

  it('stays silent about an asset the source never covered', () => {
    // A desk is not in a maintenance system's scope, and reading its absence as
    // a ghost signal would flag every desk in the register.
    const found = gatherEvidence(subject({ categoryKey: 'furniture-fixtures' }), [
      { kind: 'cmms', records: bulk(60) },
    ]);
    expect(found.negatives).toHaveLength(0);
    expect(found.silent).toEqual(['cmms']);
  });

  it('refuses to assert a negative over a thin export', () => {
    const found = gatherEvidence(subject(), [{ kind: 'cmms', records: bulk(11) }]);
    expect(found.negatives).toHaveLength(0);
    expect(found.silent).toEqual(['cmms']);
  });

  it('never makes a negative statement from an insurance schedule', () => {
    // An SOV is built to a materiality threshold; everything under it is absent
    // and entirely real. This source's silence is designed to mean nothing.
    const found = gatherEvidence(subject(), [{ kind: 'insurance-sov', records: bulk(400) }]);
    expect(found.negatives).toHaveLength(0);
    expect(found.silent).toEqual(['insurance-sov']);
  });
});

describe('evidence moves findings in the direction the source supports', () => {
  it('clears a ghost when the maintenance system has seen the asset', () => {
    const found = gatherEvidence(subject({ assetTag: 'FA-1' }), [
      { kind: 'cmms', records: [record({ assetTag: 'FA-1', lastSeenOn: '2026-03-04' })] },
    ]);
    const signals = evidenceSignals(found, 'ghost-assets');
    expect(signals).toHaveLength(1);
    expect(signals[0]!.weight).toBeLessThan(0);
    expect(signals[0]!.detail).toContain('asset-tag');
    expect(signals[0]!.detail).toContain('2026-03-04');
  });

  it('strengthens a ghost when a covering system has never seen it', () => {
    const found = gatherEvidence(subject({ assetTag: 'FA-1' }), [
      { kind: 'cmms', records: bulk(60) },
    ]);
    const signals = evidenceSignals(found, 'ghost-assets');
    expect(signals[0]!.weight).toBeGreaterThan(0);
    // And by less than the match would have moved it the other way.
    expect(signals[0]!.weight).toBeLessThan(0.35);
  });

  it('kills a leased-asset finding when no lease covers the asset', () => {
    const found = gatherEvidence(subject({ assetTag: 'FA-1' }), [
      { kind: 'lease-subledger', records: bulk(60) },
    ]);
    const signals = evidenceSignals(found, 'leased-double-report');
    expect(signals[0]!.weight).toBeLessThan(-0.2);
  });

  it('says nothing about a finding the source has no view on', () => {
    const found = gatherEvidence(subject({ assetTag: 'FA-1' }), [
      { kind: 'cmms', records: [record({ assetTag: 'FA-1' })] },
    ]);
    expect(evidenceSignals(found, 'misclassification')).toEqual([]);
  });
});
