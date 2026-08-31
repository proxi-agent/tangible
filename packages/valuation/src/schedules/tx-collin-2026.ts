import type { CategoryRule, DepreciationSchedule } from '../types.js';

/**
 * Collin County, 2026.
 *
 * The fourth jurisdiction and the second of the consolidated kind. Like Dallas,
 * CCAD publishes one number where Harris publishes two — its columns are headed
 * "PVF", present value factor, and the sheet states the arithmetic outright:
 * "THE ORIGINAL COST IS MULTIPLIED BY THE PRESENT VALUE FACTOR (PVF) FOR THE
 * ACQUISITION YEAR ... (MARKET VALUE ESTIMATE = HISTORICAL COST x PVF)". So
 * `costIndexIncluded` is set, `indexFactors` is empty, and the figures behave
 * the way a trended table behaves: the twenty-year column reads 106% for 2020
 * and rises for four years before it falls.
 *
 * Two things here are new to this package.
 *
 * The first is the seven- and nine-year life classes. No other district in the
 * registry publishes either, which is why `LIFE_CLASSES` is a union and
 * `percentGood` is partial. Nine is not a rounding of ten: CCAD prints both and
 * puts office furniture on nine and manufacturing equipment on ten.
 *
 * The second is `veh`. CCAD publishes a separate column for vehicles under one
 * ton, and it is close to the five-year line without being it — 80/64/51/41
 * against 85/71/54/36. Folding one into the other would have been a
 * transcription that reads as a fact, so vehicles got a special schedule
 * instead, and every district that has no such column leaves it empty.
 *
 * What CCAD gives that DCAD does not is a published business-line legend: under
 * each column the sheet prints what belongs in it, from "LAPTOPS" through
 * "BATCH PLANTS". That legend is what the category rules below are read off,
 * and it is why several of them disagree with both Harris and Dallas. It is
 * still not a SIC table — it names equipment, not lines of business — so
 * `sicProfiles` is empty and the SIC lever does not exist here either.
 *
 * Transcription checks, since nobody has read the cells back yet:
 *
 *   1. Every cell was read against its own column x-anchor rather than off a
 *      line of text, because the legend beneath the grid prints words like
 *      "VENDING MACHINES" inside the numeric columns and a line-based read
 *      attributes them to the wrong one. 142 cells parsed, none left over.
 *   2. Every column's published years are contiguous, so a dropped row would
 *      have shown up as a hole rather than as a silent shift. None did.
 *   3. The COMPUTERS column — 78/56/35/13/10 — is HCAD's `pc` table cell for
 *      cell. Two districts arriving independently at the same five figures is
 *      the strongest external check available on this extraction, and the
 *      three-year column matching Dallas's is a second.
 *   4. Every column falls to its own lowest figure in its oldest published
 *      year, which is what makes `lookupPercentGood`'s floor rule the
 *      district's own rule rather than one imposed on it.
 */
const COLLIN_CATEGORIES: Readonly<Record<string, CategoryRule>> = {
  inventory: {
    key: 'inventory',
    label: 'Inventory and supplies',
    schedule: 'none',
    indexed: false,
    description:
      'Finished goods, supplies, raw materials, and work in process, carried at cost. CCAD’s worksheet is a schedule for depreciable assets and does not reach inventory.',
  },
  'furniture-fixtures': {
    key: 'furniture-fixtures',
    label: 'Furniture and fixtures',
    schedule: 9,
    indexed: false,
    description:
      'Desks, seating, shelving, casework, and fixtures. CCAD prints "OFFICE FURNITURE & FIXTURES" and "RETAIL FIXTURES & EQUIPMENT" under nine years — a class no other district in this registry publishes at all, and one year longer than Harris County’s eight.',
  },
  'office-equipment': {
    key: 'office-equipment',
    label: 'General office equipment',
    schedule: 5,
    indexed: false,
    description:
      'Copiers, fax machines and telephones, which CCAD prints together under five years as "OFFICE EQUIP (COPIER, FAX, PHONE)". Harris County gives the same assets six.',
  },
  'machinery-equipment': {
    key: 'machinery-equipment',
    label: 'Machinery and equipment',
    schedule: 10,
    indexed: false,
    description:
      'Production and shop machinery, on CCAD’s ten-year "MANUFACTURING EQUIPMENT" line. Note that the district also prints "MACHINERY & EQUIPMENT" one column to the left, at nine years; shop machinery that is not manufacturing belongs there, and moving it is a reviewer’s call because it lowers the value.',
  },
  'computer-pc': {
    key: 'computer-pc',
    label: 'Computer equipment (PC)',
    schedule: 'pc',
    indexed: false,
    description:
      'Laptops, personal computers, peripheral equipment, printers and scanners, on CCAD’s own COMPUTERS column. The sheet adds that software is exempt.',
  },
  'computer-mainframe': {
    key: 'computer-mainframe',
    label: 'Mainframe and point of sale',
    schedule: 4,
    indexed: false,
    description:
      'Mainframes, servers, routers and high-tech computer equipment, together with computerized point-of-sale scanners and registers. CCAD puts both halves of this category on four years, which is the one place its answer is simpler than Harris County’s two separate tables.',
  },
  'specific-equipment': {
    key: 'specific-equipment',
    label: 'Specific equipment',
    schedule: 5,
    indexed: false,
    description:
      'Telephone systems, fax machines and similar. CCAD does not publish a column of this name; the assets it covers are the ones the district prints under five years as office equipment. Cell phones and pagers are its three-year line and should be moved there.',
  },
  'telecom-8': {
    key: 'telecom-8',
    label: 'Telecommunications equipment',
    schedule: 4,
    indexed: false,
    description:
      'Servers and routers, which CCAD names in its four-year column rather than giving telecommunications a life of its own. Cell site towers are the district’s twenty-year line and cell phones its three; neither is the default here.',
  },
  'leasehold-improvements': {
    key: 'leasehold-improvements',
    label: 'Leasehold improvements',
    schedule: 6,
    indexed: false,
    description:
      'Tenant build-out carried as personal property. CCAD publishes no line for it, so the shared six-year life stands, untrended like everything else on this sheet. Tax Code 23.24 still bars taxing an improvement the landlord’s real-property appraisal already includes.',
  },
  solar: {
    key: 'solar',
    label: 'Solar energy device',
    schedule: 10,
    indexed: false,
    description:
      'On-site solar generation. CCAD publishes no line for it; ten years is the shared default. The Tax Code 11.27 exemption is a separate application.',
  },
  vehicles: {
    key: 'vehicles',
    label: 'Licensed vehicles',
    schedule: 'veh',
    indexed: false,
    description:
      'CCAD prints its own column for "VEHICLES (UNDER ONE TON)", which is why this is a special schedule rather than a life in years. Heavier vehicles are elsewhere on the sheet: pick-ups of one ton and up are six years, and buses, freight trucks, mixers and dumps are eight.',
  },
  vessels: {
    key: 'vessels',
    label: 'Vessels',
    schedule: 20,
    indexed: false,
    description:
      'Marine vessels. CCAD publishes no line for them; twenty years is the shared default and the district’s longest published class.',
  },
};

export const TX_COLLIN_2026: DepreciationSchedule = {
  provenance: {
    ruleId: 'valuation:tx-collin:2026',
    title: 'Collin CAD 2026 consolidated cost index and depreciation schedule',
    citation:
      'Collin Central Appraisal District, Business Personal Property 2026 Consolidated Cost Index – Depreciation Schedule (single page, landscape), revision 2026.01.07.',
    source: {
      title: 'Business Personal Property 2026 Consolidated Cost Index – Depreciation Schedule',
      url: 'https://collincad.org/wp-content/uploads/CCAD-BPPDS.pdf',
      pages: 'the whole page',
    },
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    jurisdictions: ['tx-collin'],
    taxYears: [2026],
    authoredBy: 'transcribed by column coordinate from the published worksheet',
    authoredAt: '2026-08-28',
    // Nobody has checked these tables cell by cell against the sheet.
    approvedBy: null,
    approvedAt: null,
    notes:
      'Present value factors, not percent good: the cost index is consolidated into the printed percentage, so figures exceed 100 and do not fall monotonically with age. Publishes seven- and nine-year life classes no other district in the registry has, and a vehicles column of its own.',
  },
  jurisdictionId: 'tx-collin',
  jurisdictionName: 'Collin County, TX',
  taxYear: 2026,
  source: {
    title: 'CCAD 2026 Consolidated Cost Index – Depreciation Schedule',
    url: 'https://collincad.org/wp-content/uploads/CCAD-BPPDS.pdf',
    pages: 'the whole page',
  },
  /**
   * Empty on purpose. CCAD publishes no index factors because the PVF columns
   * already carry them; see `costIndexIncluded`. `appraise` never reaches this
   * table for a Collin asset.
   */
  indexFactors: {},
  percentGood: {
    3: {
      2025: 67,
      2024: 46,
      2023: 32,
      2022: 14,
    },
    4: {
      2025: 83,
      2024: 66,
      2023: 49,
      2022: 32,
      2021: 15,
      2020: 10,
    },
    5: {
      2025: 85,
      2024: 71,
      2023: 54,
      2022: 36,
      2021: 29,
      2020: 25,
      2019: 18,
      2018: 13,
    },
    6: {
      2025: 87,
      2024: 75,
      2023: 60,
      2022: 44,
      2021: 38,
      2020: 31,
      2019: 26,
      2018: 23,
      2017: 16,
    },
    7: {
      2025: 89,
      2024: 79,
      2023: 65,
      2022: 51,
      2021: 46,
      2020: 38,
      2019: 31,
      2018: 28,
      2017: 23,
      2016: 18,
    },
    8: {
      2025: 90,
      2024: 82,
      2023: 70,
      2022: 58,
      2021: 54,
      2020: 45,
      2019: 36,
      2018: 33,
      2017: 29,
      2016: 23,
      2015: 19,
    },
    9: {
      2025: 91,
      2024: 85,
      2023: 75,
      2022: 65,
      2021: 64,
      2020: 56,
      2019: 45,
      2018: 37,
      2017: 32,
      2016: 30,
      2015: 25,
      2014: 19,
    },
    10: {
      2025: 92,
      2024: 87,
      2023: 80,
      2022: 71,
      2021: 73,
      2020: 67,
      2019: 53,
      2018: 43,
      2017: 35,
      2016: 31,
      2015: 30,
      2014: 25,
      2013: 19,
    },
    12: {
      2025: 94,
      2024: 90,
      2023: 84,
      2022: 78,
      2021: 83,
      2020: 79,
      2019: 68,
      2018: 61,
      2017: 53,
      2016: 43,
      2015: 36,
      2014: 33,
      2013: 30,
      2012: 27,
      2011: 20,
    },
    15: {
      2025: 95,
      2024: 93,
      2023: 89,
      2022: 84,
      2021: 91,
      2020: 93,
      2019: 85,
      2018: 78,
      2017: 72,
      2016: 64,
      2015: 55,
      2014: 46,
      2013: 39,
      2012: 35,
      2011: 33,
      2010: 32,
      2009: 29,
      2008: 25,
    },
    20: {
      2025: 97,
      2024: 98,
      2023: 94,
      2022: 92,
      2021: 103,
      2020: 106,
      2019: 101,
      2018: 99,
      2017: 95,
      2016: 90,
      2015: 82,
      2014: 75,
      2013: 68,
      2012: 61,
      2011: 55,
      2010: 50,
      2009: 43,
      2008: 40,
      2007: 38,
      2006: 38,
      2005: 38,
      2004: 36,
      2003: 30,
    },
  },
  specialPercentGood: {
    /**
     * CCAD's COMPUTERS column, and cell for cell the same five figures HCAD
     * publishes for personal computers. Two districts landing on identical
     * numbers is the only independent corroboration this transcription has.
     */
    pc: {
      2025: 78,
      2024: 56,
      2023: 35,
      2022: 13,
      2021: 10,
    },
    /** "VEHICLES (UNDER ONE TON)", the district's own column. */
    veh: {
      2025: 80,
      2024: 64,
      2023: 51,
      2022: 41,
      2021: 33,
      2020: 25,
      2019: 20,
      2018: 15,
    },
    spc: {},
    mf: {},
    telecom4: {},
    telecom6: {},
    telecom8: {},
    solar10: {},
  },
  /**
   * Empty. The legend under CCAD's grid names equipment — "CRANES", "GOLF
   * CARTS", "VENDING MACHINES" — not lines of business, so there is nothing
   * here to key on a SIC code. The Harris County lever does not exist in
   * Collin, and borrowing HCAD's table would value a Collin client against
   * another county's method.
   */
  sicProfiles: {},
  categories: COLLIN_CATEGORIES,
  costIndexIncluded: true,
  status: 'committed',
};
