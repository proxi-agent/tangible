/**
 * Travis County, tax year 2026 — registered, and deliberately empty.
 *
 * Travis Central Appraisal District publishes no depreciation tables. Not
 * behind a login, not in an awkward format, not somewhere else on the site:
 * they are not published. This file exists to say so in the one place the
 * question comes up, because "we have not got to Travis yet" and "Travis does
 * not print what the other five print" are different facts and only one of
 * them is fixed by transcribing harder.
 *
 * What TCAD does publish is the method. Its 2025-2026 Reappraisal Plan, pp.
 * 52-53, describes present value factor tables built from Bureau of Labor
 * Statistics price indexes and utilization factors together with "the published
 * Iowa State percent good or remaining economic life depreciation factors",
 * applied across 723 business codes and 1,320 SIC grid segments — 666 for
 * furniture, fixtures and equipment and 654 for merchandise and supplies. Every
 * one of those numbers is in the plan. None of the factors is. The Mass
 * Appraisal Report for 2026 repeats the method and prints no grid either, and
 * the forms, renditions and open-government pages carry nothing.
 *
 * The two obvious substitutes are both wrong and worth naming so nobody
 * re-derives them. The Iowa State factors TCAD says it uses are a commercial
 * publication, so reproducing them here would be republishing somebody's
 * copyrighted table and, worse, guessing at which of its columns TCAD picked.
 * And the Comptroller's own BPP depreciation schedule, which is public and
 * looks exactly like what is wanted, is the Property Value Study table for
 * measuring school district values — it says on its face that appraisal
 * districts should develop schedules of their own. Valuing an Austin client
 * against either is the same silent cross-jurisdiction error that
 * `appliesStatewide` exists to prevent.
 *
 * So the tables stay empty and the status says why. `appraise` gaps on every
 * depreciable asset, which is correct: an empty index factor read as 1.000
 * understates the district's market value, which overstates the client's
 * overpayment, which is the one direction this product must never err. The gate
 * warns on the status and the quality board prints the gap. The way out is a
 * Public Information Act request to TCAD for the 2026 PVF tables — the plan
 * proves they exist and are in use, which is most of what such a request needs
 * to say.
 *
 * One line still values here, and it should. Inventory is carried at full cost
 * in Texas because Tex. Tax Code 23.12(a) says so, not because a district
 * published a column, so a Travis client's Schedule C total is as good as any
 * other county's. That it survives is the test of whether the emptiness above
 * is a rule about tables or a blanket refusal, and it is the first.
 */

import type { DepreciationSchedule } from '../types.js';

export const TX_TRAVIS_2026: DepreciationSchedule = {
  provenance: {
    ruleId: 'valuation:tx-travis:2026',
    title: 'Travis County BPP valuation tables, tax year 2026 — not published',
    citation:
      'Travis Central Appraisal District, 2025-2026 Reappraisal Plan, pp. 52-53 (method described; factor tables not published). Method authorised by Tex. Tax Code 23.01(b).',
    source: {
      title: 'TCAD 2025-2026 Reappraisal Plan',
      url: 'https://traviscad.org/wp-content/uploads/2025/06/2025-2026-Reappraisal-Plan.pdf',
      pages: '52-53',
    },
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    jurisdictions: ['tx-travis'],
    taxYears: [2026],
    authoredBy: 'kajmeri',
    authoredAt: '2026-08-28',
    approvedBy: null,
    approvedAt: null,
    notes:
      'No tables transcribed, because TCAD publishes none. The reappraisal plan and the 2026 mass appraisal report were both read end to end for a year-by-life grid and neither prints one. Registered so the gap is visible and citable rather than absent.',
  },
  jurisdictionId: 'tx-travis',
  jurisdictionName: 'Travis County, TX',
  taxYear: 2026,
  source: {
    title: 'TCAD 2025-2026 Reappraisal Plan',
    url: 'https://traviscad.org/wp-content/uploads/2025/06/2025-2026-Reappraisal-Plan.pdf',
    pages: '52-53',
  },
  indexFactors: {},
  percentGood: {},
  specialPercentGood: {
    pc: {},
    spc: {},
    mf: {},
    telecom4: {},
    telecom6: {},
    telecom8: {},
    solar10: {},
    veh: {},
  },
  sicProfiles: {},
  /**
   * No category block, deliberately, and it changes nothing at runtime — the
   * shared default applies either way, and the shared default is Harris
   * County's reading of each key: eight-year furniture, six-year leasehold
   * improvements. The tables above are empty, so none of those lives reaches an
   * asset regardless. What the omission changes is what this file *claims*.
   * Copying Harris's lives in here would put them under a Travis heading, where
   * the next reader would take them for something TCAD said. TCAD has said
   * nothing, and a file with no numbers in it should not look like one with
   * numbers in it.
   */
  status: 'awaiting-transcription',
  awaiting: {
    document: 'TCAD present value factor tables (SIC grid), tax year 2026',
    url: 'https://traviscad.org/wp-content/uploads/2025/06/2025-2026-Reappraisal-Plan.pdf',
    missing: [
      'Cost index / BLS price index factors by year acquired',
      'Percent good by life class and year acquired',
      'The 1,320-segment SIC grid mapping business code to life',
    ],
  },
};
