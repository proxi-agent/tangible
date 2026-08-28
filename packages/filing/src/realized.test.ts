import { describe, expect, it } from 'vitest';
import {
  proRataSplit,
  realize,
  realizedTotals,
  type RecoveryClaim,
  type RecoveryOutcome,
} from './realized.js';

function claim(id: string, valueClaimed: number, findingKey = 'ghost-assets'): RecoveryClaim {
  return {
    id,
    taxYear: 2026,
    locationId: 'site-1',
    accountId: '123456',
    assetId: `asset-${id}`,
    findingKey,
    route: 'protest',
    valueClaimed,
    taxClaimed: valueClaimed * 0.025,
    predictedConfidence: 0.8,
    predictedAcceptance: 0.6,
  };
}

describe('proRataSplit', () => {
  it('distributes a settlement so the parts sum to exactly the whole', () => {
    const claims = [claim('a', 33_333), claim('b', 33_333), claim('c', 33_334)];
    const { outcomes, unattributed } = proRataSplit(claims, 50_000, '2026-07-01');
    const total = outcomes.reduce((sum, o) => sum + (o.valueAllowed ?? 0), 0);
    expect(total).toBe(50_000);
    expect(unattributed).toBe(0);
  });

  it('does not allow a claim more than it asked for, and returns the excess unattributed', () => {
    const claims = [claim('a', 10_000), claim('b', 20_000)];
    const { outcomes, unattributed } = proRataSplit(claims, 45_000, '2026-07-01');
    expect(outcomes[0]!.valueAllowed).toBe(10_000);
    expect(outcomes[1]!.valueAllowed).toBe(20_000);
    expect(outcomes.every((o) => o.outcome === 'accepted')).toBe(true);
    // The district moved $15,000 for reasons of its own. Spreading it over
    // positions that never asked for it would invent agreement.
    expect(unattributed).toBe(15_000);
  });

  it('marks every split row pro-rata, whatever the outcome', () => {
    const { outcomes } = proRataSplit(
      [claim('a', 10_000), claim('b', 90_000)],
      40_000,
      '2026-07-01',
    );
    expect(outcomes.map((o) => o.allocation)).toEqual(['pro-rata', 'pro-rata']);
    expect(outcomes.map((o) => o.outcome)).toEqual(['partial', 'partial']);
  });

  it('rejects everything when the district removed nothing', () => {
    const { outcomes } = proRataSplit([claim('a', 10_000)], 0, '2026-07-01');
    expect(outcomes[0]!.outcome).toBe('rejected');
    expect(outcomes[0]!.valueAllowed).toBe(0);
  });

  it('never divides by a zero ask', () => {
    const { outcomes, unattributed } = proRataSplit([claim('a', 0)], 5_000, '2026-07-01');
    expect(outcomes[0]!.valueAllowed).toBe(0);
    expect(unattributed).toBe(5_000);
  });
});

describe('realize', () => {
  function outcome(over: Partial<RecoveryOutcome> = {}): RecoveryOutcome {
    return {
      claimId: 'a',
      outcome: 'accepted',
      allocation: 'itemized',
      valueAllowed: 10_000,
      taxRecovered: 250,
      taxIsDocumented: true,
      resolvedOn: '2026-07-01',
      ...over,
    };
  }

  it('an itemized acceptance is the one row the model may learn from', () => {
    const row = realize(claim('a', 10_000), outcome());
    expect(row.learnable).toBe(true);
    expect(row.notLearnable).toBeNull();
    expect(row.realizedShare).toBe(1);
  });

  it('a pro-rata share is reported but never learned from', () => {
    const row = realize(
      claim('a', 10_000),
      outcome({ allocation: 'pro-rata', valueAllowed: 4_000 }),
    );
    expect(row.realizedShare).toBe(0.4);
    expect(row.learnable).toBe(false);
    expect(row.notLearnable).toContain('did not say which positions');
  });

  it('a withdrawal is not evidence that the argument would have failed', () => {
    const row = realize(
      claim('a', 10_000),
      outcome({ outcome: 'withdrawn', allocation: 'stated', valueAllowed: 0 }),
    );
    expect(row.learnable).toBe(false);
    expect(row.notLearnable).toContain('Withdrawn');
    expect(row.standing).toBe('Withdrawn before the district ruled.');
  });

  it('a rejection the appraiser stated is learnable — a "no" is a real observation', () => {
    const row = realize(
      claim('a', 10_000),
      outcome({ outcome: 'rejected', allocation: 'stated', valueAllowed: 0 }),
    );
    expect(row.learnable).toBe(true);
    expect(row.realizedShare).toBe(0);
  });

  it('a pending claim has no share and says so rather than reading as zero', () => {
    const row = realize(claim('a', 10_000), null);
    expect(row.realizedShare).toBeNull();
    expect(row.learnable).toBe(false);
    expect(row.standing).toContain('still open');
  });

  it('caps the share at one when a district allowed more than was asked', () => {
    expect(realize(claim('a', 10_000), outcome({ valueAllowed: 12_000 })).realizedShare).toBe(1);
  });
});

describe('realizedTotals', () => {
  it('keeps documented tax and modelled tax apart', () => {
    const rows = [
      realize(claim('a', 10_000), {
        claimId: 'a',
        outcome: 'accepted',
        allocation: 'itemized',
        valueAllowed: 10_000,
        taxRecovered: 250,
        taxIsDocumented: true,
        resolvedOn: '2026-07-01',
      }),
      realize(claim('b', 20_000), {
        claimId: 'b',
        outcome: 'partial',
        allocation: 'pro-rata',
        valueAllowed: 5_000,
        taxRecovered: 125,
        taxIsDocumented: false,
        resolvedOn: '2026-07-01',
      }),
      realize(claim('c', 30_000), null),
    ];
    const totals = realizedTotals(rows, 0.025);
    expect(totals.claims).toBe(3);
    expect(totals.settled).toBe(2);
    expect(totals.pending).toBe(1);
    expect(totals.valueClaimed).toBe(60_000);
    expect(totals.valueAllowed).toBe(15_000);
    // The undocumented $125 does not join the documented $250.
    expect(totals.taxDocumented).toBe(250);
    expect(totals.taxEstimated).toBe(375);
    expect(totals.learnable).toBe(1);
  });

  it('reports no estimate rather than a zero when no rate is on file', () => {
    expect(realizedTotals([realize(claim('a', 10_000), null)], null).taxEstimated).toBeNull();
  });
});
