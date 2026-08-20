import { describe, expect, it } from 'vitest';
import {
  AUTO_ACCEPT_CONFIDENCE,
  decideFromAi,
  decideFromHuman,
  decideFromMemory,
  decideUnclassifiable,
  isValuable,
  type MemoryRecord,
} from './decide.js';

const memory = (over: Partial<MemoryRecord> = {}): MemoryRecord => ({
  fingerprint: 'office chair',
  categoryKey: 'furniture-fixtures',
  lifeClassOverride: null,
  confirmations: 1,
  conflicted: false,
  conflictingCategoryKey: null,
  lastConfirmedAt: new Date('2026-05-04T00:00:00Z'),
  ...over,
});

describe('decideFromMemory', () => {
  it('replays a prior human decision at full confidence', () => {
    const decision = decideFromMemory(memory({ confirmations: 3 }));
    expect(decision.categoryKey).toBe('furniture-fixtures');
    expect(decision.status).toBe('auto-accepted');
    expect(decision.confidence).toBe(1);
    expect(decision.source).toBe('memory');
    // The rationale has to say who decided and when, or the confidence is a
    // number nobody can check.
    expect(decision.rationale).toContain('3 times');
    expect(decision.rationale).toContain('2026-05-04');
  });

  // The rule that keeps memory trustworthy as it grows.
  it('stops auto-applying a description reviewers disagreed about', () => {
    const decision = decideFromMemory(
      memory({
        categoryKey: 'computer-pc',
        conflicted: true,
        conflictingCategoryKey: 'machinery-equipment',
      }),
    );
    expect(decision.status).toBe('needs-review');
    expect(decision.confidence).toBeLessThan(AUTO_ACCEPT_CONFIDENCE);
    // Both sides of the argument reach the reviewer.
    expect(decision.rationale).toContain('Computer equipment (PC)');
    expect(decision.rationale).toContain('Machinery and equipment');
  });

  it('queues a memory naming a category the jurisdiction dropped', () => {
    const decision = decideFromMemory(memory({ categoryKey: 'floppy-disks' }));
    expect(decision.categoryKey).toBeNull();
    expect(decision.status).toBe('needs-review');
  });

  it('carries a remembered life-class override through', () => {
    expect(decideFromMemory(memory({ lifeClassOverride: 12 })).lifeClassOverride).toBe(12);
  });
});

describe('decideFromAi', () => {
  it('lets a confident answer stand', () => {
    const decision = decideFromAi(
      {
        categoryKey: 'computer-pc',
        lifeClassOverride: null,
        confidence: 0.95,
        rationale: 'Laptop.',
      },
      'dell laptop',
    );
    expect(decision.status).toBe('auto-accepted');
    expect(decision.fingerprint).toBe('dell laptop');
  });

  it('queues an unsure one rather than rounding it up', () => {
    const decision = decideFromAi(
      {
        categoryKey: 'machinery-equipment',
        lifeClassOverride: null,
        confidence: AUTO_ACCEPT_CONFIDENCE - 0.01,
        rationale: 'Could be shop or office.',
      },
      'unit',
    );
    expect(decision.status).toBe('needs-review');
    expect(decision.confidence).toBeCloseTo(AUTO_ACCEPT_CONFIDENCE - 0.01, 5);
  });

  it('accepts exactly at the bar', () => {
    const decision = decideFromAi(
      {
        categoryKey: 'vessels',
        lifeClassOverride: null,
        confidence: AUTO_ACCEPT_CONFIDENCE,
        rationale: 'Barge.',
      },
      'barge',
    );
    expect(decision.status).toBe('auto-accepted');
  });

  it('refuses a category the jurisdiction does not publish', () => {
    // A hallucinated key would otherwise reach the valuation as a silent gap.
    const decision = decideFromAi(
      { categoryKey: 'drones', lifeClassOverride: null, confidence: 0.99, rationale: 'Drone.' },
      'drone',
    );
    expect(decision.categoryKey).toBeNull();
    expect(decision.status).toBe('needs-review');
    expect(decision.confidence).toBe(0);
  });

  // Taking cost off a sworn form is a position, not a lookup.
  it('never lets an exclusion apply itself, however sure the model is', () => {
    for (const key of ['excluded-real-property', 'excluded-intangible', 'excluded-leased-in']) {
      const decision = decideFromAi(
        { categoryKey: key, lifeClassOverride: null, confidence: 1, rationale: 'Clearly.' },
        'roof replacement',
      );
      expect(decision.categoryKey).toBe(key);
      expect(decision.status).toBe('needs-review');
    }
  });

  it('does let a person’s prior exclusion replay', () => {
    // The difference is that somebody already signed for it.
    const decision = decideFromMemory(memory({ categoryKey: 'excluded-intangible' }));
    expect(decision.status).toBe('auto-accepted');
  });

  it('clamps a confidence outside 0–1', () => {
    const over = decideFromAi(
      { categoryKey: 'vessels', lifeClassOverride: null, confidence: 4, rationale: 'Sure.' },
      null,
    );
    expect(over.confidence).toBe(1);
  });
});

describe('what reaches a valuation', () => {
  it('prices settled decisions and withholds queued ones', () => {
    expect(isValuable(decideFromHuman('vehicles', null, 'van', null))).toBe(true);
    expect(
      isValuable(
        decideFromAi(
          { categoryKey: 'vehicles', lifeClassOverride: null, confidence: 0.99, rationale: '' },
          'van',
        ),
      ),
    ).toBe(true);
    expect(
      isValuable(
        decideFromAi(
          { categoryKey: 'vehicles', lifeClassOverride: null, confidence: 0.2, rationale: '' },
          'van',
        ),
      ),
    ).toBe(false);
    expect(isValuable(decideUnclassifiable('Nothing to go on.'))).toBe(false);
  });
});
