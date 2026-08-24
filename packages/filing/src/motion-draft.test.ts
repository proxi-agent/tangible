import { describe, expect, it } from 'vitest';
import type { CorrectionRoute, OpenYear } from '@tangible/types';
import { assembleMotionDraftFacts, motionDraftBlocker } from './motion-draft.js';

const route = (over: Partial<CorrectionRoute> = {}): CorrectionRoute => ({
  key: 'c',
  cite: '25.25(c)',
  label: 'Clerical error',
  open: true,
  deadline: '2030-12-31',
  grounds: 'A clerical error on the roll.',
  threshold: null,
  cost: null,
  barred: null,
  ...over,
});

const year = (over: Partial<OpenYear> = {}): OpenYear => ({
  key: '2349508:2024',
  taxYear: 2024,
  source: 'recorded',
  label: 'Houston Office',
  accountId: '2349508',
  locationId: 'loc-1',
  districtName: 'Harris Central Appraisal District',
  rolledValue: 800_000,
  noticeId: 'n-1',
  documentId: null,
  outlook: {
    taxYear: 2024,
    open: true,
    routes: [route()],
    standing: '25.25(c) is still open for 2024.',
  },
  motions: [],
  ...over,
});

describe('motionDraftBlocker', () => {
  it('refuses a route the outlook did not compute, and a closed one with its bar', () => {
    expect(motionDraftBlocker(year(), 'd', 500_000)).toMatch(/does not compute a d route/);
    const shut = year({
      outlook: {
        taxYear: 2024,
        open: false,
        routes: [route({ open: false, barred: 'A protest was determined for 2024.' })],
        standing: 'Closed.',
      },
    });
    expect(motionDraftBlocker(shut, 'c', 500_000)).toBe('A protest was determined for 2024.');
  });

  it('refuses a claim at or above the roll', () => {
    expect(motionDraftBlocker(year(), 'c', 800_000)).toMatch(/must be below/);
    expect(motionDraftBlocker(year(), 'c', 500_000)).toBeNull();
  });

  it("runs 25.25(d)'s one-third test on the claimed value, as (d) is written", () => {
    const withD = year({
      outlook: {
        taxYear: 2024,
        open: true,
        routes: [route({ key: 'd', cite: '25.25(d)', threshold: 1 / 3 })],
        standing: 'Open.',
      },
    });
    // 800,000 over 630,000 is 27% of the correct value — short of a third.
    expect(motionDraftBlocker(withD, 'd', 630_000)).toMatch(/does not reach/);
    // 800,000 over 590,000 is 35.6% — over a third.
    expect(motionDraftBlocker(withD, 'd', 590_000)).toBeNull();
    // A claim of zero is over by everything.
    expect(motionDraftBlocker(withD, 'd', 0)).toBeNull();
    expect(motionDraftBlocker({ ...withD, rolledValue: null }, 'd', 500_000)).toMatch(
      /no rolled value/i,
    );
  });
});

describe('assembleMotionDraftFacts', () => {
  it('freezes the assertion beside the record, and computes the reduction', () => {
    const facts = assembleMotionDraftFacts('Acme', year(), 'c', 500_000, '  double-counted  ');
    expect(facts.claimedValue).toBe(500_000);
    expect(facts.reduction).toBe(300_000);
    expect(facts.ground).toBe('double-counted');
    expect(facts.route.cite).toBe('25.25(c)');
    expect(facts.yearStanding).toBe('25.25(c) is still open for 2024.');
  });

  it('leaves the reduction unknown when the roll is', () => {
    const facts = assembleMotionDraftFacts('Acme', year({ rolledValue: null }), 'c', 500_000, 'x');
    expect(facts.reduction).toBeNull();
  });
});
