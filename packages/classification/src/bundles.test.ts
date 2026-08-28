import { describe, expect, it } from 'vitest';
import { bundledComponents, includedComponents } from './bundles.js';

describe('reading a purchase for what is riding along inside it', () => {
  it('names the non-property cost and why it is not property', () => {
    const signals = bundledComponents('POS system implementation and staff training');
    expect(signals).toHaveLength(1);
    expect(signals[0]!.exclusionKey).toBe('excluded-intangible');
    expect(signals[0]!.basis).toContain('Software licences');
  });

  it('makes one argument per exclusion, not one per word', () => {
    const signals = bundledComponents('software licence, consulting, training, data migration');
    expect(signals).toHaveLength(1);
  });

  it('separates the three exclusions when a line spans them', () => {
    const signals = bundledComponents('Leased chiller, roof penetration, and software licence');
    expect(signals.map((s) => s.exclusionKey).sort()).toEqual([
      'excluded-intangible',
      'excluded-leased-in',
      'excluded-real-property',
    ]);
  });

  // The check that keeps it from firing on every register: substrings are not
  // matches. "Release" is not a lease.
  it('matches words rather than substrings', () => {
    expect(bundledComponents('Press release printer')).toHaveLength(0);
    expect(bundledComponents('Roofing nailer, pneumatic')).toHaveLength(0);
  });

  it('says nothing about a plain description', () => {
    expect(bundledComponents('Hobart mixer, 60 quart')).toEqual([]);
    expect(bundledComponents(null)).toEqual([]);
  });

  it('names the costs that stay in and does not confuse them with levers', () => {
    const line = 'CNC lathe including freight and installation';
    expect(bundledComponents(line)).toEqual([]);
    const included = includedComponents(line);
    expect(included.map((s) => s.phrase).sort()).toEqual(['freight', 'installation']);
    expect(included[0]!.note).toContain('stays in the reported cost');
  });
});
