import { describe, expect, it } from 'vitest';
import {
  buildSourceIndex,
  gatherAll,
  gatherEvidence,
  matchIndexed,
  matchOne,
  type ExternalRecord,
  type RegisterSubject,
  type SourceExport,
} from './match.js';
import { EMPTY_COLUMN_MAP, mappingIsUsable, proposeColumns } from './columns.js';

/**
 * The index exists to make the matcher fast, so the only test that matters is
 * that it did not also make it different. Everything below builds a register
 * and an export with enough near-misses in them to exercise every method, then
 * asserts the two implementations agree row for row.
 */
const NOUNS = ['pump', 'chiller', 'lathe', 'conveyor', 'laptop', 'server', 'press', 'forklift'];
const ADJS = ['centrifugal', 'rooftop', 'hydraulic', 'spare', 'refurbished', 'primary'];

/** Deterministic, so a failure is a failure and not a seed. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function corpus(count: number, seed: number) {
  const next = rng(seed);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)]!;
  const subjects: RegisterSubject[] = [];
  const records: ExternalRecord[] = [];

  for (let i = 0; i < count; i++) {
    const noun = pick(NOUNS);
    const adj = pick(ADJS);
    const cost = Math.round(next() * 90_000) + 1_000;
    subjects.push({
      assetId: `a${i}`,
      // A third carry a tag, a third a serial, and some carry the placeholder
      // junk a real register is full of.
      assetTag: next() < 0.3 ? `TAG-${i % 40}` : next() < 0.1 ? '--' : null,
      serial: next() < 0.3 ? `sn${i % 55}` : null,
      model: next() < 0.4 ? `${noun}-${i % 12}` : null,
      description: `${adj} ${noun} unit ${i % 30}`,
      originalCost: cost,
      categoryKey: 'machinery-equipment',
    });
    records.push({
      recordId: `r${i}`,
      assetTag: next() < 0.35 ? `tag ${i % 40}` : next() < 0.1 ? 'n/a' : null,
      serial: next() < 0.35 ? `SN-${i % 55}` : null,
      model: next() < 0.4 ? `${pick(NOUNS)}-${i % 12}` : null,
      description: `${pick(ADJS)} ${pick(NOUNS)} unit ${i % 30}`,
      amount: next() < 0.5 ? Math.round(next() * 90_000) + 1_000 : null,
      lastSeenOn: '2026-03-04',
    });
  }
  return { subjects, records };
}

describe('the indexed matcher', () => {
  const { subjects, records } = corpus(400, 20260827);
  const source: SourceExport = { kind: 'cmms', records };

  it('returns exactly what the linear scan returns, row for row', () => {
    const index = buildSourceIndex(source);
    let matched = 0;
    for (const subject of subjects) {
      const scanned = matchOne(subject, 'cmms', records);
      const indexed = matchIndexed(subject, index);
      expect(indexed).toEqual(scanned);
      if (scanned) matched += 1;
    }
    // A test where nothing matched would pass for the wrong reason.
    expect(matched).toBeGreaterThan(50);
  });

  it('agrees with gatherEvidence on matches, negatives and silence', () => {
    const exports: SourceExport[] = [
      source,
      { kind: 'lease-subledger', records: records.slice(0, 8) },
    ];
    const all = gatherAll(subjects, exports);
    subjects.forEach((subject, i) => {
      expect(all[i]).toEqual(gatherEvidence(subject, exports));
    });
    // The eight-record lease export is under the threshold, so it is silent
    // rather than denying — the case the whole negative-statement rule exists
    // for, and it has to survive the rewrite.
    expect(all.some((r) => r.silent.includes('lease-subledger'))).toBe(true);
    expect(all.every((r) => r.negatives.every((n) => n.source !== 'lease-subledger'))).toBe(true);
  });

  it('never matches two placeholders to each other', () => {
    const junk: RegisterSubject = {
      assetId: 'junk',
      assetTag: '--',
      serial: 'N/A',
      model: null,
      description: null,
      originalCost: 500,
      categoryKey: 'machinery-equipment',
    };
    const placeholders: ExternalRecord[] = [
      {
        recordId: 'p1',
        assetTag: '-',
        serial: '-',
        model: null,
        description: null,
        amount: null,
        lastSeenOn: null,
      },
    ];
    expect(matchOne(junk, 'cmms', placeholders)).toBeNull();
    expect(
      matchIndexed(junk, buildSourceIndex({ kind: 'cmms', records: placeholders })),
    ).toBeNull();
  });
});

describe('reading an export header', () => {
  it('finds the six fields under the names systems actually use', () => {
    const map = proposeColumns([
      'Work Order',
      'Asset Tag',
      'Serial Number',
      'Model',
      'Equipment Description',
      'Completed Date',
    ]);
    expect(map.assetTag).toBe(1);
    expect(map.serial).toBe(2);
    expect(map.model).toBe(3);
    expect(map.description).toBe(4);
    expect(map.lastSeenOn).toBe(5);
    expect(map.amount).toBeNull();
  });

  it('reads a service tag as a serial rather than as an asset tag', () => {
    // The greedy-global rule earning its keep: "tag" is the last phrase on the
    // asset-tag list and "service tag" is on the serial list, so the stronger
    // pair is settled first.
    const map = proposeColumns(['Device Name', 'Service Tag', 'Last Check In']);
    expect(map.serial).toBe(1);
    expect(map.assetTag).toBeNull();
    expect(map.description).toBe(0);
    expect(map.lastSeenOn).toBe(2);
  });

  it('never gives one column to two fields', () => {
    const map = proposeColumns(['Asset ID', 'Asset ID', 'Value']);
    expect(map.assetTag).toBe(0);
    expect(map.amount).toBe(2);
    const used = Object.values(map).filter((v): v is number => v !== null);
    expect(new Set(used).size).toBe(used.length);
  });

  it('refuses a mapping with nothing to match on', () => {
    expect(mappingIsUsable(EMPTY_COLUMN_MAP)).toBe(false);
    expect(mappingIsUsable({ ...EMPTY_COLUMN_MAP, amount: 2, lastSeenOn: 3 })).toBe(false);
    expect(mappingIsUsable({ ...EMPTY_COLUMN_MAP, description: 1 })).toBe(true);
  });
});
