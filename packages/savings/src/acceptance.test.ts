import { describe, expect, it } from 'vitest';
import { learnAcceptance, MIN_OBSERVATIONS, type AcceptanceObservation } from './acceptance.js';
import { acceptanceFor } from './recovery.js';

function outcomes(
  findingKey: string,
  share: number,
  count: number,
  jurisdictionId: string | null = 'tx-harris',
): AcceptanceObservation[] {
  return Array.from({ length: count }, () => ({ findingKey, jurisdictionId, share }));
}

const HARRIS = 'tx-harris';

describe('learnAcceptance', () => {
  it('publishes nothing when nothing has closed', () => {
    const learned = learnAcceptance([], HARRIS);
    expect(learned.rates).toEqual({});
    expect(learned.evidence).toEqual([]);
    expect(learned.measured).toBe(false);
  });

  it('does not let two wins become a rate', () => {
    const learned = learnAcceptance(outcomes('misclassification', 1, 2), HARRIS);
    const row = learned.evidence[0]!;
    expect(row.observations).toBe(2);
    expect(row.measured).toBe(false);
    // It moved, but nowhere near the two wins it saw.
    expect(row.rate).toBeGreaterThan(row.prior);
    expect(row.rate).toBeLessThan(0.75);
    // And the report never sees it.
    expect(learned.rates.misclassification).toBeUndefined();
    expect(learned.measured).toBe(false);
    expect(row.basis).toContain(`takes ${MIN_OBSERVATIONS}`);
  });

  it('publishes a rate once the bar is cleared', () => {
    const learned = learnAcceptance(outcomes('ghost-assets', 1, MIN_OBSERVATIONS), HARRIS);
    const row = learned.evidence[0]!;
    expect(row.measured).toBe(true);
    expect(learned.rates['ghost-assets']).toBeCloseTo(row.rate, 10);
    expect(row.rate).toBeGreaterThan(acceptanceFor('ghost-assets'));
    // Five wins is not certainty, and the number must not read like it.
    expect(row.rate).toBeLessThan(0.97);
    expect(row.basis).toContain('Used on the report.');
  });

  it('drags a rate down when a district keeps saying no', () => {
    const learned = learnAcceptance(outcomes('misclassification', 0, 10), HARRIS);
    const row = learned.evidence[0]!;
    expect(row.rate).toBeLessThan(row.prior);
    expect(row.rate).toBeCloseTo(0.1455, 3);
    expect(learned.rates.misclassification).toBeLessThan(0.2);
  });

  it('lets a district pull away from what districts generally do', () => {
    const learned = learnAcceptance(
      [...outcomes('non-taxable', 0, 8, HARRIS), ...outcomes('non-taxable', 1, 8, 'tx-dallas')],
      HARRIS,
    );
    const here = learned.evidence[0]!;
    const elsewhere = learnAcceptance(
      [...outcomes('non-taxable', 0, 8, HARRIS), ...outcomes('non-taxable', 1, 8, 'tx-dallas')],
      'tx-dallas',
    ).evidence[0]!;

    expect(here.localObservations).toBe(8);
    expect(elsewhere.localObservations).toBe(8);
    // Same sixteen outcomes, two different answers, because the question is
    // "what will this district do" and not "what happens on average".
    expect(here.rate).toBeCloseTo(0.3143, 3);
    expect(elsewhere.rate).toBeCloseTo(0.8143, 3);
    // Neither district is dragged all the way to its own record — the eight
    // outcomes across the county line are still evidence, just weaker.
    expect(here.rate).toBeGreaterThan(0);
    expect(elsewhere.rate).toBeLessThan(1);
  });

  it('moves a district that has no outcomes of its own', () => {
    const learned = learnAcceptance(outcomes('non-taxable', 0, 6, HARRIS), 'tx-dallas');
    const row = learned.evidence[0]!;
    expect(row.localObservations).toBe(0);
    expect(row.rate).toBeCloseTo(0.5333, 3);
    expect(row.rate).toBeLessThan(row.prior);
    expect(row.basis).toContain('none of them in this district');
  });

  it('counts a partial allowance as part of a win', () => {
    const learned = learnAcceptance(outcomes('situs-error', 0.5, 10), HARRIS);
    const row = learned.evidence[0]!;
    expect(row.rate).toBeGreaterThan(0.5);
    expect(row.rate).toBeLessThan(row.prior);
    expect(row.rate).toBeCloseTo(0.5679, 3);
  });

  it('reports a band that is wide when the data is thin', () => {
    const thin = learnAcceptance(outcomes('ghost-assets', 1, 3), HARRIS).evidence[0]!;
    const thick = learnAcceptance(outcomes('ghost-assets', 1, 60), HARRIS).evidence[0]!;
    const width = (row: { interval: [number, number] }) => row.interval[1] - row.interval[0];
    expect(width(thin)).toBeGreaterThan(width(thick));
    expect(thin.interval[0]).toBeLessThanOrEqual(thin.rate);
    expect(thin.interval[1]).toBeGreaterThanOrEqual(thin.rate);
    expect(thin.interval[0]).toBeGreaterThanOrEqual(0);
    expect(thick.interval[1]).toBeLessThanOrEqual(1);
  });

  it('starts an unpriced finding at the timid default', () => {
    const learned = learnAcceptance(outcomes('something-nobody-priced', 1, 1), HARRIS);
    expect(learned.evidence[0]!.prior).toBe(0.5);
  });

  it('ignores a share that is not a share', () => {
    const learned = learnAcceptance(
      [
        ...outcomes('ghost-assets', 1, 5),
        { findingKey: 'ghost-assets', jurisdictionId: HARRIS, share: 1.4 },
        { findingKey: 'ghost-assets', jurisdictionId: HARRIS, share: Number.NaN },
      ],
      HARRIS,
    );
    expect(learned.observations).toBe(5);
    expect(learned.evidence[0]!.observations).toBe(5);
  });

  it('never treats an unknown district as this one', () => {
    const learned = learnAcceptance(outcomes('ghost-assets', 1, 6, null), null);
    // Both sides null is not a match: a claim whose district was never recorded
    // is evidence about districts in general, and about no district in
    // particular.
    expect(learned.evidence[0]!.localObservations).toBe(0);
  });

  it('keeps each finding kind on its own books', () => {
    const learned = learnAcceptance(
      [...outcomes('ghost-assets', 1, 6), ...outcomes('misclassification', 0, 6)],
      HARRIS,
    );
    expect(learned.evidence.map((row) => row.findingKey)).toEqual([
      'ghost-assets',
      'misclassification',
    ]);
    expect(learned.rates['ghost-assets']).toBeGreaterThan(0.9);
    expect(learned.rates.misclassification).toBeLessThan(0.3);
    expect(learned.observations).toBe(12);
  });
});
