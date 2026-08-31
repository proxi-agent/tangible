import { describe, expect, it } from 'vitest';
import type { OutcomeInput } from './outcome.js';
import { siteOutcome } from './outcome.js';

function input(overrides: Partial<OutcomeInput> = {}): OutcomeInput {
  return {
    locationId: 'loc-1',
    label: 'Houston Office',
    accountId: '2349508',
    renderedCost: 713_550,
    filedOn: '2027-04-10',
    notice: null,
    resolution: null,
    motion: null,
    ...overrides,
  };
}

const NOTICE = {
  noticedOn: '2027-04-25',
  appraisedValue: 812_000,
  protestFiledOn: null,
  protestOpen: false,
  protestDeadline: '2027-05-25',
};

describe('the sequence of phases', () => {
  it('starts unfiled, with nothing standing', () => {
    const out = siteOutcome(input({ filedOn: null, renderedCost: null }));
    expect(out.phase).toBe('unfiled');
    expect(out.standingValue).toBeNull();
    expect(out.final).toBe(false);
  });

  it('waits on the district once the return is out', () => {
    const out = siteOutcome(input());
    expect(out.phase).toBe('awaiting-notice');
    expect(out.standing).toContain('25.19');
    expect(out.standingValue).toBeNull();
  });

  it('holds the noticed value as a claim while the window is open', () => {
    const out = siteOutcome(input({ notice: { ...NOTICE, protestOpen: true } }));
    expect(out.phase).toBe('protest-window');
    expect(out.noticedValue).toBe(812_000);
    // Not standing yet: a value that can still be protested has not settled.
    expect(out.standingValue).toBeNull();
    expect(out.nextDeadline).toBe('2027-05-25');
  });

  it('stands nothing while a protest is live', () => {
    const out = siteOutcome(input({ notice: { ...NOTICE, protestFiledOn: '2027-05-20' } }));
    expect(out.phase).toBe('protest-live');
    expect(out.standingValue).toBeNull();
    expect(out.reduction).toBeNull();
  });
});

describe('how a year settles', () => {
  it('settles by silence: an unprotested value stands once the window has gone', () => {
    const out = siteOutcome(input({ notice: NOTICE }));
    expect(out.phase).toBe('settled');
    expect(out.settledVia).toBe('unprotested');
    expect(out.standingValue).toBe(812_000);
    expect(out.reduction).toBe(0);
    expect(out.final).toBe(true);
    expect(out.standing).toContain('reached by silence');
  });

  it('settles by agreement at the agreed figure, final under 1.111(e)', () => {
    const out = siteOutcome(
      input({
        notice: { ...NOTICE, protestFiledOn: '2027-05-20' },
        resolution: {
          stage: 'informal',
          resolvedOn: '2027-06-15',
          finalValue: 640_000,
          appealOpen: false,
          appealDeadline: null,
        },
      }),
    );
    expect(out.phase).toBe('settled');
    expect(out.settledVia).toBe('agreement');
    expect(out.standingValue).toBe(640_000);
    expect(out.reduction).toBe(172_000);
    expect(out.standing).toContain('1.111(e)');
  });

  it('holds an ARB order in the appeal window while 42.21 still runs', () => {
    const out = siteOutcome(
      input({
        notice: { ...NOTICE, protestFiledOn: '2027-05-20' },
        resolution: {
          stage: 'arb',
          resolvedOn: '2027-07-09',
          finalValue: 305_000,
          appealOpen: true,
          appealDeadline: '2027-09-07',
        },
      }),
    );
    expect(out.phase).toBe('appeal-window');
    // The ordered value stands — provisionally. The phase carries the caveat.
    expect(out.standingValue).toBe(305_000);
    expect(out.settledVia).toBe('arb-order');
    expect(out.final).toBe(false);
    expect(out.nextDeadline).toBe('2027-09-07');
    expect(out.standing).toContain('42.21');
  });

  it('settles the order once the appeal window lapses', () => {
    const out = siteOutcome(
      input({
        notice: { ...NOTICE, protestFiledOn: '2027-05-20' },
        resolution: {
          stage: 'arb',
          resolvedOn: '2027-07-09',
          finalValue: 305_000,
          appealOpen: false,
          appealDeadline: '2027-09-07',
        },
      }),
    );
    expect(out.phase).toBe('settled');
    expect(out.settledVia).toBe('arb-order');
    expect(out.reduction).toBe(507_000);
  });

  it('leaves the noticed value standing after a withdrawal — conceded, not decided', () => {
    const out = siteOutcome(
      input({
        notice: { ...NOTICE, protestFiledOn: '2027-05-20' },
        resolution: {
          stage: 'withdrawn',
          resolvedOn: '2027-06-01',
          finalValue: null,
          appealOpen: false,
          appealDeadline: null,
        },
      }),
    );
    expect(out.settledVia).toBe('withdrawn');
    expect(out.standingValue).toBe(812_000);
    expect(out.reduction).toBe(0);
    expect(out.standing).toContain('conceded');
  });
});

describe('a 25.25 motion, the one route back in', () => {
  it('wins over the settlement it reopened', () => {
    const out = siteOutcome(
      input({
        notice: NOTICE,
        motion: { correctedValue: 505_000, outcomeOn: '2028-02-10' },
      }),
    );
    expect(out.phase).toBe('settled');
    expect(out.settledVia).toBe('motion');
    expect(out.standingValue).toBe(505_000);
    expect(out.reduction).toBe(307_000);
  });

  it('does not touch a year that is still moving', () => {
    // A motion cannot exist for a live year — its routes only open once the
    // protest window has gone — but if the data says otherwise, the live
    // phase wins: the roll cannot be corrected while it is being argued.
    const out = siteOutcome(
      input({
        notice: { ...NOTICE, protestFiledOn: '2027-05-20' },
        motion: { correctedValue: 505_000, outcomeOn: '2027-06-01' },
      }),
    );
    expect(out.phase).toBe('protest-live');
    expect(out.standingValue).toBeNull();
  });
});

describe('dollarizing the reduction', () => {
  const settled = (rate: number | null) =>
    siteOutcome(
      input({
        blendedTaxRate: rate,
        notice: { ...NOTICE, protestFiledOn: '2027-05-20' },
        resolution: {
          stage: 'informal',
          resolvedOn: '2027-06-15',
          finalValue: 640_000,
          appealOpen: false,
          appealDeadline: null,
        },
      }),
    );

  it('estimates tax at the blended rate, sign kept', () => {
    const out = settled(0.025);
    expect(out.blendedTaxRate).toBe(0.025);
    expect(out.estimatedTaxReduction).toBeCloseTo(4_300);
  });

  it('makes no estimate without a rate, and none without a reduction', () => {
    expect(settled(null).estimatedTaxReduction).toBeNull();
    const moving = siteOutcome(input({ blendedTaxRate: 0.025 }));
    expect(moving.reduction).toBeNull();
    expect(moving.estimatedTaxReduction).toBeNull();
  });

  it('keeps the estimate out of the prose', () => {
    expect(settled(0.025).standing).not.toContain('4,300');
  });
});

describe('cost and value stay apart', () => {
  it('never subtracts rendered cost from an appraised value', () => {
    const out = siteOutcome(input({ renderedCost: 713_550, notice: NOTICE }));
    // 812,000 - 713,550 = 98,450 must appear nowhere on the row.
    expect(JSON.stringify(out)).not.toContain('98450');
    expect(out.reduction).toBe(0);
  });

  it('says so when the notice printed no figure', () => {
    const out = siteOutcome(input({ notice: { ...NOTICE, appraisedValue: null } }));
    expect(out.settledVia).toBe('unprotested');
    expect(out.standingValue).toBeNull();
    expect(out.reduction).toBeNull();
    expect(out.standing).toContain('unrecorded figure');
  });
});
