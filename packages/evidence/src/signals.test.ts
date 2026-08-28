import { describe, expect, it } from 'vitest';
import { gatherEvidence, type ExternalRecord, type RegisterSubject } from './match.js';
import { evidenceSignals } from './signals.js';

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
  assetTag: 'FA-1042',
  serial: null,
  model: null,
  description: 'Hyster forklift 5000lb',
  originalCost: null,
  categoryKey: 'machinery-equipment',
  ...over,
});

const bulk = (n: number, kind: string): ExternalRecord[] =>
  Array.from({ length: n }, (_, i) =>
    record({ recordId: `${kind}-${i}`, description: 'unrelated' }),
  );

const weightOf = (code: string, source: Parameters<typeof gatherEvidence>[1]) => {
  const signals = evidenceSignals(gatherEvidence(subject(), source), 'ghost-assets');
  const signal = signals.find((s) => s.code === code);
  if (!signal) throw new Error(`expected a ${code} signal, got ${signals.map((s) => s.code)}`);
  return signal.weight;
};

describe('what a physical count is worth', () => {
  /**
   * The count is the one source whose silence is set above its speech before the
   * match score scales it — and the package-wide rule that a negative never
   * overtakes a positive of the same source still holds afterwards. Both halves
   * are pinned here, because the first is the reason to take a count and the
   * second is what keeps a missed scan from reading as proof.
   */
  it('weighs an empty count heavily, but still under a scan that found it', () => {
    const found = weightOf('evidence-physical-inventory', [
      {
        kind: 'physical-inventory',
        records: [
          ...bulk(60, 'scan'),
          record({ recordId: 'scan-hit', assetTag: 'FA-1042', lastSeenOn: '2026-06-02' }),
        ],
      },
    ]);
    const missing = weightOf('evidence-physical-inventory-none', [
      { kind: 'physical-inventory', records: bulk(60, 'scan') },
    ]);

    expect(found).toBeLessThan(0);
    expect(missing).toBeGreaterThan(0);
    expect(missing).toBeLessThan(Math.abs(found));
  });

  it('outweighs every other source that can only infer', () => {
    const count = weightOf('evidence-physical-inventory-none', [
      { kind: 'physical-inventory', records: bulk(60, 'scan') },
    ]);
    const maintenance = weightOf('evidence-cmms-none', [{ kind: 'cmms', records: bulk(60, 'wo') }]);
    expect(count).toBeGreaterThan(maintenance);
  });

  // A count lists what carries a tag. The build-out does not, so its absence
  // from a scan file has to stay silent rather than become a finding.
  it('stays silent about improvements nobody tags', () => {
    const evidence = gatherEvidence(subject({ categoryKey: 'leasehold-improvements' }), [
      { kind: 'physical-inventory', records: bulk(60, 'scan') },
    ]);
    expect(evidence.silent).toEqual(['physical-inventory']);
    expect(evidence.negatives).toEqual([]);
  });
});
