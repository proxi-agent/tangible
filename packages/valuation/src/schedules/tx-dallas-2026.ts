import type { CategoryRule, DepreciationSchedule } from '../types.js';

/**
 * Dallas County, tax year 2026 — the third jurisdiction, and the first one that
 * does not publish its method the way Harris County does.
 *
 * Transcribed from DCAD's "Business Personal Property 2026 Consolidated Cost
 * Index and Depreciation Schedule Worksheet", a single landscape page.
 *
 * **The worksheet publishes one number where Harris publishes two.** Its
 * columns are headed "RC / YR LND" — replacement cost less normal depreciation,
 * as a percentage of original cost — and the title says so: *consolidated* cost
 * index and depreciation schedule. The index is already inside the percentage.
 * There is no separate factor table to transcribe because DCAD does not publish
 * one, and there is no honest way to split the product back into its halves.
 * Hence `costIndexIncluded`, and hence `indexFactors: {}`.
 *
 * Two things follow that would be transcription bugs anywhere else in this
 * package, and are neither here:
 *
 *   - *Figures above 100.* A twenty-five-year asset acquired in 2020 is 107%.
 *     Six years of construction inflation outran six years of depreciation on a
 *     twenty-five-year life, and the worksheet prints the result.
 *   - *Columns that rise before they fall.* Every column from eight years up
 *     runs 2022 below 2021 — the 2021 and 2020 acquisition years sit at the top
 *     of the post-2020 cost run-up. Percent good never rises with age; RCLND
 *     does, and the longer the life the longer the index wins.
 *
 * **How the reading was checked.** The page prints category labels *inside* the
 * numeric columns, in the whitespace below each column's last year, so reading
 * it line by line interleaves the words "flatware" and "vending machines" into
 * the figures. It was extracted by column x-coordinate against the YR/LND
 * header anchors instead, and then pinned against four things:
 *
 *   1. The worksheet's own footnote: "For example on 5 year life assets, any
 *      assets purchased prior to 2018, total the assets' cost and apply 13%
 *      RCLND." The five-year column below ends at 2018 → 13.
 *   2. The other footnote — "For prior year assets, total the assets purchased
 *      and apply the lowest percentage shown" — is `lookupPercentGood`'s floor
 *      rule exactly. It holds only because in all eleven columns the oldest
 *      published year is also the lowest figure, which was checked cell by
 *      cell; the non-monotonicity is entirely interior.
 *   3. Every column is read against its own YR sub-column rather than the row's
 *      leftmost year, so a row that slipped would drop out rather than shift.
 *      None did: all 187 cells carry a year of their own.
 *   4. The three-year column ends at 2022, not 2021. Read line by line it
 *      appears to continue 2021 → 23%, which is the four-year column's cell
 *      bleeding left across the gap where the three-year column has stopped.
 *
 * **One figure is out of line and is transcribed as published.** The
 * twenty-five-year column reads 2003 → 83%, 2002 → 93%, 2001 → 79%. The 93 sits
 * at the twenty-five-year column's own x-position and is what DCAD printed; it
 * is almost certainly their typo for 83. Correcting it here would raise a
 * client's claim against a number the district can point at, and leaving it
 * raises the district's computed value slightly, which understates the client's
 * overpayment. That is the safe direction, so it stands.
 *
 * **DCAD publishes no business-line table.** Its valuation-process page says
 * the division carries "over 400 business identification types", but the
 * mapping is internal and never published. So `sicProfiles` is empty and
 * machinery falls to its category life, which `lifeSource` reports as
 * `category` rather than `sic`. This is a real difference from Harris County,
 * where the SIC-driven life is the single largest lever on a rendition.
 *
 * Sources:
 *   - 2026 Consolidated Cost Index and Depreciation Schedule Worksheet
 *     https://www.dallascad.org/ViewPDFs.aspx?type=1&id=%5C%5CDCAD.ORG%5CWEB%5CWEBDATA%5CWEBFORMS%5CBPP%5C2026Depr.pdf
 *   - BPP Valuation Process (11/25), for the cost approach and the 400 business
 *     types.
 *   - HB 9 notice bound with the 2026 leased-equipment rendition, for the
 *     $125,000 exemption applied automatically and aggregated by physical
 *     address.
 */

/**
 * Where Dallas parts company with the shared category defaults.
 *
 * The keys are the shared vocabulary and stay that way — a classification made
 * for a client in Harris County has to survive the client opening a Dallas
 * site. What changes is which column each key points at, and DCAD answers that
 * question directly: the worksheet prints a list of equipment under each life
 * column, in the space below where that column's years run out.
 *
 * Four keys move against Harris County, and each one is DCAD's own print:
 *
 *   - *Furniture and fixtures* is a ten-year class here against eight in
 *     Harris. "furniture & fixtures" is printed under 10 Years.
 *   - *General office equipment* is five against six. "copier and fax" and
 *     "phone systems" are printed under 5 Years.
 *   - *Telecommunications equipment* is five, against Harris's named eight-year
 *     `telecom8` schedule, which DCAD does not publish at all. "phone systems"
 *     and "mobile phones" are both under 5 Years.
 *   - *Mainframe and point of sale* is the ordinary computer column. Harris
 *     runs separate `pc`, `spc` and `mf` schedules; DCAD publishes one column
 *     headed "Computers".
 *
 * `indexed` is false throughout, which is a statement about DCAD rather than
 * about the categories: the tables are already trended. `appraise` enforces
 * that from `costIndexIncluded` and does not rely on these flags.
 */
const DALLAS_CATEGORIES: Record<string, CategoryRule> = {
  inventory: {
    key: 'inventory',
    label: 'Inventory and supplies',
    schedule: 'none',
    indexed: false,
    description:
      'Rendered at cost on Schedule C. Texas taxes inventory; no depreciation applies and DCAD publishes no column for it.',
  },
  'furniture-fixtures': {
    key: 'furniture-fixtures',
    label: 'Furniture and fixtures',
    schedule: 10,
    indexed: false,
    description:
      'DCAD prints "furniture & fixtures" under the 10 Years column. Harris County depreciates the same property over eight, so a client moving between the two counties is valued differently on identical desks.',
  },
  'office-equipment': {
    key: 'office-equipment',
    label: 'General office equipment',
    schedule: 5,
    indexed: false,
    description:
      'DCAD prints "copier and fax" and "phone systems" under the 5 Years column. The 6 Years column carries no printed equipment list at all.',
  },
  'machinery-equipment': {
    key: 'machinery-equipment',
    label: 'Machinery and equipment',
    schedule: 10,
    indexed: false,
    sicDriven: false,
    description:
      'Ten years, and not driven by the line of business: DCAD publishes no table mapping business type to life, so there is nothing to read a SIC code against. "small equip" is printed under 8 Years and heavier plant under 10, so a specific machine may warrant an override.',
  },
  'computer-pc': {
    key: 'computer-pc',
    label: 'Computer equipment (PC)',
    schedule: 'pc',
    indexed: false,
    description:
      'The worksheet’s "Computers % Good" column, which unlike the life columns is ordinary untrended percent good — it falls with age and never exceeds 100.',
  },
  'computer-mainframe': {
    key: 'computer-mainframe',
    label: 'Mainframe and point of sale',
    schedule: 'pc',
    indexed: false,
    description:
      'The same Computers column. DCAD draws no line between a PC and a mainframe, so point-of-sale and server hardware take the one published computer schedule rather than a slower one.',
  },
  'specific-equipment': {
    key: 'specific-equipment',
    label: 'Specific equipment',
    schedule: 'spc',
    indexed: false,
    description:
      'A Harris County schedule with no Dallas counterpart. DCAD publishes nothing for it, so property left in this category comes back as a gap rather than a value — reclassify it to the life class that fits.',
  },
  'telecom-8': {
    key: 'telecom-8',
    label: 'Telecommunications equipment',
    schedule: 5,
    indexed: false,
    description:
      'Five years. DCAD publishes no named telecommunications schedule and prints "phone systems" and "mobile phones" under 5 Years, against the eight-year schedule Harris County runs.',
  },
  'leasehold-improvements': {
    key: 'leasehold-improvements',
    label: 'Leasehold improvements',
    schedule: 6,
    indexed: false,
    description:
      'Six years, carried over from the Harris default because DCAD prints no equipment list under its 6 Years column. Tax Code 23.24 still bars appraising as personal property an improvement already in the real-property value, and that argument is statewide.',
  },
  solar: {
    key: 'solar',
    label: 'Solar energy device',
    schedule: 10,
    indexed: false,
    description:
      'Ten years. Not named on the worksheet; the exemption under Tax Code 11.27 is the question that matters here rather than the life.',
  },
  vehicles: {
    key: 'vehicles',
    label: 'Licensed vehicles',
    schedule: 5,
    indexed: false,
    description:
      'DCAD prints "cars l pickups" under 5 Years and "buses / trucks" and "heavy vehicles one ton or greater" under 8. Five is the ordinary case and the default; a fleet of one-ton-and-over trucks should be overridden to eight, which values them higher.',
  },
  vessels: {
    key: 'vessels',
    label: 'Vessels',
    schedule: 20,
    indexed: false,
    description:
      'Twenty years, carried over from the Harris default. Not named on the DCAD worksheet.',
  },
};

export const TX_DALLAS_2026: DepreciationSchedule = {
  provenance: {
    ruleId: 'valuation:tx-dallas:2026',
    title: 'Dallas CAD 2026 consolidated cost index and depreciation schedule',
    citation:
      'Dallas Central Appraisal District, Business Personal Property 2026 Consolidated Cost Index and Depreciation Schedule Worksheet (single page, landscape), read together with the district’s BPP Valuation Process page dated 11/25.',
    source: {
      title:
        'Business Personal Property 2026 Consolidated Cost Index and Depreciation Schedule Worksheet',
      url: 'https://www.dallascad.org/ViewPDFs.aspx?type=1&id=%5C%5CDCAD.ORG%5CWEB%5CWEBDATA%5CWEBFORMS%5CBPP%5C2026Depr.pdf',
      pages: 'the whole page',
    },
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    jurisdictions: ['tx-dallas'],
    taxYears: [2026],
    authoredBy: 'transcribed by column coordinate from the published worksheet',
    authoredAt: '2026-08-28',
    // Nobody has checked these tables cell by cell against the guide.
    approvedBy: null,
    approvedAt: null,
    notes:
      'RCLND, not percent good: the cost index is consolidated into the printed percentage, so figures exceed 100 and do not fall monotonically with age. The 25-year column’s 2002 cell reads 93% between 83% and 79% and is transcribed as published.',
  },
  jurisdictionId: 'tx-dallas',
  jurisdictionName: 'Dallas County, TX',
  taxYear: 2026,
  source: {
    title: 'DCAD 2026 Consolidated Cost Index and Depreciation Schedule Worksheet',
    url: 'https://www.dallascad.org/ViewPDFs.aspx?type=1&id=%5C%5CDCAD.ORG%5CWEB%5CWEBDATA%5CWEBFORMS%5CBPP%5C2026Depr.pdf',
    pages: 'the whole page',
  },
  /**
   * Empty on purpose, and the one case in this package where that is not a
   * hole. DCAD publishes no index factors because it has already applied them:
   * see `costIndexIncluded`. `appraise` never reaches this table for a Dallas
   * asset.
   */
  indexFactors: {},
  /**
   * Life class → year acquired → RCLND as a percentage of original cost.
   *
   * No 30-year column: DCAD's worksheet stops at 25. An asset that resolves to
   * thirty years comes back as a gap, which is correct — there is nothing
   * published to value it against.
   */
  percentGood: {
    3: {
      2025: 67,
      2024: 46,
      2023: 32,
      2022: 14,
    },
    4: {
      2025: 75,
      2024: 58,
      2023: 44,
      2022: 35,
      2021: 23,
      2020: 14,
    },
    5: {
      2025: 80,
      2024: 67,
      2023: 54,
      2022: 44,
      2021: 42,
      2020: 29,
      2019: 18,
      2018: 13,
    },
    6: {
      2025: 83,
      2024: 72,
      2023: 61,
      2022: 52,
      2021: 51,
      2020: 45,
      2019: 32,
      2018: 23,
      2017: 16,
    },
    8: {
      2025: 88,
      2024: 80,
      2023: 71,
      2022: 64,
      2021: 65,
      2020: 62,
      2019: 54,
      2018: 49,
      2017: 39,
      2016: 30,
      2015: 23,
      2014: 18,
    },
    10: {
      2025: 90,
      2024: 85,
      2023: 77,
      2022: 71,
      2021: 75,
      2020: 73,
      2019: 66,
      2018: 62,
      2017: 58,
      2016: 53,
      2015: 42,
      2014: 35,
      2013: 29,
      2012: 23,
      2011: 19,
    },
    12: {
      2025: 92,
      2024: 88,
      2023: 82,
      2022: 77,
      2021: 82,
      2020: 81,
      2019: 75,
      2018: 72,
      2017: 68,
      2016: 64,
      2015: 57,
      2014: 53,
      2013: 46,
      2012: 39,
      2011: 33,
      2010: 30,
      2009: 24,
      2008: 20,
    },
    15: {
      2025: 93,
      2024: 91,
      2023: 86,
      2022: 82,
      2021: 90,
      2020: 91,
      2019: 86,
      2018: 83,
      2017: 80,
      2016: 76,
      2015: 71,
      2014: 67,
      2013: 63,
      2012: 59,
      2011: 57,
      2010: 51,
      2009: 44,
      2008: 39,
      2007: 35,
      2006: 33,
      2005: 31,
      2004: 29,
    },
    18: {
      2025: 94,
      2024: 93,
      2023: 89,
      2022: 86,
      2021: 95,
      2020: 98,
      2019: 93,
      2018: 90,
      2017: 89,
      2016: 85,
      2015: 80,
      2014: 76,
      2013: 74,
      2012: 70,
      2011: 67,
      2010: 66,
      2009: 62,
      2008: 60,
      2007: 56,
      2006: 51,
      2005: 48,
      2004: 48,
      2003: 43,
      2002: 39,
      2001: 35,
      2000: 31,
    },
    20: {
      2025: 95,
      2024: 94,
      2023: 91,
      2022: 87,
      2021: 97,
      2020: 102,
      2019: 97,
      2018: 95,
      2017: 93,
      2016: 91,
      2015: 86,
      2014: 82,
      2013: 78,
      2012: 76,
      2011: 73,
      2010: 72,
      2009: 68,
      2008: 67,
      2007: 66,
      2006: 66,
      2005: 61,
      2004: 60,
      2003: 56,
      2002: 52,
      2001: 46,
      2000: 42,
      1999: 38,
      1998: 36,
    },
    25: {
      2025: 96,
      2024: 96,
      2023: 93,
      2022: 92,
      2021: 104,
      2020: 107,
      2019: 104,
      2018: 103,
      2017: 102,
      2016: 100,
      2015: 96,
      2014: 92,
      2013: 91,
      2012: 87,
      2011: 86,
      2010: 85,
      2009: 81,
      2008: 80,
      2007: 80,
      2006: 81,
      2005: 81,
      2004: 85,
      2003: 83,
      2002: 93,
      2001: 79,
      2000: 73,
      1999: 70,
      1998: 63,
      1997: 59,
      1996: 55,
      1995: 52,
      1994: 49,
      1993: 47,
      1992: 43,
      1991: 41,
    },
  },
  /**
   * Only the Computers column, which the worksheet heads "% Good" rather than
   * "RC/YR LND" — and it behaves like one: it falls with age, tops out at 75%
   * and floors at 5%. Everything computer-shaped routes here, because DCAD
   * publishes no equivalent of Harris County's separate mainframe, specific
   * equipment and telecommunications schedules.
   */
  specialPercentGood: {
    pc: {
      2025: 75,
      2024: 56,
      2023: 28,
      2022: 10,
      2021: 5,
      2020: 5,
      2019: 5,
    },
    spc: {},
    mf: {},
    telecom4: {},
    telecom6: {},
    telecom8: {},
    solar10: {},
    veh: {},
  },
  /**
   * Empty because DCAD publishes nothing to fill it. The district's own
   * valuation-process page describes "over 400 business identification types",
   * so a mapping from line of business to life plainly exists inside MARS — it
   * is simply not a public document, and inventing one from Harris County's
   * would be valuing a Dallas client against another county's method.
   */
  sicProfiles: {},
  categories: DALLAS_CATEGORIES,
  costIndexIncluded: true,
  status: 'committed',
};
