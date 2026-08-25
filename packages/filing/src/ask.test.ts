import { describe, expect, it } from 'vitest';
import type { GraphAnswer, GraphDigest, GraphReference } from '@tangible/types';
import { sanitizeAnswer } from './ask.js';

const digest = {
  assets: [{ id: 'asset-1' }, { id: 'asset-2' }],
  season: { sites: [{ locationId: 'site-1' }] },
} as unknown as GraphDigest;

const answer = (references: GraphReference[], limits: string[] = []): GraphAnswer => ({
  answer: 'Some prose.',
  references,
  limits,
});

describe('sanitizeAnswer', () => {
  it('keeps references the digest can back', () => {
    const result = sanitizeAnswer(
      digest,
      answer([
        { kind: 'asset', id: 'asset-1', label: 'CNC lathe' },
        { kind: 'site', id: 'site-1', label: 'Houston Office' },
        { kind: 'report', id: null, label: 'Savings report' },
        { kind: 'returns', id: null, label: 'Season board' },
      ]),
    );
    expect(result.references).toHaveLength(4);
    expect(result.limits).toHaveLength(0);
  });

  it('drops an asset or site the record does not hold, and says so', () => {
    const result = sanitizeAnswer(
      digest,
      answer([
        { kind: 'asset', id: 'asset-9', label: 'Invented' },
        { kind: 'site', id: null, label: 'Nowhere' },
        { kind: 'asset', id: 'asset-2', label: 'Forklift' },
      ]),
    );
    expect(result.references.map((ref) => ref.id)).toEqual(['asset-2']);
    // Pruning a citation is a fact about the answer the reader is owed.
    expect(result.limits).toHaveLength(1);
    expect(result.limits[0]).toContain('2 references');
  });

  it('never appends the limit line when nothing was dropped', () => {
    const result = sanitizeAnswer(digest, answer([], ['a real limit']));
    expect(result.limits).toEqual(['a real limit']);
  });

  it('deduplicates repeats without counting them as dropped', () => {
    const result = sanitizeAnswer(
      digest,
      answer([
        { kind: 'asset', id: 'asset-1', label: 'CNC lathe' },
        { kind: 'asset', id: 'asset-1', label: 'CNC lathe again' },
        { kind: 'report', id: null, label: 'Report' },
        { kind: 'report', id: null, label: 'Report again' },
      ]),
    );
    expect(result.references).toHaveLength(2);
    expect(result.limits).toHaveLength(0);
  });

  it('strips the id a model invented for a singleton screen', () => {
    const result = sanitizeAnswer(
      digest,
      answer([{ kind: 'report', id: 'made-up', label: 'Savings report' }]),
    );
    expect(result.references).toEqual([{ kind: 'report', id: null, label: 'Savings report' }]);
  });
});
