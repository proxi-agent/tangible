import { describe, expect, it } from 'vitest';
import type { EngineFact } from '@tangible/types';
import { diffEngineFacts, renderDigest, FIRM_FACTOR, MOVE_THRESHOLD } from './digest.js';

const WINDOW = { since: '2026-08-25T00:00:00.000Z', until: '2026-09-01T00:00:00.000Z' };

function fact(overrides: Partial<EngineFact> & Pick<EngineFact, 'id'>): EngineFact {
  return {
    kind: 'acceptance',
    subject: 'Ghost assets in Harris County',
    inForce: false,
    value: 0.5,
    observations: 3,
    basis: 'Three closed positions.',
    href: '/quality',
    ...overrides,
  };
}

describe('diffEngineFacts', () => {
  it('reports nothing when nothing moved', () => {
    const facts = [fact({ id: 'a' }), fact({ id: 'b', inForce: true, observations: 40 })];
    const digest = diffEngineFacts(facts, facts, WINDOW);
    expect(digest.changes).toEqual([]);
    expect(digest.material).toBe(false);
    expect(digest.facts).toBe(2);
    expect(digest.inForce).toBe(1);
  });

  it('calls a fact that entered use a crossing, and weights it to act', () => {
    const digest = diffEngineFacts(
      [fact({ id: 'a', inForce: false, observations: 4 })],
      [fact({ id: 'a', inForce: true, observations: 6 })],
      WINDOW,
    );
    expect(digest.changes).toHaveLength(1);
    expect(digest.changes[0]!.kind).toBe('crossed');
    expect(digest.changes[0]!.weight).toBe('act');
    expect(digest.material).toBe(true);
  });

  /**
   * The direction that should alarm somebody. A published rate that stops being
   * published means the report has quietly gone back to the built-in constant,
   * and the only way that happens is a voided claim removing evidence.
   */
  it('calls a fact that left use a withdrawal, and still weights it to act', () => {
    const digest = diffEngineFacts(
      [fact({ id: 'a', inForce: true, observations: 6 })],
      [fact({ id: 'a', inForce: false, observations: 4 })],
      WINDOW,
    );
    expect(digest.changes[0]!.kind).toBe('withdrawn');
    expect(digest.changes[0]!.weight).toBe('act');
  });

  it('treats a fact that vanished from the corpus as a withdrawal too', () => {
    const digest = diffEngineFacts([fact({ id: 'a', inForce: true })], [], WINDOW);
    expect(digest.changes).toHaveLength(1);
    expect(digest.changes[0]!.kind).toBe('withdrawn');
    expect(digest.changes[0]!.weight).toBe('act');
    expect(digest.changes[0]!.fact.observations).toBe(0);
    expect(digest.changes[0]!.before).toEqual({ inForce: true, value: 0.5, observations: 3 });
  });

  it('does not raise a vanished proposal above a note', () => {
    const digest = diffEngineFacts([fact({ id: 'a', inForce: false })], [], WINDOW);
    expect(digest.changes[0]!.weight).toBe('note');
    expect(digest.material).toBe(false);
  });

  it('reports a new fact as appeared, and only mails it when it is in use', () => {
    const quiet = diffEngineFacts([], [fact({ id: 'a', inForce: false })], WINDOW);
    expect(quiet.changes[0]!.kind).toBe('appeared');
    expect(quiet.changes[0]!.weight).toBe('note');
    expect(quiet.material).toBe(false);

    const loud = diffEngineFacts([], [fact({ id: 'a', inForce: true })], WINDOW);
    expect(loud.changes[0]!.weight).toBe('read');
    expect(loud.material).toBe(true);
  });

  it('ignores movement under the threshold and reports it over', () => {
    const before = [fact({ id: 'a', inForce: true, value: 0.5, observations: 40 })];
    const small = diffEngineFacts(
      before,
      [fact({ id: 'a', inForce: true, value: 0.5 + MOVE_THRESHOLD / 2, observations: 40 })],
      WINDOW,
    );
    expect(small.changes).toEqual([]);

    const large = diffEngineFacts(
      before,
      [fact({ id: 'a', inForce: true, value: 0.5 + MOVE_THRESHOLD, observations: 40 })],
      WINDOW,
    );
    expect(large.changes[0]!.kind).toBe('moved');
    expect(large.changes[0]!.weight).toBe('read');
  });

  /**
   * A crossing that also moved the number is one event, and it is the crossing.
   * Reporting both would put the same fact in the mail twice under two verbs.
   */
  it('prefers the crossing when a fact both crossed and moved', () => {
    const digest = diffEngineFacts(
      [fact({ id: 'a', inForce: false, value: 0.4, observations: 4 })],
      [fact({ id: 'a', inForce: true, value: 0.9, observations: 6 })],
      WINDOW,
    );
    expect(digest.changes).toHaveLength(1);
    expect(digest.changes[0]!.kind).toBe('crossed');
  });

  it('says a fact firmed only once the evidence grew by the factor, and never mails it', () => {
    const before = [fact({ id: 'a', inForce: true, observations: 10 })];
    const nudged = diffEngineFacts(
      before,
      [fact({ id: 'a', inForce: true, observations: Math.ceil(10 * FIRM_FACTOR) - 1 })],
      WINDOW,
    );
    expect(nudged.changes).toEqual([]);

    const grown = diffEngineFacts(
      before,
      [fact({ id: 'a', inForce: true, observations: 10 * FIRM_FACTOR })],
      WINDOW,
    );
    expect(grown.changes[0]!.kind).toBe('firmed');
    expect(grown.changes[0]!.weight).toBe('note');
    expect(grown.material).toBe(false);
  });

  /**
   * A rate that clears its bar starts multiplying into a client's number by
   * itself; a phrase that clears its bar starts waiting for a person. Both are
   * `crossed` and both are `act`, and the sentence has to say which happened or
   * the mail reads as though the software changed when it did not.
   */
  it('says what a crossing means in the words of the kind that crossed', () => {
    const rate = diffEngineFacts(
      [fact({ id: 'a', inForce: false })],
      [fact({ id: 'a', inForce: true })],
      WINDOW,
    );
    expect(rate.changes[0]!.headline).toContain('is now in use');

    const phrase = diffEngineFacts(
      [fact({ id: 'p', kind: 'bundle-term', subject: '"freight"', inForce: false })],
      [fact({ id: 'p', kind: 'bundle-term', subject: '"freight"', inForce: true })],
      WINDOW,
    );
    expect(phrase.changes[0]!.weight).toBe('act');
    expect(phrase.changes[0]!.headline).toContain('waiting for somebody to commit it');
    expect(phrase.changes[0]!.headline).not.toContain('in use');
  });

  /**
   * The crossing has the least evidence behind it of the three, which is the
   * point: sorting by weight before observations is what keeps the one change
   * that altered the software's behaviour above two that did not.
   */
  it('puts the actionable changes first regardless of the order they arrive', () => {
    const digest = diffEngineFacts(
      [
        fact({ id: 'moved', inForce: true, value: 0.2, observations: 30 }),
        fact({ id: 'crossed', inForce: false, observations: 4 }),
      ],
      [
        fact({ id: 'moved', inForce: true, value: 0.8, observations: 30 }),
        fact({ id: 'crossed', inForce: true, observations: 6 }),
        fact({ id: 'new', inForce: true, observations: 12 }),
      ],
      WINDOW,
    );
    expect(digest.changes.map((change) => [change.fact.id, change.kind])).toEqual([
      ['crossed', 'crossed'],
      ['moved', 'moved'],
      ['new', 'appeared'],
    ]);
  });
});

describe('renderDigest', () => {
  it('leaves notes out of the mail and keeps the rest', () => {
    const digest = diffEngineFacts(
      [
        fact({ id: 'a', inForce: false, observations: 4 }),
        fact({ id: 'b', subject: 'A phrase', inForce: false, observations: 10 }),
      ],
      [
        fact({ id: 'a', inForce: true, observations: 6 }),
        fact({ id: 'b', subject: 'A phrase', inForce: false, observations: 20 }),
      ],
      WINDOW,
    );
    const body = renderDigest(digest, 'https://example.test');

    expect(body).toContain('CHANGES WHAT THE SOFTWARE DOES');
    expect(body).toContain('Ghost assets in Harris County is now in use');
    expect(body).not.toContain('A phrase');
    expect(body).toContain('2026-08-25');
    expect(body).toContain('https://example.test/quality');
    expect(body).toContain('Proposals need somebody to commit them.');
  });

  it('omits a heading nothing fell under', () => {
    const digest = diffEngineFacts(
      [fact({ id: 'a', inForce: false, observations: 4 })],
      [fact({ id: 'a', inForce: true, observations: 6 })],
      WINDOW,
    );
    const body = renderDigest(digest, 'https://example.test');
    expect(body).toContain('CHANGES WHAT THE SOFTWARE DOES');
    expect(body).not.toContain('WORTH KNOWING');
  });
});
