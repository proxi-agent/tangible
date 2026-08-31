import type { CategoryRule, DepreciationSchedule } from '../types.js';

/**
 * Tarrant County, 2026.
 *
 * The fifth jurisdiction, and the third shape. Harris publishes a cost index
 * and a percent good separately; Dallas and Collin publish their product. TAD
 * publishes percent good alone and no index at all — its sheet says to
 * "multiply an asset's Historical Cost by the Percent Good that corresponds to
 * its Year Acquired and Typical Life Expectancy", one multiplication and no
 * trending. So the figures here are ordinary percent good: none exceeds 100,
 * every column falls monotonically, and `costIndexIncluded` is deliberately not
 * set, because it would be a false statement about a table that never had an
 * index folded into it. What makes the arithmetic come out right is that all
 * twelve categories below are `indexed: false`, and `indexFactors` is empty so
 * that a category which slipped through as indexed would gap loudly rather than
 * silently value against nothing.
 *
 * The transcription decision worth knowing about is the row key. TAD's table is
 * printed by *effective age* — 1, 2, 3 … 29, "& OLDER" — and its Year Acquired
 * column is blank on the published form. This schedule is for the 2026 tax
 * year, so age has been resolved to acquisition year as 2026 minus age: age 1
 * is 2025, and the last printed row is 1996. That is the same table, read for
 * one year. It is also why this file cannot be reused for 2027 by changing
 * `taxYear`: next year's form republishes the same age curve one year over, and
 * a 2027 schedule has to be transcribed again rather than inherited.
 *
 * TAD's asset classification legend is the most specific of the three Texas
 * districts here — it names Tanning Beds-Booths and Bank Vault Doors — and the
 * category rules below are read off it. Three things it publishes are not
 * carried:
 *
 *   - A SPECIAL column for semiconductor manufacturing equipment, which falls
 *     from 60% to 6% over eight years. No category key resolves to it, and a
 *     jurisdiction may only re-answer a key, never invent one. A semiconductor
 *     fab's tools are therefore valued here on the ten-year machinery line,
 *     which is far above TAD's own answer for them. That overstates our value
 *     and understates the client's claim, which is the safe direction, but it
 *     is a real gap and a fab in Tarrant County needs a person before it needs
 *     this schedule.
 *   - A forty-year life for aircraft, which TAD names but does not print,
 *     directing the taxpayer to call the district. Commercial aircraft it
 *     values from AVITAS and the Airliner Pricing Guide, business aircraft from
 *     the Aircraft Bluebook Price Digest — neither of which is a cost schedule
 *     at all.
 *   - A twelve-year column with no legend entry against it. It is transcribed
 *     because it is published; nothing routes to it by default.
 *
 * Transcription checks, since nobody has read the cells back yet:
 *
 *   1. Cells were read by column x-anchor and separated from the legend by font
 *      size, because TAD prints SIC-code fragments inside the numeric columns
 *      and a text read attributes them to the grid. 145 cells parsed, which is
 *      exactly the sum of the eleven columns' printed depths.
 *   2. Every column's ages are contiguous from 1, and every column is
 *      monotonically non-increasing — the property that fails on Dallas and
 *      Collin and must hold here.
 *   3. The district's own worked footnote checks the floor rule: "an 8 year
 *      assets acquired in 1993 would use 15 percent good". Fifteen is what the
 *      eight-year column bottoms out at, and it is what `lookupPercentGood`
 *      returns for any year older than the table.
 */
const TARRANT_CATEGORIES: Readonly<Record<string, CategoryRule>> = {
  inventory: {
    key: 'inventory',
    label: 'Inventory and supplies',
    schedule: 'none',
    indexed: false,
    description:
      'Finished goods, supplies, raw materials, and work in process, carried at cost. TAD says so on the schedule itself: it "does not apply to \'Inventory\' items such as Raw Materials, Goods In Process, Finished Goods, Merchandise, or Supplies".',
  },
  'furniture-fixtures': {
    key: 'furniture-fixtures',
    label: 'Furniture and fixtures',
    schedule: 10,
    indexed: false,
    description:
      'Desks, seating, shelving, casework, and fixtures, on TAD’s ten-year line. One of the seven starred categories the district prints on its own rendition forms 1300A and 1300B, so this is the district’s own default and not an inference.',
  },
  'office-equipment': {
    key: 'office-equipment',
    label: 'General office equipment',
    schedule: 6,
    indexed: false,
    description:
      'TAD’s starred "Office Equip (phones, copiers, faxes)" line, at six years — the same life Harris County gives it, and one the two consolidated districts do not.',
  },
  'machinery-equipment': {
    key: 'machinery-equipment',
    label: 'Machinery and equipment',
    schedule: 10,
    indexed: false,
    description:
      'Production and shop machinery, on TAD’s starred ten-year line. The district publishes exactly one life that depends on the business rather than the asset — fast food restaurant machinery at seven years, listed by SIC — which is too narrow to drive a lookup, so the life here does not move with the SIC.',
  },
  'computer-pc': {
    key: 'computer-pc',
    label: 'Computer equipment (PC)',
    schedule: 4,
    indexed: false,
    description:
      'TAD’s starred "Computers & Related" line at four years: PCs, mainframes, servers, printers, scanners, and other peripheral equipment. The district writes the exclusion out — "NOT CNC or POS".',
  },
  'computer-mainframe': {
    key: 'computer-mainframe',
    label: 'Mainframe and point of sale',
    schedule: 5,
    indexed: false,
    description:
      'TAD splits this category where Harris County joins it: point-of-sale equipment is five years, and mainframes sit with the rest of the computers at four. Five is used because it is the higher percent good of the two, and a register that is really mainframes belongs on the four-year line — a change that lowers the value, so it is a reviewer’s call.',
  },
  'specific-equipment': {
    key: 'specific-equipment',
    label: 'Specific equipment',
    schedule: 6,
    indexed: false,
    description:
      'Telephone systems, fax machines and similar. TAD publishes no column of this name; the assets it covers are the ones the district prints in its six-year office equipment line as "phones, copiers, faxes".',
  },
  'telecom-8': {
    key: 'telecom-8',
    label: 'Telecommunications equipment',
    schedule: 4,
    indexed: false,
    description:
      'TAD gives telecommunications no life of its own and names servers explicitly in the four-year computers line, so that is where this lands. Cell site towers and shelters are the district’s twenty-year line and a carrier’s network plant belongs there instead.',
  },
  'leasehold-improvements': {
    key: 'leasehold-improvements',
    label: 'Leasehold improvements',
    schedule: 10,
    indexed: false,
    description:
      'TAD’s starred "Leaseholds" line at ten years, against Harris County’s six. Tax Code 23.24 still bars taxing an improvement the landlord’s real-property appraisal already includes.',
  },
  solar: {
    key: 'solar',
    label: 'Solar energy device',
    schedule: 10,
    indexed: false,
    description:
      'On-site solar generation. TAD publishes no line for it; ten years is both the shared default and the district’s general machinery life. The Tax Code 11.27 exemption is a separate application.',
  },
  vehicles: {
    key: 'vehicles',
    label: 'Licensed vehicles',
    schedule: 6,
    indexed: false,
    description:
      'TAD’s starred "Autos, Trucks, & Trailers" line at six years. A rental or leasing fleet is the district’s five-year line instead, and TAD lists the SIC codes that qualify: 7513, 7513X, 7514, 7515, 7515X, 7519 and 8999V.',
  },
  vessels: {
    key: 'vessels',
    label: 'Vessels',
    schedule: 20,
    indexed: false,
    description:
      'Marine vessels. TAD publishes no line for them; twenty years is the shared default and the district’s longest printed class.',
  },
};

export const TX_TARRANT_2026: DepreciationSchedule = {
  provenance: {
    ruleId: 'valuation:tx-tarrant:2026',
    title: 'Tarrant AD 2026 business personal property percent good schedule',
    citation:
      'Tarrant Appraisal District, Business Personal Property Percent Good Schedule — "Typical Life Expectancy In Years and TAD Asset Classification" — page 4 of the district’s January 1, 2026 rendition packet (form RNDIS7.FRM).',
    source: {
      title: 'TAD Business Personal Property Rendition of Taxable Property (Form 50-144 packet)',
      url: 'https://www.tad.org/content/forms/BPPRendition(50-144).pdf',
      pages: 'page 4',
    },
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    jurisdictions: ['tx-tarrant'],
    taxYears: [2026],
    authoredBy: 'transcribed by column coordinate from the published schedule',
    authoredAt: '2026-08-28',
    // Nobody has checked these tables cell by cell against the packet.
    approvedBy: null,
    approvedAt: null,
    notes:
      'Percent good with no cost index published, so nothing here is trended. Printed by effective age rather than year acquired; ages were resolved as 2026 minus age, which ties this transcription to the 2026 tax year. TAD’s semiconductor manufacturing column is published and not carried, because no category key reaches it.',
  },
  jurisdictionId: 'tx-tarrant',
  jurisdictionName: 'Tarrant County, TX',
  taxYear: 2026,
  source: {
    title: 'TAD Business Personal Property Percent Good Schedule',
    url: 'https://www.tad.org/content/forms/BPPRendition(50-144).pdf',
    pages: 'page 4',
  },
  /**
   * Empty, and here that is a statement about the district rather than about
   * the transcription: TAD publishes no cost index. Every category below is
   * `indexed: false`, so `appraise` never reaches this table. If one ever
   * slipped through as indexed it would gap rather than value, which is the
   * behaviour we want from an empty index.
   */
  indexFactors: {},
  percentGood: {
    3: {
      2025: 67,
      2024: 46,
      2023: 32,
      2022: 14,
      2021: 7,
    },
    4: {
      2025: 75,
      2024: 58,
      2023: 45,
      2022: 35,
      2021: 20,
      2020: 12,
    },
    5: {
      2025: 80,
      2024: 66,
      2023: 54,
      2022: 45,
      2021: 37,
      2020: 24,
      2019: 15,
      2018: 11,
    },
    6: {
      2025: 83,
      2024: 72,
      2023: 62,
      2022: 53,
      2021: 45,
      2020: 38,
      2019: 27,
      2018: 19,
      2017: 14,
    },
    7: {
      2025: 86,
      2024: 76,
      2023: 67,
      2022: 59,
      2021: 52,
      2020: 46,
      2019: 40,
      2018: 35,
      2017: 26,
      2016: 20,
      2015: 15,
    },
    8: {
      2025: 88,
      2024: 80,
      2023: 71,
      2022: 65,
      2021: 57,
      2020: 52,
      2019: 45,
      2018: 41,
      2017: 32,
      2016: 25,
      2015: 19,
      2014: 15,
    },
    10: {
      2025: 90,
      2024: 84,
      2023: 78,
      2022: 72,
      2021: 66,
      2020: 61,
      2019: 56,
      2018: 52,
      2017: 49,
      2016: 45,
      2015: 35,
      2014: 29,
      2013: 25,
      2012: 20,
      2011: 16,
    },
    12: {
      2025: 92,
      2024: 87,
      2023: 82,
      2022: 78,
      2021: 73,
      2020: 68,
      2019: 63,
      2018: 60,
      2017: 57,
      2016: 53,
      2015: 48,
      2014: 45,
      2013: 39,
      2012: 33,
      2011: 28,
      2010: 25,
      2009: 21,
      2008: 17,
    },
    15: {
      2025: 93,
      2024: 89,
      2023: 85,
      2022: 82,
      2021: 79,
      2020: 74,
      2019: 72,
      2018: 70,
      2017: 66,
      2016: 61,
      2015: 58,
      2014: 55,
      2013: 51,
      2012: 49,
      2011: 48,
      2010: 41,
      2009: 37,
      2008: 32,
      2007: 30,
      2006: 28,
      2005: 27,
      2004: 24,
      2003: 21,
    },
    20: {
      2025: 95,
      2024: 94,
      2023: 92,
      2022: 89,
      2021: 87,
      2020: 86,
      2019: 81,
      2018: 80,
      2017: 79,
      2016: 76,
      2015: 72,
      2014: 69,
      2013: 66,
      2012: 64,
      2011: 62,
      2010: 61,
      2009: 58,
      2008: 56,
      2007: 56,
      2006: 56,
      2005: 52,
      2004: 50,
      2003: 47,
      2002: 44,
      2001: 39,
      2000: 35,
      1999: 32,
      1998: 30,
      1997: 27,
      1996: 25,
    },
  },
  /**
   * Empty. TAD's percent good is keyed by life in years for every category it
   * publishes, including computers, so there is no equipment-type table to
   * fill. Its one non-life column, semiconductor manufacturing equipment, has
   * no category key that could reach it and is not carried; see the note at the
   * top of this file.
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
   * Empty. TAD names SIC codes exactly twice — fast food restaurant machinery
   * at seven years, and rental-leasing vehicle inventory at five — which is a
   * pair of exceptions rather than the per-line-of-business life table Harris
   * County publishes. Both are named in the category descriptions above so a
   * reviewer can apply them; neither is enough to drive a lookup.
   */
  sicProfiles: {},
  categories: TARRANT_CATEGORIES,
  status: 'committed',
};
