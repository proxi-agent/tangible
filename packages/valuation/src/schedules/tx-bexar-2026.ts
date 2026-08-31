/**
 * Bexar County's published business personal property valuation table for tax
 * year 2026.
 *
 * Source: Bexar Appraisal District, "Typical Personal Property Present Value
 * Factor Table, 2026 Tax Year" (December 2025), published on the district's
 * forms page as "Life Residual Index and Depreciation Tables".
 * https://bcad.org/wp-content/uploads/2026/03/BexarCAD_Typical-Personal-Property-PV-Factors_Dec-2025_030626.pdf
 *
 * The sixth jurisdiction, and the first whose column headings are neither a
 * life in years nor an equipment name. BCAD heads its nine columns 0410, 0520,
 * 0620, 0820, 1020, 1220, 1520, 2020 and 3020 — a life-residual code, which the
 * forms page confirms by calling the document a "Life Residual Index" table:
 * the first pair of digits is the economic life in years, the second is the
 * residual the column bottoms out at. Nothing had to be taken on trust, because
 * the tables prove it themselves. The 0410 column floors at exactly 10% and the
 * eight columns ending in 20 each floor at exactly 20%, in the year the column
 * stops. A residual reading that were wrong would have to be wrong in nine
 * places at once and land on the printed digits every time.
 *
 * Which means these are the ordinary life classes after all — 4, 5, 6, 8, 10,
 * 12, 15, 20 and 30, every one already published by some other district here.
 * Bexar is the first county to be added without widening a type.
 *
 * `costIndexIncluded` is set, and for a different reason than Dallas and
 * Collin. Those two publish the arithmetic product of a cost index and a
 * percent good, which is visible in the result: figures above 100, and figures
 * that rise as the asset ages. Nothing here does either — the table falls
 * monotonically and tops out at 97%. What BCAD publishes is a *conclusion*: its
 * note says the factor is "informed by nationally recognized Marshall & Swift
 * cost trends and depreciation schedules and calibrated based on local
 * appraisal experience", and represents "the appraiser's concluded present
 * value". The trending is inside the number and the district never applies an
 * index of its own, so trending it again here would value the asset above its
 * cost twice over. The flag means "already trended, do not trend again"; it does
 * not mean "expect a figure above 100". That was only ever a consequence of the
 * way Dallas and Collin publish.
 *
 * BCAD prints Year Acquired and Age side by side, so unlike Tarrant no age had
 * to be resolved into a year — and the two columns were checked against each
 * other across all 31 rows, which is one more thing this file did not have to
 * assume.
 *
 * Three checks on the transcription. Every cell was read by column x-anchor:
 * 119 placed, none left over, which matters here because "2020" is both a
 * column heading and a year in the leftmost column. Every column is contiguous
 * in the years it publishes. And every column bottoms out at its own residual,
 * as above.
 *
 * What BCAD does not publish is a SIC table. It stratifies by business code
 * internally — its reappraisal plan describes cost schedules "applied to
 * specific business codes" — but the only thing on paper is the asset-type
 * legend on page 2, which is what the category rules below were read off.
 */

import type { CategoryRule, DepreciationSchedule } from '../types.js';

/**
 * How BCAD's page-2 legend answers each shared category key.
 *
 * Every rule is `indexed: false`. Belt and braces: `costIndexIncluded` above is
 * what actually stops `appraise` trending, and `indexFactors` is empty, so a
 * rule that said otherwise would gap rather than silently inflate.
 */
const BEXAR_CATEGORIES: Readonly<Record<string, CategoryRule>> = {
  inventory: {
    key: 'inventory',
    label: 'Inventory',
    schedule: 'none',
    indexed: false,
    description:
      'Merchandise and supplies. BCAD publishes no column for inventory because the table is for depreciable assets; its reappraisal plan appraises inventory separately at market value under Tex. Tax Code 23.12(a), using FIFO cost less the taxpayer’s own lower-of-cost-or-market adjustment. Carried here at full cost, which is what a rendition reports.',
  },
  'furniture-fixtures': {
    key: 'furniture-fixtures',
    label: 'Furniture and fixtures',
    schedule: 8,
    indexed: false,
    description:
      'BCAD’s 0820 column, which its legend opens with "All Furniture & Fixtures". Eight years, which is Harris County’s answer and not Dallas’s or Tarrant’s ten or Collin’s nine.',
  },
  'office-equipment': {
    key: 'office-equipment',
    label: 'Office equipment',
    schedule: 8,
    indexed: false,
    description:
      'BCAD’s 0820 column, on "Office Equipment (Non-IT)". The district splits office equipment across two columns and the 0520 legend also says plainly "Office Equipment", alongside audio/visual systems and small electronic tools — so a client whose copiers and phones are read as electronic rather than as furniture belongs on five years, at a materially lower factor. Eight is taken because the qualifier "Non-IT" is the district’s own way of separating the two, and because it is the higher of the pair, which errs toward the district’s value rather than the client’s claim.',
  },
  'machinery-equipment': {
    key: 'machinery-equipment',
    label: 'Machinery and equipment',
    schedule: 10,
    indexed: false,
    description:
      'BCAD’s 1020 column, whose legend is trade-specific equipment: auto repair, bakery and confectionary, dry cleaning, medical and x-ray, broadcasting, mortuary. That is the equipment a mid-market client actually renders, and ten years is also what Dallas, Tarrant and Collin give machinery. But BCAD publishes a graded series and the other three rungs are real: light manufacturing equipment sits in the eight-year 0820 column, specialty manufacturing machinery and commercial food production in the twelve-year 1220, and heavy manufacturing, breweries, meat packing and amusement rides in the fifteen-year 1520. Which rung a given plant belongs on is a question for a preparer, not a default.',
  },
  'computer-pc': {
    key: 'computer-pc',
    label: 'Personal computers',
    schedule: 4,
    indexed: false,
    description:
      'BCAD’s 0410 column: "Computers, Laptops, Tablets". The only column in the table with a 10% residual rather than 20%, which is the district saying a four-year-old laptop is worth less of its cost than anything else it publishes.',
  },
  'computer-mainframe': {
    key: 'computer-mainframe',
    label: 'Mainframes and POS',
    schedule: 5,
    indexed: false,
    description:
      'BCAD’s 0520 column, which names "POS" and "Servers" in the same legend line. Unlike Tarrant, which puts point of sale on five years and excludes it by name from its computers column, Bexar keeps the two together, so this key needs no judgment call here.',
  },
  'specific-equipment': {
    key: 'specific-equipment',
    label: 'Specific equipment',
    schedule: 5,
    indexed: false,
    description:
      'BCAD’s 0520 column: "Audio/Visual Systems", "Small Electronic Tools", "Security Equipment". Telephone systems and the rest of the equipment this key covers in Harris County are electronic rather than IT, which is what the 0520 legend is for.',
  },
  'telecom-8': {
    key: 'telecom-8',
    label: 'Telecommunications equipment',
    schedule: 5,
    indexed: false,
    description:
      'BCAD’s 0520 column, on "Servers" — the same reading Collin and Tarrant got, where a mid-market client’s network gear is valued as short-life electronics rather than as infrastructure. Genuine carrier plant is a different column: 3020 names fiber optic equipment and utility transmission and distribution systems at thirty years, and a client that owns any belongs there.',
  },
  'leasehold-improvements': {
    key: 'leasehold-improvements',
    label: 'Leasehold improvements',
    schedule: 8,
    indexed: false,
    description:
      'BCAD publishes nothing for leasehold improvements. Eight is the district’s general-purpose column and sits between the two neighbours that do publish an answer — Harris says six, Tarrant says ten. Named here rather than left to the shared default, because the shared default is six and Bexar happens to publish a six-year column that is its vehicles line, which would have been a wrong answer that looked right.',
  },
  solar: {
    key: 'solar',
    label: 'Solar equipment',
    schedule: 20,
    indexed: false,
    description:
      'BCAD’s 2020 column, which names "Solar Panel Equipment" outright. The first district after Harris County to publish an answer for solar rather than leaving it to a default.',
  },
  vehicles: {
    key: 'vehicles',
    label: 'Licensed vehicles',
    schedule: 6,
    indexed: false,
    description:
      'BCAD’s 0620 column, whose legend begins "All Vehicles" — no split by weight, no separate line for fleets, and no rental or leasing exception of the kind Tarrant publishes. Six years, the same as Harris and Tarrant.',
  },
  vessels: {
    key: 'vessels',
    label: 'Vessels',
    schedule: 20,
    indexed: false,
    description:
      'BCAD publishes nothing for vessels. Twenty is the shared default and Bexar does publish a twenty-year column, so this is the default landing somewhere real rather than gapping — but the column it lands on is petroleum, quarry and utility plant, and nobody has confirmed a boat belongs there.',
  },
};

export const TX_BEXAR_2026: DepreciationSchedule = {
  provenance: {
    ruleId: 'valuation:tx-bexar:2026',
    title: 'Bexar County BPP present value factor table, tax year 2026',
    citation:
      'Bexar Appraisal District, Typical Personal Property Present Value Factor Table, 2026 Tax Year (December 2025). Method authorised by Tex. Tax Code 23.01(b) (market value determined by generally accepted appraisal methods).',
    source: {
      title: 'BCAD Typical Personal Property Present Value Factor Table, 2026 Tax Year',
      url: 'https://bcad.org/wp-content/uploads/2026/03/BexarCAD_Typical-Personal-Property-PV-Factors_Dec-2025_030626.pdf',
      pages: '1-2',
    },
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    jurisdictions: ['tx-bexar'],
    taxYears: [2026],
    authoredBy: 'kajmeri',
    authoredAt: '2026-08-28',
    approvedBy: null,
    approvedAt: null,
    notes:
      'Transcribed by column x-anchor from the published one-page table: 119 cells placed, none left over, every column contiguous, every column bottoming out at its own printed residual, and Year Acquired checked against the district’s own Age column across all 31 rows. The category assignments were read off the asset-type legend on page 2 and are not cell checks; three of them are judgment calls named in the outstanding-approval entry.',
  },
  jurisdictionId: 'tx-bexar',
  jurisdictionName: 'Bexar County, TX',
  taxYear: 2026,
  source: {
    title: 'BCAD Typical Personal Property Present Value Factor Table, 2026 Tax Year',
    url: 'https://bcad.org/wp-content/uploads/2026/03/BexarCAD_Typical-Personal-Property-PV-Factors_Dec-2025_030626.pdf',
    pages: '1-2',
  },

  /**
   * Empty, and it has to stay empty. BCAD publishes no cost index, because the
   * trending is already inside the factors below. An entry here would be
   * applied on top of them.
   */
  indexFactors: {},

  /**
   * Present value factor by life class, then by year acquired.
   *
   * The life class is the first pair of digits of BCAD's own column code; the
   * second pair is the residual the column stops at, which is why each table
   * below ends on exactly 10 or exactly 20.
   */
  percentGood: {
    // 0410 — life 4, residual 10
    4: { 2025: 75, 2024: 56, 2023: 42, 2022: 27, 2021: 10 },
    // 0520 — life 5, residual 20
    5: { 2025: 77, 2024: 64, 2023: 49, 2022: 33, 2021: 28, 2020: 20 },
    // 0620 — life 6, residual 20
    6: { 2025: 87, 2024: 75, 2023: 60, 2022: 44, 2021: 38, 2020: 31, 2019: 20 },
    // 0820 — life 8, residual 20
    8: { 2025: 85, 2024: 77, 2023: 66, 2022: 54, 2021: 51, 2020: 42, 2019: 33, 2018: 30, 2017: 20 },
    // 1020 — life 10, residual 20
    10: {
      2025: 92,
      2024: 87,
      2023: 80,
      2022: 71,
      2021: 63,
      2020: 55,
      2019: 47,
      2018: 39,
      2017: 31,
      2016: 23,
      2015: 20,
    },
    // 1220 — life 12, residual 20
    12: {
      2025: 95,
      2024: 93,
      2023: 89,
      2022: 84,
      2021: 79,
      2020: 74,
      2019: 68,
      2018: 61,
      2017: 55,
      2016: 49,
      2015: 43,
      2014: 37,
      2013: 20,
    },
    // 1520 — life 15, residual 20
    15: {
      2025: 95,
      2024: 93,
      2023: 89,
      2022: 84,
      2021: 78,
      2020: 72,
      2019: 66,
      2018: 59,
      2017: 53,
      2016: 47,
      2015: 41,
      2014: 35,
      2013: 29,
      2012: 23,
      2011: 21,
      2010: 20,
    },
    // 2020 — life 20, residual 20
    20: {
      2025: 97,
      2024: 96,
      2023: 94,
      2022: 92,
      2021: 88,
      2020: 84,
      2019: 80,
      2018: 76,
      2017: 71,
      2016: 66,
      2015: 61,
      2014: 56,
      2013: 51,
      2012: 46,
      2011: 41,
      2010: 37,
      2009: 33,
      2008: 30,
      2007: 28,
      2006: 26,
      2005: 20,
    },
    // 3020 — life 30, residual 20
    30: {
      2025: 97,
      2024: 96,
      2023: 95,
      2022: 93,
      2021: 91,
      2020: 90,
      2019: 88,
      2018: 86,
      2017: 84,
      2016: 82,
      2015: 80,
      2014: 78,
      2013: 75,
      2012: 72,
      2011: 69,
      2010: 65,
      2009: 61,
      2008: 57,
      2007: 54,
      2006: 50,
      2005: 49,
      2004: 43,
      2003: 42,
      2002: 37,
      2001: 36,
      2000: 31,
      1999: 26,
      1998: 25,
      1997: 24,
      1996: 23,
      1995: 20,
    },
  },

  /**
   * Empty. Every one of BCAD's nine columns is a life class, so nothing here is
   * keyed by equipment type and no category rule points at one.
   */
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

  /**
   * Empty. BCAD stratifies by business code internally — its reappraisal plan
   * describes cost schedules "applied to specific business codes" — but nothing
   * mapping a SIC to a life is published, so there is nothing to look up.
   */
  sicProfiles: {},
  categories: BEXAR_CATEGORIES,
  costIndexIncluded: true,
  status: 'committed',
};
