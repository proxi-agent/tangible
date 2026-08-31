import { describe, expect, it } from 'vitest';
import { appraise } from './appraise.js';
import { categoriesFor } from './categories.js';
import { SCHEDULES, scheduleFor, scheduledJurisdictions } from './registry.js';
import { TX_TRAVIS_2026 as TR } from './schedules/tx-travis-2026.js';

/**
 * Travis is registered and values almost nothing, and both halves of that are
 * the point.
 *
 * TCAD publishes no depreciation tables — its reappraisal plan describes them
 * across two pages and prints none of the factors — so this is the first
 * jurisdiction in the registry whose emptiness is a fact about the district
 * rather than about how far the transcription has got. These tests pin the
 * behaviour that makes that safe to ship: the gap is loud, it is a gap rather
 * than a quiet 1.000, and no neighbouring county leaks in to fill it.
 */
describe('Travis', () => {
  it('is registered, so the gap is visible rather than absent', () => {
    expect(SCHEDULES).toContain(TR);
    expect(scheduleFor('tx-travis', 2026)?.jurisdictionId).toBe('tx-travis');
    expect(scheduledJurisdictions().map((j) => j.id)).toContain('tx-travis');
  });

  it('says which document is missing and what is missing out of it', () => {
    expect(TR.status).toBe('awaiting-transcription');
    expect(TR.awaiting?.document).toMatch(/present value factor/i);
    expect(TR.awaiting?.missing.length).toBeGreaterThan(0);
    // The gate reads `status` and the quality board reads `awaiting`. A
    // schedule with the status and no gap warns without saying what to go and
    // read, which is the version of this that helps nobody.
    expect(TR.awaiting).toBeDefined();
  });

  it('carries no tables at all, rather than partial ones', () => {
    expect(Object.keys(TR.indexFactors)).toHaveLength(0);
    expect(Object.keys(TR.percentGood)).toHaveLength(0);
    expect(Object.keys(TR.sicProfiles)).toHaveLength(0);
    for (const table of Object.values(TR.specialPercentGood)) {
      expect(Object.keys(table)).toHaveLength(0);
    }
  });

  it('gaps on every depreciable asset instead of reading a missing factor as 1.000', () => {
    // The failure this prevents is silent and falls the wrong way: an absent
    // index factor treated as 1.000 understates the district's market value,
    // which overstates the client's overpayment.
    for (const category of categoriesFor(TR)) {
      if (category.schedule === 'none' || category.schedule === 'exempt') continue;
      const result = appraise(
        { originalCost: 10_000, acquisitionYear: 2022, categoryKey: category.key },
        TR,
      );
      expect(`${category.key}:${result.ok}`).toBe(`${category.key}:false`);
    }
  });

  it('still values inventory, because that answer comes from the statute and not from TCAD', () => {
    const result = appraise(
      { originalCost: 400_000, acquisitionYear: 2024, categoryKey: 'inventory' },
      TR,
    );
    if (!result.ok) throw new Error(`expected an appraisal, got gap: ${result.gap.detail}`);
    expect(result.value.marketValue).toBe(400_000);
    // Tex. Tax Code 23.12(a) carries inventory at cost in every Texas county,
    // published tables or not. If this ever gaps, the emptiness above has
    // stopped being a rule about tables and become a blanket refusal.
    expect(result.value.percentGood).toBe(100);
  });

  it('is not quietly valued on a neighbouring county or on Florida', () => {
    expect(scheduleFor('tx-travis', 2026)?.jurisdictionId).not.toBe('tx-harris');
    expect(TR.appliesStatewide).toBeUndefined();
    // And nothing else in Texas has picked up statewide standing either, which
    // is what would make this fallback possible in the first place.
    expect(
      SCHEDULES.filter((s) => s.jurisdictionId.startsWith('tx-') && s.appliesStatewide),
    ).toHaveLength(0);
  });
});
