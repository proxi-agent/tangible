import { describe, expect, it } from 'vitest';
import { assembleUnblockFacts, unblockBlocker, type UnblockSource } from './unblock.js';

const entry = (over: Partial<UnblockSource> = {}): UnblockSource => ({
  label: 'Houston Office',
  accountId: '2349508',
  status: 'blocked',
  dueOn: '2027-04-15',
  daysToDue: 12,
  blockers: [
    {
      key: 'agent-appointment',
      severity: 'blocking',
      message: 'No agent appointment stands for this site.',
      resolution: 'Have the client sign Form 50-162 and record it.',
    },
  ],
  ...over,
});

describe('unblockBlocker', () => {
  it('drafts only when something is blocked', () => {
    expect(unblockBlocker([entry()])).toBeNull();
    expect(unblockBlocker([entry({ status: 'ready' }), entry({ status: 'filed' })])).toMatch(
      /Nothing is blocked/,
    );
    expect(unblockBlocker([])).toMatch(/Nothing is blocked/);
  });
});

describe('assembleUnblockFacts', () => {
  it('keeps blocked returns only, tightest deadline first', () => {
    const facts = assembleUnblockFacts('Acme', 2027, [
      entry({ label: 'Plant', daysToDue: 30 }),
      entry({ label: 'Ready site', status: 'ready' }),
      entry({ label: 'Office', daysToDue: 5 }),
    ]);
    expect(facts.returns.map((r) => r.label)).toEqual(['Office', 'Plant']);
  });

  it('drops warnings, keeps only blocking problems', () => {
    const facts = assembleUnblockFacts('Acme', 2027, [
      entry({
        blockers: [
          {
            key: 'situs-address',
            severity: 'blocking',
            message: 'The site has no street address.',
            resolution: 'Add the address on the site card.',
          },
          {
            key: 'stale-set',
            severity: 'warning',
            message: 'The findings are stale.',
            resolution: 'Re-run the comparison.',
          },
        ],
      }),
    ]);
    expect(facts.returns[0]!.blockers.map((b) => b.key)).toEqual(['situs-address']);
  });

  it('carries the deadline the return actually works to', () => {
    const facts = assembleUnblockFacts('Acme', 2027, [entry({ dueOn: '2027-05-15' })]);
    expect(facts.returns[0]!.dueOn).toBe('2027-05-15');
    expect(facts.clientName).toBe('Acme');
    expect(facts.taxYear).toBe(2027);
  });
});
