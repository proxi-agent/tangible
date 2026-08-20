import { describe, expect, it } from 'vitest';
import {
  isComparable,
  isKnownLineMapping,
  lineTypeFingerprint,
  mapFromAi,
  mapFromHuman,
  mapFromMemory,
  mapFromSchedule,
  mapUnmappable,
  scheduleDecides,
} from './line-types.js';
import { fingerprint } from './fingerprint.js';

const confirmedAt = new Date('2026-03-11T00:00:00Z');

describe('scheduleDecides', () => {
  it('settles the four schedules whose meaning the form fixes', () => {
    expect(scheduleDecides('B')).toBe(true);
    expect(scheduleDecides('C')).toBe(true);
    expect(scheduleDecides('D')).toBe(true);
    expect(scheduleDecides('F')).toBe(true);
  });

  /**
   * E and A are the whole reason a model is involved. E is four of our
   * categories at once; A is an undifferentiated lump.
   */
  it('leaves the wording schedules to be read', () => {
    expect(scheduleDecides('E')).toBe(false);
    expect(scheduleDecides('A')).toBe(false);
  });
});

describe('mapFromSchedule', () => {
  it('maps supplies and inventory to the same full-cost category', () => {
    expect(mapFromSchedule('B', null)?.categoryKey).toBe('inventory');
    expect(mapFromSchedule('C', null)?.categoryKey).toBe('inventory');
  });

  it('maps Schedule D to licensed vehicles', () => {
    expect(mapFromSchedule('D', null)?.categoryKey).toBe('vehicles');
  });

  /** Schedule F is disclosure of somebody else's property, not the client's value. */
  it('maps Schedule F to leased-in and does not queue it', () => {
    const mapping = mapFromSchedule('F', null)!;
    expect(mapping.categoryKey).toBe('excluded-leased-in');
    expect(mapping.status).toBe('auto-accepted');
  });

  /**
   * An exclusion the *model* proposes always gets a person. An exclusion the
   * form itself states does not — there is nothing to weigh.
   */
  it('stands without review, unlike the same key from a model', () => {
    expect(mapFromSchedule('F', null)!.status).toBe('auto-accepted');
    expect(
      mapFromAi({ categoryKey: 'excluded-leased-in', confidence: 0.99, rationale: '' }, null)
        .status,
    ).toBe('needs-review');
  });

  it('returns nothing for a schedule that has to be read', () => {
    expect(mapFromSchedule('E', null)).toBeNull();
    expect(mapFromSchedule('A', null)).toBeNull();
  });
});

describe('lineTypeFingerprint', () => {
  it('folds the filer’s abbreviations onto one key', () => {
    expect(lineTypeFingerprint('E', 'Mach & Equip')).toBe('rendition:E:mach and equip');
    expect(lineTypeFingerprint('E', 'MACH  &  EQUIP.')).toBe('rendition:E:mach and equip');
  });

  /**
   * The same word means different property on different schedules, and replaying
   * one reading as the other is the silent, money-carrying error the whole
   * namespace exists to prevent.
   */
  it('keeps identical wording on different schedules apart', () => {
    expect(lineTypeFingerprint('D', 'Equipment')).not.toBe(lineTypeFingerprint('E', 'Equipment'));
  });

  /**
   * Asset descriptions and line wordings share `classification_memory`. They
   * cannot collide, and not by convention: the fold maps everything outside
   * [a-z0-9] to a space, so no asset description can ever produce a colon.
   */
  it('cannot collide with an asset description’s key', () => {
    expect(fingerprint('rendition: E: mach and equip')).toBe('rendition mach and equip');
    expect(fingerprint('rendition: E: mach and equip')).not.toContain(':');
  });

  it('has no key for wording that carries nothing', () => {
    expect(lineTypeFingerprint('E', '   ')).toBeNull();
    expect(lineTypeFingerprint('E', '1234')).toBeNull();
    expect(lineTypeFingerprint('E', null)).toBeNull();
  });
});

describe('mapFromAi', () => {
  it('lets a confident reading stand', () => {
    const mapping = mapFromAi(
      { categoryKey: 'machinery-equipment', confidence: 0.93, rationale: 'Shop machinery.' },
      'rendition:E:mach and equip',
    );
    expect(mapping.status).toBe('auto-accepted');
    expect(mapping.categoryKey).toBe('machinery-equipment');
  });

  it('queues a reading below the bar', () => {
    expect(
      mapFromAi({ categoryKey: 'machinery-equipment', confidence: 0.84, rationale: '' }, null)
        .status,
    ).toBe('needs-review');
  });

  /**
   * Taking cost off a filed return is the most valuable thing this can say and
   * the one that most needs a name on it, however sure the model is.
   */
  it('always queues an exclusion', () => {
    for (const key of ['excluded-real-property', 'excluded-intangible', 'excluded-leased-in']) {
      expect(mapFromAi({ categoryKey: key, confidence: 1, rationale: '' }, null).status).toBe(
        'needs-review',
      );
    }
  });

  /**
   * There is no split to be found in a number the form printed as one, so
   * queueing a blended line asks a reviewer to invent precision. It stands, and
   * the rollup carries it as unplaceable.
   */
  it('lets a confident blended reading stand rather than queueing it', () => {
    const mapping = mapFromAi(
      { categoryKey: 'mixed', confidence: 0.95, rationale: 'FF&E spans three categories.' },
      null,
    );
    expect(mapping.status).toBe('auto-accepted');
    expect(mapping.categoryKey).toBe('mixed');
  });

  it('queues a blended reading the model is unsure of, like any other', () => {
    expect(mapFromAi({ categoryKey: 'mixed', confidence: 0.4, rationale: '' }, null).status).toBe(
      'needs-review',
    );
  });

  it('refuses a key outside the vocabulary', () => {
    const mapping = mapFromAi({ categoryKey: 'ffe', confidence: 1, rationale: '' }, null);
    expect(mapping.categoryKey).toBeNull();
    expect(mapping.status).toBe('needs-review');
  });

  it('clamps a confidence outside 0..1', () => {
    expect(
      mapFromAi({ categoryKey: 'computer-pc', confidence: 1.4, rationale: '' }, null).confidence,
    ).toBe(1);
    expect(
      mapFromAi({ categoryKey: 'computer-pc', confidence: -2, rationale: '' }, null).confidence,
    ).toBe(0);
  });
});

describe('mapFromMemory', () => {
  const base = {
    fingerprint: 'rendition:E:mach and equip',
    categoryKey: 'machinery-equipment',
    confirmations: 3,
    conflicted: false,
    conflictingCategoryKey: null,
    lastConfirmedAt: confirmedAt,
  };

  it('replays a settled reading at full confidence', () => {
    const mapping = mapFromMemory(base);
    expect(mapping.status).toBe('auto-accepted');
    expect(mapping.confidence).toBe(1);
    expect(mapping.rationale).toContain('confirmed 3 times');
    expect(mapping.rationale).toContain('2026-03-11');
  });

  /** Two reviewers disagreeing means the wording is ambiguous, which is the case
   * where replaying somebody's answer would be worst. */
  it('queues a contested reading and shows both answers', () => {
    const mapping = mapFromMemory({
      ...base,
      conflicted: true,
      conflictingCategoryKey: 'computer-pc',
    });
    expect(mapping.status).toBe('needs-review');
    expect(mapping.rationale).toContain('Machinery and equipment');
    expect(mapping.rationale).toContain('Computer equipment (PC)');
  });

  it('remembers a blended reading as a blended reading', () => {
    const mapping = mapFromMemory({ ...base, categoryKey: 'mixed', confirmations: 1 });
    expect(mapping.status).toBe('auto-accepted');
    expect(mapping.rationale).toContain('Blended');
    expect(mapping.rationale).toContain('confirmed once');
  });

  it('queues a reading naming a category the district dropped', () => {
    const mapping = mapFromMemory({ ...base, categoryKey: 'antiques' });
    expect(mapping.categoryKey).toBeNull();
    expect(mapping.status).toBe('needs-review');
  });
});

describe('mapFromHuman', () => {
  it('is final and carries a readable default rationale', () => {
    const mapping = mapFromHuman('telecom-8', 'rendition:E:tele ntwk equip', null);
    expect(mapping.status).toBe('confirmed');
    expect(mapping.confidence).toBe(1);
    expect(mapping.rationale).toContain('Telecommunications equipment');
  });
});

describe('isComparable', () => {
  it('accepts a settled category', () => {
    expect(isComparable({ categoryKey: 'furniture-fixtures', status: 'auto-accepted' })).toBe(true);
    expect(isComparable({ categoryKey: 'furniture-fixtures', status: 'confirmed' })).toBe(true);
  });

  it('rejects anything a person has not settled', () => {
    expect(isComparable({ categoryKey: 'furniture-fixtures', status: 'needs-review' })).toBe(false);
  });

  /** `mixed` names no category on our side; it is reported, never compared. */
  it('rejects a blended reading however confident', () => {
    expect(isComparable({ categoryKey: 'mixed', status: 'auto-accepted' })).toBe(false);
  });

  it('rejects an unread line', () => {
    expect(isComparable({ categoryKey: null, status: 'auto-accepted' })).toBe(false);
  });
});

describe('vocabulary', () => {
  it('admits mixed alongside every classification key', () => {
    expect(isKnownLineMapping('mixed')).toBe(true);
    expect(isKnownLineMapping('machinery-equipment')).toBe(true);
    expect(isKnownLineMapping('excluded-intangible')).toBe(true);
    expect(isKnownLineMapping('ffe')).toBe(false);
    expect(isKnownLineMapping(null)).toBe(false);
  });
});

describe('mapUnmappable', () => {
  it('says why rather than guessing', () => {
    const mapping = mapUnmappable('This line has no property type printed against it.');
    expect(mapping.categoryKey).toBeNull();
    expect(mapping.status).toBe('needs-review');
    expect(mapping.rationale).toContain('no property type');
  });
});
