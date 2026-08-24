import { describe, expect, it } from 'vitest';
import type { AssessmentNotice, RenditionFiling } from '@tangible/types';
import { assembleBriefFacts, briefBlocker } from './brief.js';
import type { RenditionPosition } from './positions.js';

const notice = (over: Partial<AssessmentNotice> = {}): AssessmentNotice =>
  ({
    id: 'n-1',
    engagementId: 'e-1',
    locationId: 'loc-1',
    locationLabel: 'Houston Office',
    accountId: '2349508',
    districtName: 'Harris Central Appraisal District',
    taxYear: 2027,
    status: 'active',
    noticedOn: '2027-04-15',
    deliveredOn: null,
    printedDeadline: '2027-05-15',
    appraisedValue: 812_000,
    assessedValue: 812_000,
    priorYearValue: 760_000,
    renditionPenaltyApplied: null,
    note: null,
    protestFiledOn: null,
    protestNote: null,
    recordedBy: null,
    recordedAt: '2027-04-16T00:00:00.000Z',
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    protest: {
      open: true,
      deadline: '2027-05-15',
      statutoryDeadline: '2027-05-17',
      printedDeadline: '2027-05-15',
      waiverDeadline: null,
      standing: 'Open.',
    },
    checks: [],
    resolution: null,
    correction: null,
    ...over,
  }) as AssessmentNotice;

const filing = (over: Partial<RenditionFiling> = {}): RenditionFiling =>
  ({
    id: 'f-1',
    engagementId: 'e-1',
    locationId: 'loc-1',
    locationLabel: 'Houston Office',
    accountId: '2349508',
    taxYear: 2027,
    jurisdictionId: null,
    status: 'filed',
    basis: 'historical-cost',
    filedByAgent: true,
    method: 'efile',
    filedOn: '2027-04-10',
    confirmation: 'EF-123',
    note: null,
    totalHistoricalCost: 1_004_000,
    totalGoodFaithEstimate: null,
    scheduleValue: 640_000,
    assetCount: 118,
    formRevision: '50-144-2026',
    formSha256: 'abc',
    recordedBy: null,
    recordedAt: '2027-04-10T00:00:00.000Z',
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    ...over,
  }) as RenditionFiling;

const position = (over: Partial<RenditionPosition> = {}): RenditionPosition => ({
  source: 'savings',
  key: 'k',
  title: 'Ghost assets still on the roll',
  taxYear: 2027,
  status: 'accepted',
  decidedBy: null,
  decidedAt: null,
  cost: 96_000,
  assetCount: 12,
  ...over,
});

describe('briefBlocker', () => {
  it('drafts only against a standing notice with a value', () => {
    expect(briefBlocker(notice())).toBeNull();
    expect(briefBlocker(notice({ status: 'superseded' }))).toMatch(/superseded/);
    expect(briefBlocker(notice({ appraisedValue: null }))).toMatch(/no appraised value/);
  });

  it('refuses once the protest has ended', () => {
    const resolved = notice({
      resolution: { status: 'recorded' } as AssessmentNotice['resolution'],
    });
    expect(briefBlocker(resolved)).toMatch(/already answered/);
  });
});

describe('assembleBriefFacts', () => {
  it('computes the over-assessment as noticed minus filed', () => {
    const facts = assembleBriefFacts(notice(), filing(), []);
    expect(facts.overAssessment).toBe(172_000);
    expect(facts.filed?.scheduleValue).toBe(640_000);
    expect(facts.protestDeadline).toBe('2027-05-15');
  });

  it('keeps the sign when the district came in under our number', () => {
    const facts = assembleBriefFacts(notice({ appraisedValue: 600_000 }), filing(), []);
    expect(facts.overAssessment).toBe(-40_000);
  });

  it('carries no over-assessment where nothing was filed', () => {
    const facts = assembleBriefFacts(notice(), null, []);
    expect(facts.filed).toBeNull();
    expect(facts.overAssessment).toBeNull();
  });

  it('drops rejected positions and other years, keeps pending and undecided', () => {
    const facts = assembleBriefFacts(notice(), filing(), [
      position(),
      position({ key: 'r', status: 'rejected', title: 'Dropped claim' }),
      position({ key: 'p', status: 'pending-client', title: 'Leased copiers' }),
      position({ key: 'u', status: null, title: 'Undecided' }),
      position({ key: 'y', taxYear: 2026, title: 'Last season' }),
    ]);
    expect(facts.positions.map((p) => p.title)).toEqual([
      'Ghost assets still on the roll',
      'Leased copiers',
      'Undecided',
    ]);
  });
});
