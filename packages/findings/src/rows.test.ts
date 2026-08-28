import { describe, expect, it } from 'vitest';
import type {
  FindingRow,
  FindingRowDecision,
  FindingRowFilters,
  ReviewableRow,
} from '@tangible/types';
import { facetsFor, matchesFilters, totalRows } from './rows.js';

const NO_FILTER: FindingRowFilters = {
  confidence: [],
  locations: [],
  costCenters: [],
  categories: [],
  acquiredFrom: null,
  acquiredTo: null,
  costMin: null,
  costMax: null,
  evidence: 'any',
  dispositions: [],
  reviewers: [],
  query: '',
};

function filter(overrides: Partial<FindingRowFilters> = {}): FindingRowFilters {
  return { ...NO_FILTER, ...overrides };
}

function row(overrides: Partial<FindingRow> = {}): FindingRow {
  return {
    assetId: 'asset-1',
    assetTag: 'FA-1042',
    description: 'Dell OptiPlex workstation',
    acquisitionYear: 2016,
    originalCost: 12_400,
    scheduleValue: 1_240,
    categoryKey: 'computer-equipment',
    findingKey: 'ghost-assets',
    rowKey: 'ghost-assets:asset-1',
    categoryLabel: 'Computer equipment',
    assessedAsFiled: 1_240,
    correctedValue: 0,
    valueRemoved: 1_240,
    taxAtRisk: 31,
    expectedRecovery: null,
    confidence: {
      tier: 'high',
      score: 0.9,
      signals: [
        {
          code: 'disposal-date',
          label: 'Disposal date on the register',
          weight: 0.6,
          detail: null,
        },
      ],
      why: 'The register carries a disposal date for this asset.',
    },
    locationId: 'site-houston',
    siteLabel: 'Houston — Westpark',
    jurisdictionName: 'Harris County',
    costCenter: 'IT',
    evidencePresent: true,
    ...overrides,
  };
}

function decision(overrides: Partial<FindingRowDecision> = {}): FindingRowDecision {
  return {
    assetId: 'asset-1',
    status: 'accepted',
    note: null,
    decidedBy: 'controller@client.com',
    decidedByAudience: 'client',
    decidedAt: '2026-03-14T09:00:00.000Z',
    decidedValue: 1_240,
    decidedTaxAtRisk: 31,
    revisions: 1,
    hasMovedSinceDecision: false,
    ...overrides,
  };
}

describe('matchesFilters', () => {
  it('lets everything through when nothing is asked for', () => {
    expect(matchesFilters(row(), null, NO_FILTER)).toBe(true);
  });

  it('treats an empty list as no constraint, not as match-nothing', () => {
    // The whole page would open on an empty table if this were inverted.
    expect(
      matchesFilters(row({ confidence: { ...row().confidence, tier: 'low' } }), null, NO_FILTER),
    ).toBe(true);
  });

  describe('confidence', () => {
    it('is any-of', () => {
      const medium = row({ confidence: { ...row().confidence, tier: 'medium' } });
      expect(matchesFilters(medium, null, filter({ confidence: ['high', 'medium'] }))).toBe(true);
      expect(matchesFilters(medium, null, filter({ confidence: ['high'] }))).toBe(false);
    });
  });

  describe('location', () => {
    it('matches by site id', () => {
      expect(matchesFilters(row(), null, filter({ locations: ['site-houston'] }))).toBe(true);
      expect(matchesFilters(row(), null, filter({ locations: ['site-dallas'] }))).toBe(false);
    });

    it('reaches rows with no site through the unplaced sentinel', () => {
      // On a register with no location column this is every row, so a filter
      // that could not address them would be a filter that hides the finding.
      const nowhere = row({ locationId: null, siteLabel: null });
      expect(matchesFilters(nowhere, null, filter({ locations: ['unplaced'] }))).toBe(true);
      expect(matchesFilters(nowhere, null, filter({ locations: ['site-houston'] }))).toBe(false);
    });
  });

  describe('cost centre and asset class', () => {
    it('matches the register’s own string', () => {
      expect(matchesFilters(row(), null, filter({ costCenters: ['IT'] }))).toBe(true);
      expect(matchesFilters(row(), null, filter({ costCenters: ['Ops'] }))).toBe(false);
    });

    it('does not match a blank against a named cost centre', () => {
      expect(matchesFilters(row({ costCenter: null }), null, filter({ costCenters: ['IT'] }))).toBe(
        false,
      );
    });

    it('filters by classification key', () => {
      expect(matchesFilters(row(), null, filter({ categories: ['computer-equipment'] }))).toBe(
        true,
      );
      expect(matchesFilters(row(), null, filter({ categories: ['furniture'] }))).toBe(false);
    });
  });

  describe('acquisition year', () => {
    it('bounds inclusively at both ends', () => {
      expect(
        matchesFilters(row({ acquisitionYear: 2016 }), null, filter({ acquiredFrom: 2016 })),
      ).toBe(true);
      expect(
        matchesFilters(row({ acquisitionYear: 2016 }), null, filter({ acquiredTo: 2016 })),
      ).toBe(true);
      expect(
        matchesFilters(row({ acquisitionYear: 2015 }), null, filter({ acquiredFrom: 2016 })),
      ).toBe(false);
      expect(
        matchesFilters(row({ acquisitionYear: 2017 }), null, filter({ acquiredTo: 2016 })),
      ).toBe(false);
    });

    it('excludes an undated row from either bound', () => {
      // "Acquired 2016 or later" cannot honestly claim a row with no year, and
      // neither can "2016 or earlier". 22.01(a) rows arrive undated often.
      const undated = row({ acquisitionYear: null });
      expect(matchesFilters(undated, null, filter({ acquiredFrom: 2016 }))).toBe(false);
      expect(matchesFilters(undated, null, filter({ acquiredTo: 2016 }))).toBe(false);
      expect(matchesFilters(undated, null, NO_FILTER)).toBe(true);
    });
  });

  describe('cost range', () => {
    it('is the done-when filter: over $10,000', () => {
      expect(matchesFilters(row({ originalCost: 12_400 }), null, filter({ costMin: 10_000 }))).toBe(
        true,
      );
      expect(matchesFilters(row({ originalCost: 9_999 }), null, filter({ costMin: 10_000 }))).toBe(
        false,
      );
    });

    it('treats a costless row as zero, so a minimum excludes it', () => {
      expect(matchesFilters(row({ originalCost: null }), null, filter({ costMin: 1 }))).toBe(false);
      expect(matchesFilters(row({ originalCost: null }), null, filter({ costMax: 100 }))).toBe(
        true,
      );
    });
  });

  describe('evidence', () => {
    it('splits the population in two and “any” keeps both', () => {
      const has = row({ evidencePresent: true });
      const hasnt = row({ evidencePresent: false });
      expect(matchesFilters(has, null, filter({ evidence: 'present' }))).toBe(true);
      expect(matchesFilters(hasnt, null, filter({ evidence: 'present' }))).toBe(false);
      expect(matchesFilters(hasnt, null, filter({ evidence: 'absent' }))).toBe(true);
      expect(matchesFilters(has, null, filter({ evidence: 'absent' }))).toBe(false);
      expect(matchesFilters(has, null, filter({ evidence: 'any' }))).toBe(true);
      expect(matchesFilters(hasnt, null, filter({ evidence: 'any' }))).toBe(true);
    });
  });

  describe('disposition', () => {
    it('reaches the undecided rows, which are the ones worth working', () => {
      expect(matchesFilters(row(), null, filter({ dispositions: ['undecided'] }))).toBe(true);
      expect(matchesFilters(row(), decision(), filter({ dispositions: ['undecided'] }))).toBe(
        false,
      );
    });

    it('is any-of over the three real answers', () => {
      const rejected = decision({ status: 'rejected' });
      expect(
        matchesFilters(row(), rejected, filter({ dispositions: ['accepted', 'rejected'] })),
      ).toBe(true);
      expect(matchesFilters(row(), rejected, filter({ dispositions: ['pending-client'] }))).toBe(
        false,
      );
    });
  });

  describe('reviewer', () => {
    it('matches who decided, exactly', () => {
      expect(
        matchesFilters(row(), decision(), filter({ reviewers: ['controller@client.com'] })),
      ).toBe(true);
      expect(matchesFilters(row(), decision(), filter({ reviewers: ['someone@else.com'] }))).toBe(
        false,
      );
    });

    it('never matches an undecided row', () => {
      expect(matchesFilters(row(), null, filter({ reviewers: ['controller@client.com'] }))).toBe(
        false,
      );
    });
  });

  describe('search', () => {
    it('is case-insensitive across description, tag, cost centre, site and year', () => {
      expect(matchesFilters(row(), null, filter({ query: 'optiplex' }))).toBe(true);
      expect(matchesFilters(row(), null, filter({ query: 'FA-1042' }))).toBe(true);
      expect(matchesFilters(row(), null, filter({ query: 'westpark' }))).toBe(true);
      expect(matchesFilters(row(), null, filter({ query: '2016' }))).toBe(true);
      expect(matchesFilters(row(), null, filter({ query: 'forklift' }))).toBe(false);
    });

    it('ignores a box holding only spaces', () => {
      expect(matchesFilters(row(), null, filter({ query: '   ' }))).toBe(true);
    });
  });

  it('ands the nine together — the done-when narrowing', () => {
    const wanted = filter({ confidence: ['high'], locations: ['site-houston'], costMin: 10_000 });
    expect(matchesFilters(row(), null, wanted)).toBe(true);
    expect(matchesFilters(row({ originalCost: 400 }), null, wanted)).toBe(false);
    expect(matchesFilters(row({ locationId: 'site-dallas' }), null, wanted)).toBe(false);
    expect(
      matchesFilters(row({ confidence: { ...row().confidence, tier: 'low' } }), null, wanted),
    ).toBe(false);
  });
});

describe('totalRows', () => {
  const population: ReviewableRow[] = [
    {
      row: row({ assetId: 'a', originalCost: 10_000, valueRemoved: 1_000, taxAtRisk: 25 }),
      decision: null,
    },
    {
      row: row({ assetId: 'b', originalCost: 5_000, valueRemoved: 500, taxAtRisk: 12.5 }),
      decision: null,
    },
  ];

  it('adds up what the filter selected', () => {
    expect(totalRows(population)).toEqual({
      rows: 2,
      originalCost: 15_000,
      valueRemoved: 1_500,
      taxAtRisk: 37.5,
      unpricedRows: 0,
    });
  });

  it('counts an unpriced row rather than scoring it zero', () => {
    // A table of blanks that sums to nothing reads as a worthless finding.
    // The count is what lets the screen say "and 1 not yet priced".
    const withPending: ReviewableRow[] = [
      ...population,
      {
        row: row({ assetId: 'c', originalCost: 900, valueRemoved: null, taxAtRisk: null }),
        decision: null,
      },
    ];
    const totals = totalRows(withPending);
    expect(totals.rows).toBe(3);
    expect(totals.unpricedRows).toBe(1);
    expect(totals.valueRemoved).toBe(1_500);
    expect(totals.originalCost).toBe(15_900);
  });

  it('is zero across the board on an empty selection', () => {
    expect(totalRows([])).toEqual({
      rows: 0,
      originalCost: 0,
      valueRemoved: 0,
      taxAtRisk: 0,
      unpricedRows: 0,
    });
  });
});

describe('facetsFor', () => {
  const population: ReviewableRow[] = [
    {
      row: row({ assetId: 'a', locationId: 'site-houston', siteLabel: 'Houston — Westpark' }),
      decision: null,
    },
    {
      row: row({
        assetId: 'b',
        locationId: 'site-houston',
        siteLabel: 'Houston — Westpark',
        costCenter: 'Ops',
        acquisitionYear: 2011,
        originalCost: 900,
        confidence: { ...row().confidence, tier: 'medium' },
      }),
      decision: decision({ assetId: 'b', status: 'rejected' }),
    },
    {
      row: row({
        assetId: 'c',
        locationId: null,
        siteLabel: null,
        acquisitionYear: 2021,
        originalCost: 60_000,
        confidence: { ...row().confidence, tier: 'low' },
      }),
      decision: null,
    },
  ];

  const facets = facetsFor(population);

  it('names the unplaced group rather than dropping it', () => {
    expect(facets.locations.map((l) => l.id)).toEqual(['site-houston', 'unplaced']);
    expect(facets.locations[1]).toMatchObject({ label: 'Not placed at a site', count: 1 });
  });

  it('orders options by how much is behind them', () => {
    expect(facets.locations[0]).toMatchObject({ id: 'site-houston', count: 2 });
    expect(facets.costCenters[0]).toMatchObject({ value: 'IT', count: 2 });
  });

  it('counts every tier and every disposition, including undecided', () => {
    expect(facets.confidence).toEqual({ high: 1, medium: 1, low: 1 });
    expect(facets.dispositions).toEqual({
      accepted: 0,
      rejected: 1,
      'pending-client': 0,
      undecided: 2,
    });
  });

  it('offers only reviewers who have actually decided something', () => {
    expect(facets.reviewers).toEqual([{ value: 'controller@client.com', count: 1 }]);
  });

  it('gives the range inputs real bounds', () => {
    expect(facets.acquired).toEqual({ min: 2011, max: 2021 });
    expect(facets.cost).toEqual({ min: 900, max: 60_000 });
  });

  it('returns null bounds rather than a zero range when nothing is dated or costed', () => {
    const bare = facetsFor([
      { row: row({ acquisitionYear: null, originalCost: null }), decision: null },
    ]);
    expect(bare.acquired).toBeNull();
    expect(bare.cost).toBeNull();
  });

  it('is drawn from the whole population so narrowing never removes an option', () => {
    // Filtering to Dallas must not make Houston unreachable on the way back.
    const selected = population.filter(({ row: r }) => r.locationId === 'site-houston');
    expect(facetsFor(selected).locations).toHaveLength(1);
    expect(facets.locations).toHaveLength(2);
  });

  it('has nothing to offer for an empty finding, and says so without throwing', () => {
    const none = facetsFor([]);
    expect(none.locations).toEqual([]);
    expect(none.confidence).toEqual({ high: 0, medium: 0, low: 0 });
    expect(none.acquired).toBeNull();
  });
});
