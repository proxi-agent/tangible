import { describe, expect, it } from 'vitest';
import type { EngagementResult, SiteOutcome } from '@tangible/types';
import { assembleLetterFacts, letterBlocker } from './letter.js';

const site = (over: Partial<SiteOutcome> = {}): SiteOutcome => ({
  locationId: 'loc-1',
  label: 'Houston Office',
  accountId: '2349508',
  phase: 'settled',
  renderedCost: 125_000,
  filedOn: '2027-03-01',
  noticedValue: 812_000,
  noticedOn: '2027-05-01',
  standingValue: 640_000,
  settledVia: 'agreement',
  final: true,
  reduction: 172_000,
  nextDeadline: null,
  standing: 'Settled by agreement at $640,000.',
  ...over,
});

const result = (sites: SiteOutcome[], over: Partial<EngagementResult> = {}): EngagementResult => ({
  taxYear: 2027,
  sites,
  settledCount: sites.filter((s) => s.final).length,
  siteCount: sites.length,
  renderedTotal: 125_000,
  renderedCount: 1,
  noticedTotal: 812_000,
  noticedCount: 1,
  standingTotal: 640_000,
  standingCount: 1,
  reductionTotal: 172_000,
  reductionCount: 1,
  standing: 'The season took $172,000 off.',
  ...over,
});

describe('letterBlocker', () => {
  it('refuses an empty season and an entirely unfiled one', () => {
    expect(letterBlocker(result([]))).toMatch(/nothing to report/i);
    expect(letterBlocker(result([site({ phase: 'unfiled' })]))).toMatch(/Nothing has been filed/);
  });

  it('drafts once any site has started', () => {
    expect(letterBlocker(result([site({ phase: 'unfiled' }), site({ phase: 'awaiting-notice' })]))).toBeNull();
  });
});

describe('assembleLetterFacts', () => {
  it('carries every site, started or not, with its prose', () => {
    const facts = assembleLetterFacts('Acme', result([site(), site({ label: 'Plant', phase: 'unfiled' })]));
    expect(facts.sites.map((s) => s.label)).toEqual(['Houston Office', 'Plant']);
    expect(facts.sites[0]!.standing).toBe('Settled by agreement at $640,000.');
  });

  it('carries the scoreboard totals and headline verbatim', () => {
    const facts = assembleLetterFacts('Acme Machining LLC', result([site()]));
    expect(facts.clientName).toBe('Acme Machining LLC');
    expect(facts.taxYear).toBe(2027);
    expect(facts.reductionTotal).toBe(172_000);
    expect(facts.reductionCount).toBe(1);
    expect(facts.standing).toBe('The season took $172,000 off.');
  });

  it('keeps the sign of a value that went up', () => {
    const facts = assembleLetterFacts(
      'Acme',
      result([site({ standingValue: 900_000, reduction: -88_000 })]),
    );
    expect(facts.sites[0]!.reduction).toBe(-88_000);
  });
});
