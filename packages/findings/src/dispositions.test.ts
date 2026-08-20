import { describe, expect, it } from 'vitest';
import { hasMoved, resolveDisposition, type DispositionRecord } from './dispositions.js';

function record(overrides: Partial<DispositionRecord> = {}): DispositionRecord {
  return {
    status: 'accepted',
    note: null,
    decidedBy: 'krishna@proxiagent.ai',
    decidedAt: new Date('2026-03-14T09:00:00.000Z'),
    decidedCost: 96_000,
    decidedValue: 40_000,
    decidedSetId: 'set-1',
    ...overrides,
  };
}

describe('hasMoved', () => {
  it('ignores the cents a new register row moves every total by', () => {
    expect(hasMoved(96_000, 96_000.4)).toBe(false);
  });

  it('tolerates a percent', () => {
    expect(hasMoved(100_000, 100_900)).toBe(false);
    expect(hasMoved(100_000, 101_500)).toBe(true);
  });

  it('floors the tolerance at a dollar, so small figures still move', () => {
    expect(hasMoved(10, 12)).toBe(true);
    expect(hasMoved(10, 10.5)).toBe(false);
  });

  it('treats becoming priced, or stopping being priced, as a move', () => {
    expect(hasMoved(null, 40_000)).toBe(true);
    expect(hasMoved(40_000, null)).toBe(true);
    expect(hasMoved(null, null)).toBe(false);
  });
});

describe('resolveDisposition', () => {
  it('is null when nobody has decided', () => {
    expect(resolveDisposition({ setId: 'set-1', cost: 1, value: 1 }, null)).toBeNull();
  });

  it('is not carried on the set it was decided against', () => {
    const resolved = resolveDisposition(
      { setId: 'set-1', cost: 96_000, value: 40_000 },
      record(),
    );

    expect(resolved?.isCarried).toBe(false);
    expect(resolved?.hasMovedSinceDecision).toBe(false);
  });

  it('is carried onto a later set, and flags the numbers that moved', () => {
    const resolved = resolveDisposition(
      { setId: 'set-2', cost: 184_000, value: 80_000 },
      record(),
    );

    expect(resolved?.isCarried).toBe(true);
    expect(resolved?.hasMovedSinceDecision).toBe(true);
    // The decision itself still stands — it is the client's, not ours to revoke.
    expect(resolved?.status).toBe('accepted');
    expect(resolved?.decidedCost).toBe(96_000);
  });

  it('carries quietly when the figures have not really moved', () => {
    const resolved = resolveDisposition(
      { setId: 'set-2', cost: 96_120, value: 40_050 },
      record(),
    );

    expect(resolved?.isCarried).toBe(true);
    expect(resolved?.hasMovedSinceDecision).toBe(false);
  });

  it('counts a decision whose set has been deleted as carried', () => {
    const resolved = resolveDisposition(
      { setId: 'set-2', cost: 96_000, value: 40_000 },
      record({ decidedSetId: null }),
    );

    expect(resolved?.isCarried).toBe(true);
  });

  it('normalizes the decision timestamp to an ISO string', () => {
    const resolved = resolveDisposition({ setId: 'set-1', cost: 1, value: 1 }, record());

    expect(resolved?.decidedAt).toBe('2026-03-14T09:00:00.000Z');
  });
});
