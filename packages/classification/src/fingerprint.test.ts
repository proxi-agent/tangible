import { describe, expect, it } from 'vitest';
import { dedupeKey, fingerprint, hasSomethingToClassify } from './fingerprint.js';

const input = (over: Partial<Parameters<typeof dedupeKey>[0]> = {}) => ({
  description: null,
  registerCategory: null,
  glAccount: null,
  usefulLife: null,
  ...over,
});

describe('fingerprint', () => {
  it('folds the ways a register writes the same asset', () => {
    const key = fingerprint('Dell Latitude 5420');
    expect(fingerprint('DELL LATITUDE 5420')).toBe(key);
    expect(fingerprint('  dell   latitude 5420  ')).toBe(key);
    expect(fingerprint('Dell/Latitude - 5420')).toBe(key);
    expect(fingerprint('Dell Latitude 5420.')).toBe(key);
  });

  it('does not fold away words a register actually added', () => {
    // "(Acct 1500)" is a real annotation, so it makes a different key and costs
    // one model call. That is the safe direction to be wrong in: the expensive
    // failure is a key that is too loose, not one that is too tight.
    expect(fingerprint('Dell Latitude 5420 (Acct 1500)')).toBe('dell latitude acct');
  });

  it('drops the tokens that make every row unique', () => {
    // Serials and asset tags are unique by construction: leave them in and
    // memory never hits, which quietly turns the moat off.
    expect(fingerprint('Laptop SN A4B812C9')).toBe('laptop sn');
    expect(fingerprint('Forklift #12345')).toBe('forklift');
    expect(fingerprint('Desk 2')).toBe('desk');
  });

  it('keeps short alphanumerics, which are what the asset is', () => {
    // "F150" is the truck. "R22" is the refrigerant. Neither is an identifier.
    expect(fingerprint('Ford F150 pickup')).toBe('ford f150 pickup');
    expect(fingerprint('R22 compressor')).toBe('r22 compressor');
  });

  it('folds accents rather than splitting one asset into two', () => {
    expect(fingerprint('Café table')).toBe(fingerprint('Cafe table'));
  });

  it('treats an ampersand as the word it stands for', () => {
    expect(fingerprint('Furniture & Fixtures')).toBe(fingerprint('Furniture and Fixtures'));
  });

  it('preserves word order, so the key stays readable', () => {
    expect(fingerprint('server rack')).toBe('server rack');
    expect(fingerprint('rack server')).toBe('rack server');
  });

  it('returns null when nothing classifiable survives', () => {
    // A key built from these would collide with every other meaningless row and
    // spread one decision across assets that have nothing in common.
    expect(fingerprint('12345')).toBeNull();
    expect(fingerprint('---')).toBeNull();
    expect(fingerprint('  ')).toBeNull();
    expect(fingerprint('')).toBeNull();
    expect(fingerprint(null)).toBeNull();
    expect(fingerprint('A')).toBeNull();
  });

  it('does not merge two genuinely different assets', () => {
    expect(fingerprint('Office chair')).not.toBe(fingerprint('Office desk'));
    expect(fingerprint('Delivery van')).not.toBe(fingerprint('Delivery rack'));
  });
});

describe('hasSomethingToClassify', () => {
  it('accepts any of the three signals', () => {
    expect(hasSomethingToClassify(input({ description: 'Lathe' }))).toBe(true);
    expect(hasSomethingToClassify(input({ registerCategory: 'Shop equipment' }))).toBe(true);
    expect(hasSomethingToClassify(input({ glAccount: '1540 - Machinery' }))).toBe(true);
  });

  it('rejects a row that says nothing about what it is', () => {
    expect(hasSomethingToClassify(input())).toBe(false);
    expect(hasSomethingToClassify(input({ description: '   ' }))).toBe(false);
  });
});

describe('dedupeKey', () => {
  it('collapses rows the model would be asked about identically', () => {
    const a = dedupeKey(input({ description: 'Office Chair', registerCategory: 'FF&E' }));
    const b = dedupeKey(input({ description: 'office chair', registerCategory: 'ff&e' }));
    expect(a).toBe(b);
  });

  it('separates the same words under different register categories', () => {
    // "Rack" under Computer Equipment is a server rack; under Warehouse
    // Fixtures it is shelving. One question, two right answers.
    const it1 = dedupeKey(input({ description: 'Rack', registerCategory: 'Computer Equipment' }));
    const it2 = dedupeKey(input({ description: 'Rack', registerCategory: 'Warehouse Fixtures' }));
    expect(it1).not.toBe(it2);
  });

  it('still groups rows whose descriptions differ only by serial', () => {
    const a = dedupeKey(input({ description: 'Laptop SN A4B812C9' }));
    const b = dedupeKey(input({ description: 'Laptop SN X9Y221D4' }));
    expect(a).toBe(b);
  });

  it('falls back to the raw text when nothing fingerprints', () => {
    // Two meaningless-but-different descriptions must not collapse into one
    // question whose single answer then lands on both.
    expect(dedupeKey(input({ description: '12345' }))).not.toBe(
      dedupeKey(input({ description: '99999' })),
    );
  });
});
