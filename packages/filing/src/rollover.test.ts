import { describe, expect, it } from 'vitest';
import { planRollover, type RolloverSource } from './rollover.js';

const eng = (id: string, taxYear: number, over: Record<string, unknown> = {}) => ({
  id,
  taxYear,
  jurisdictionId: 'tx-harris',
  sicCode: '3599',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const client = (over: Partial<RolloverSource> = {}): RolloverSource => ({
  clientId: 'c-1',
  clientName: 'Acme',
  clientStatus: 'active',
  engagements: [eng('e-1', 2027)],
  ...over,
});

describe('planRollover', () => {
  it('rolls only clients worked in the season being left', () => {
    const plan = planRollover(2027, [
      client(),
      client({ clientId: 'c-2', clientName: 'Idle', engagements: [eng('e-9', 2025)] }),
    ]);
    expect(plan.toYear).toBe(2028);
    expect(plan.clients.map((entry) => entry.clientId)).toEqual(['c-1']);
    expect(plan.readyCount).toBe(1);
  });

  it('carries the county and SIC code from the season being left', () => {
    const plan = planRollover(2027, [client()]);
    expect(plan.clients[0]).toMatchObject({
      sourceEngagementId: 'e-1',
      jurisdictionId: 'tx-harris',
      sicCode: '3599',
      standing: 'ready',
    });
  });

  it('picks the newest engagement when the year is duplicated', () => {
    const plan = planRollover(2027, [
      client({
        engagements: [
          eng('e-old', 2027, { sicCode: '2599' }),
          eng('e-new', 2027, { createdAt: '2026-06-01T00:00:00Z' }),
        ],
      }),
    ]);
    expect(plan.clients[0]!.sourceEngagementId).toBe('e-new');
    expect(plan.clients[0]!.sicCode).toBe('3599');
  });

  it('marks next year already open, and archived clients stay behind on the plan', () => {
    const plan = planRollover(2027, [
      client({ engagements: [eng('e-1', 2027), eng('e-2', 2028)] }),
      client({ clientId: 'c-3', clientName: 'Gone', clientStatus: 'archived' }),
    ]);
    const byId = new Map(plan.clients.map((entry) => [entry.clientId, entry]));
    expect(byId.get('c-1')).toMatchObject({ standing: 'already-open', openEngagementId: 'e-2' });
    expect(byId.get('c-3')!.standing).toBe('archived');
    expect(plan.readyCount).toBe(0);
    expect(plan.alreadyOpenCount).toBe(1);
    expect(plan.archivedCount).toBe(1);
  });

  it('a duplicate next year on an archived client still reads already-open', () => {
    const plan = planRollover(2027, [
      client({ clientStatus: 'archived', engagements: [eng('e-1', 2027), eng('e-2', 2028)] }),
    ]);
    expect(plan.clients[0]!.standing).toBe('already-open');
  });
});
