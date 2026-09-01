import { describe, expect, it } from 'vitest';
import {
  MIN_MENTIONS,
  reviewBundleVocabulary,
  type SettledDescription,
} from './bundle-learning.js';

/**
 * The corpus is written by hand and is meant to read like a register that a
 * firm settled: a lot of ordinary taxable equipment, and a wording that keeps
 * turning up on the rows somebody excluded.
 */
const settle = (count: number, description: (n: number) => string, categoryKey: string) =>
  Array.from({ length: count }, (_, index) => ({
    description: description(index + 1),
    categoryKey,
  }));

/** Bulk taxable rows, so the base rate of an exclusion is realistically low. */
const background: SettledDescription[] = [
  ...settle(40, (n) => `Office chair model ${n}`, 'furniture-fixtures'),
  ...settle(30, (n) => `Hobart mixer ${n} quart`, 'machinery-equipment'),
  ...settle(20, (n) => `Dell tower workstation ${n}`, 'computer-equipment'),
];

describe('grading the bundle vocabulary against what the firm settled', () => {
  it('proposes a wording the record keeps settling as an exclusion', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(9, (n) => `Annual maintenance and support renewal ${n}`, 'excluded-intangible'),
    ]);
    expect(review.proposals).toHaveLength(1);
    const proposal = review.proposals[0]!;
    expect(proposal.exclusionKey).toBe('excluded-intangible');
    expect(proposal.support).toBe(9);
    expect(proposal.contradicting).toBe(0);
    expect(proposal.precision).toBeGreaterThan(0.7);
  });

  /**
   * The wordings never appear apart, so nothing in the record separates them.
   * One finding, named four ways, presented once and honest about the other
   * three.
   */
  it('folds wordings that fired on exactly the same rows into one proposal', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(9, (n) => `Annual maintenance and support renewal ${n}`, 'excluded-intangible'),
    ]);
    const proposal = review.proposals[0]!;
    expect(proposal.phrase).toBe('annual');
    expect(proposal.alternates.sort()).toEqual([
      'annual maintenance',
      'maintenance',
      'renewal',
      'support',
      'support renewal',
    ]);
  });

  it('separates two wordings that fired on different rows', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(8, (n) => `Escrow arrangement charge ${n}`, 'excluded-intangible'),
      ...settle(8, (n) => `Trademark assignment cost ${n}`, 'excluded-intangible'),
    ]);
    expect(review.proposals).toHaveLength(2);
    const wordings = review.proposals.map((row) => [row.phrase, ...row.alternates]);
    expect(wordings.some((group) => group.includes('escrow'))).toBe(true);
    expect(wordings.some((group) => group.includes('trademark'))).toBe(true);
    // And never in the same group: they never once appeared on the same row.
    expect(wordings.some((group) => group.includes('escrow') && group.includes('trademark'))).toBe(
      false,
    );
  });

  it('hands back a line to paste rather than changing anything', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(9, (n) => `Annual maintenance and support renewal ${n}`, 'excluded-intangible'),
    ]);
    expect(review.proposals[0]!.source).toBe(
      "{ match: 'annual', exclusionKey: 'excluded-intangible' },",
    );
  });

  /** A proposal the detector could not match would look like it worked. */
  it('only ever proposes phrases the detector can find again', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(9, (n) => `Annual maintenance and support renewal ${n}`, 'excluded-intangible'),
    ]);
    for (const proposal of review.proposals) {
      const sample = proposal.samples[0]!;
      expect(sample.toLowerCase()).toContain(proposal.phrase);
    }
  });

  it('stays silent below the mention floor', () => {
    const thin = reviewBundleVocabulary([
      ...background,
      ...settle(MIN_MENTIONS - 1, (n) => `Escrow arrangement fee ${n}`, 'excluded-intangible'),
    ]);
    expect(thin.proposals.some((row) => row.phrase === 'escrow')).toBe(false);
  });

  it('stays silent on a phrase the record disagrees about', () => {
    const mixed = reviewBundleVocabulary([
      ...background,
      ...settle(6, (n) => `Pallet racking bay ${n}`, 'excluded-real-property'),
      ...settle(10, (n) => `Pallet racking section ${n}`, 'machinery-equipment'),
    ]);
    expect(mixed.proposals.some((row) => row.phrase === 'racking')).toBe(false);
  });

  it('says nothing at all about an empty record', () => {
    const empty = reviewBundleVocabulary([]);
    expect(empty.proposals).toEqual([]);
    expect(empty.challenges).toEqual([]);
    expect(empty.observations).toBe(0);
  });

  it('never proposes a wording the vocabulary already covers', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(12, (n) => `Enterprise software licence renewal ${n}`, 'excluded-intangible'),
    ]);
    // "software" is already a term for this exclusion, so the phrases that
    // contain it are already said, however well they score.
    expect(review.proposals.some((row) => row.phrase.includes('software'))).toBe(false);
  });

  it('does propose a neighbouring wording the vocabulary does not cover', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(12, (n) => `Enterprise software licence renewal ${n}`, 'excluded-intangible'),
    ]);
    const proposal = review.proposals[0]!;
    expect([proposal.phrase, ...proposal.alternates]).toContain('enterprise');
  });

  it('counts the record it read, and how much of it was an exclusion at all', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(9, (n) => `Annual maintenance and support renewal ${n}`, 'excluded-intangible'),
    ]);
    expect(review.observations).toBe(99);
    expect(review.exclusionObservations).toBe(9);
    expect(review.baseRates['excluded-intangible']).toBeCloseTo(9 / 99, 5);
  });
});

describe('the costs that stay in', () => {
  /**
   * The case the whole withholding rule exists for: software rollouts really
   * are installations, so the record really does say "installation" predicts an
   * intangible — and publishing it would tell a preparer to strip the
   * installation cost of a lathe.
   */
  it('withholds a phrase that overlaps a cost which stays in the reported figure', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(10, (n) => `Platform installation project phase ${n}`, 'excluded-intangible'),
    ]);
    expect(review.proposals.some((row) => row.phrase.includes('installation'))).toBe(false);
    const held = review.withheld.find((row) => row.phrase.includes('installation'));
    expect(held).toBeDefined();
    expect(held!.collidesWith).toBe('installation');
    expect(held!.reason).toContain('understates a sworn return');
  });
});

describe('holding the hand-written terms up against the record', () => {
  it('challenges a term the record mostly disagrees with', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(14, (n) => `Structural steel rack frame ${n}`, 'machinery-equipment'),
      ...settle(1, (n) => `Structural slab repair ${n}`, 'excluded-real-property'),
    ]);
    const challenge = review.challenges.find((row) => row.phrase === 'structural');
    expect(challenge).toBeDefined();
    expect(challenge!.mentions).toBe(15);
    expect(challenge!.support).toBe(1);
    expect(challenge!.settledAs[0]!.categoryKey).toBe('machinery-equipment');
    expect(challenge!.basis).toContain('The signal is still true');
  });

  it('leaves a term alone when the record agrees with it', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(12, (n) => `Structural slab and footing ${n}`, 'excluded-real-property'),
    ]);
    expect(review.challenges.some((row) => row.phrase === 'structural')).toBe(false);
  });

  /** Silence is not disagreement. A word no register used is not a bad word. */
  it('reports an unseen term as unobserved rather than challenging it', () => {
    const review = reviewBundleVocabulary(background);
    expect(review.challenges).toEqual([]);
    expect(review.unobserved).toContain('capitalized interest');
    expect(review.unobserved).toContain('goodwill');
  });

  it('does not challenge a term on too little evidence', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(MIN_MENTIONS - 1, (n) => `Elevator inspection module ${n}`, 'machinery-equipment'),
    ]);
    expect(review.challenges.some((row) => row.phrase === 'elevator')).toBe(false);
    expect(review.unobserved).not.toContain('elevator');
  });

  it('ranks the worst-supported term first', () => {
    const review = reviewBundleVocabulary([
      ...background,
      ...settle(14, (n) => `Structural steel rack frame ${n}`, 'machinery-equipment'),
      ...settle(9, (n) => `Elevator platform lift unit ${n}`, 'machinery-equipment'),
      ...settle(3, (n) => `Elevator shaft slab work ${n}`, 'excluded-real-property'),
    ]);
    expect(review.challenges.map((row) => row.phrase)).toEqual(['structural', 'elevator']);
  });
});
