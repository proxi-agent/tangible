import { describe, expect, it } from 'vitest';
import { runGate, ALL_VALUATION_GOLDENS, ruleStatuses } from './gate.js';
import { DETECTOR_GOLDENS } from './goldens/detectors.js';
import { runDetectorGolden } from './detector-goldens.js';
import { runValuationGolden } from './valuation-goldens.js';

const TODAY = '2026-08-27';

/**
 * The release gate, run against the repository as it stands. If this file goes
 * red, something a person decided is no longer what the software does.
 */
describe('the gate', () => {
  it('passes', () => {
    const result = runGate({ today: TODAY });
    // Printed rather than summarised: a failure here should say which case and
    // why on the first read, without anyone re-running it locally.
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('runs every golden in the repository', () => {
    const result = runGate({ today: TODAY });
    expect(result.goldensRun).toBe(ALL_VALUATION_GOLDENS.length + DETECTOR_GOLDENS.length);
    expect(result.goldensFailed).toBe(0);
  });

  it('refuses a valuation rule that nobody approved and nobody excused', () => {
    const result = runGate({ today: TODAY, unapprovedAllowed: [] });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes('valuation:tx-harris:2026'))).toBe(true);
  });

  it('refuses an acknowledgement of a case that passes', () => {
    const result = runGate({
      today: TODAY,
      acknowledged: [
        {
          id: 'golden-disposals',
          reason: 'stale',
          acknowledgedBy: 'nobody',
          acknowledgedAt: '2026-01-01',
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes('acknowledged as failing but passes'))).toBe(
      true,
    );
  });

  it('blocks a schedule that has run out of its own effective window', () => {
    const result = runGate({ today: '2027-03-01' });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.includes('Expired 2026-12-31'))).toBe(true);
  });

  it('says out loud that a jurisdiction has no notice-backed golden', () => {
    const result = runGate({ today: TODAY });
    expect(result.warnings.some((w) => w.includes('assessment notice'))).toBe(true);
  });
});

describe('the goldens themselves', () => {
  it.each(ALL_VALUATION_GOLDENS.map((g) => [g.id, g] as const))('%s', (_id, golden) => {
    const outcome = runValuationGolden(golden);
    expect(outcome.passed, outcome.detail).toBe(true);
  });

  it.each(DETECTOR_GOLDENS.map((g) => [g.id, g] as const))('%s', (_id, golden) => {
    const result = runDetectorGolden(golden);
    // The detail carries the missed asset and the reason a person gave for it,
    // so a failure reads as a sentence rather than as two counts.
    expect(result.outcome.passed, result.outcome.detail).toBe(true);
    expect(result.recall.found).toBe(result.recall.expected);
    expect(result.quiet.held).toBe(result.quiet.expected);
  });
});

describe('the rules repository', () => {
  it('gives every rule a citation and an effective date', () => {
    for (const status of ruleStatuses(TODAY)) {
      expect(status.provenance.citation.length, status.provenance.ruleId).toBeGreaterThan(0);
      expect(status.provenance.effectiveFrom, status.provenance.ruleId).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
    }
  });

  it('scopes every depreciation schedule to a jurisdiction', () => {
    for (const status of ruleStatuses(TODAY)) {
      if (status.kind !== 'valuation') continue;
      expect(status.provenance.jurisdictions, status.provenance.ruleId).not.toBeNull();
    }
  });

  it('holds every rule to be in effect today', () => {
    for (const status of ruleStatuses(TODAY)) {
      expect(status.staleReason, status.provenance.ruleId).toBeNull();
    }
  });
});
