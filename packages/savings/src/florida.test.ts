import { describe, expect, it } from 'vitest';
import { ruleLine, rulesFor } from './assessability.js';
import { expectedRecovery, routeFor, routeAuthority, routeYears } from './recovery.js';

/**
 * Florida, as the savings engine sees it.
 *
 * The point of these tests is not that Florida works — it is that Texas is no
 * longer the default. Every assertion here has a Texas twin that answers
 * differently, and if a change ever makes the two agree, the abstraction has
 * quietly collapsed back into one state with a second name.
 */

describe('recovery routes are per state', () => {
  it('gives Texas its two 25.25 routes and Florida its refund', () => {
    expect(routeFor('ghost-assets', 'tx-harris')).toBe('c');
    expect(routeFor('ghost-assets', 'fl-miami-dade')).toBe('fl-refund');
    expect(routeAuthority('fl-refund')).toBe('s. 197.182, F.S.');
  });

  it('reaches no prior year in Florida for a rendition error', () => {
    // The (c-1) family. Texas wrote a remedy for "an error or omission in a
    // rendition"; Florida did not, and inventing one would put three years of
    // recovery behind a position with nothing under it.
    expect(routeFor('misclassification', 'tx-harris')).toBe('c-1');
    expect(routeFor('misclassification', 'fl-miami-dade')).toBeNull();
    expect(routeFor('non-assessable-cost', 'fl-miami-dade')).toBeNull();
  });

  it('leaves a state nobody has researched with no route at all', () => {
    expect(routeFor('ghost-assets', 'ga-fulton')).toBeNull();
    // And the default is still Texas, so every pre-Florida call site is unmoved.
    expect(routeFor('ghost-assets')).toBe('c');
  });

  it('counts the Florida window shorter than 25.25(c)', () => {
    expect(routeYears('c')).toBe(5);
    expect(routeYears('fl-refund')).toBe(3);
  });
});

describe('expected recovery in Florida', () => {
  const base = {
    findingKey: 'ghost-assets',
    taxYear: 2026,
    taxAtRisk: 10_000,
    confidence: 0.9,
    firstExposedYear: 2021,
  };

  it('is smaller than the Texas answer on the same facts', () => {
    const tx = expectedRecovery({ ...base, jurisdictionId: 'tx-harris' })!;
    const fl = expectedRecovery({ ...base, jurisdictionId: 'fl-miami-dade' })!;
    expect(tx.retroactive.route).toBe('c');
    expect(fl.retroactive.route).toBe('fl-refund');
    // Fewer years reachable and a steeper decay per year: both real, both for
    // reasons written down beside the constants.
    expect(fl.retroactive.years.length).toBeLessThan(tx.retroactive.years.length);
    expect(fl.expected).toBeLessThan(tx.expected);
    // The prospective year is the same in both — the difference is entirely
    // about which prior years a statute lets you reopen.
    expect(fl.prospective.expected).toBeCloseTo(tx.prospective.expected, 6);
  });

  it('collapses to the current year for a Florida misclassification', () => {
    const fl = expectedRecovery({
      ...base,
      findingKey: 'misclassification',
      jurisdictionId: 'fl-miami-dade',
    })!;
    expect(fl.retroactive.route).toBeNull();
    expect(fl.retroactive.expected).toBe(0);
    expect(fl.expected).toBeCloseTo(fl.prospective.expected, 6);
  });
});

describe('assessability rules are per state', () => {
  it('keeps inventory off the Florida roll and on the Texas one', () => {
    const description = 'Finished goods inventory held for resale';
    const tx = ruleLine(description, 'tx-harris');
    const fl = ruleLine(description, 'fl-miami-dade');
    expect(fl.treatment).toBe('non-assessable');
    expect(fl.authority).toContain('196.185');
    // Texas taxes inventory at full cost — there is no inventory rule in the
    // Texas list at all, so nothing recognizes the wording.
    expect(tx.treatment).not.toBe('non-assessable');
  });

  it('taxes a Florida tenant build-out rather than reading it as real property', () => {
    // Ordering is the whole test: "build-out" also matches the real-property
    // rule, and first-match-wins has to reach the leasehold rule first.
    const fl = ruleLine('Tenant build-out — concrete and framing', 'fl-broward');
    expect(fl.treatment).toBe('assessable');
    expect(fl.authority).toContain('DR-405');
  });

  it('still has a Florida real-property rule for costs that are only structural', () => {
    const fl = ruleLine('Foundation excavation and slab pour', 'fl-broward');
    expect(fl.treatment).toBe('non-assessable');
    expect(fl.authority).toContain('192.001(12)');
  });

  it('cites Florida statutes rather than the Texas Tax Code throughout', () => {
    for (const rule of rulesFor('fl-miami-dade')) {
      expect(rule.authority ?? '').not.toMatch(/Tax Code/);
    }
    expect(rulesFor('tx-harris').some((r) => /Tax Code/.test(r.authority ?? ''))).toBe(true);
  });
});
