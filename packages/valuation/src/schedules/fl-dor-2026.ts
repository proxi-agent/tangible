import type { CategoryRule, DepreciationSchedule } from '../types.js';

/**
 * Florida, tax year 2026 — the second state, valued against the Department's
 * own published tables.
 *
 * Everything here is transcribed from the Florida Tangible Personal Property
 * Appraisal Guidelines: Attachment B (Equipment Index Factors, revised
 * 1/15/2026), Attachment C (Untrended Depreciation Schedule) and Attachment D
 * (Life Expectancy Guidelines). The guidelines were adopted in 1997 and
 * Attachment B is reissued annually; the 2026 table below is the current one.
 *
 * **How the reading was checked.** A depreciation table is several hundred
 * cells read off a PDF, and a table read wrong values every asset in the state
 * wrong, so the transcription was pinned against five things that were known
 * before it started:
 *
 *   1. The four-year column reads 83 / 65 / 43 / 24, which is the checkpoint
 *      this file carried while it was awaiting transcription.
 *   2. An eight-year asset at age three is 67%, matching Harris County.
 *   3. A ten-year asset at age three is 76%, matching Harris County.
 *   4. The five- and six-year columns are identical to Harris County's cell for
 *      cell — 85 / 69 / 52 / 34 / 23 / 18 and 87 / 73 / 57 / 41 / 30 / 23 / 19.
 *      Both descend from Marshall Valuation Service Section 97, so agreement is
 *      the expected result and disagreement would have meant a misread column.
 *   5. The Department's own worked example in section VIII.G values a ten-year
 *      asset at age seven at 39%, and the table below returns 39%.
 *
 * Where Florida and Harris genuinely part company is the four-year column:
 * 83 / 65 / 43 / 24 / 18 here against Harris's 75 / 56 / 42 / 27 / 13. A
 * four-year asset is worth materially more to a Florida appraiser than to a
 * Texas one, and since Attachment D puts personal computers on a four-year life
 * that column decides every PC in the state.
 *
 * **Florida is not Texas, and five things change.**
 *
 *   1. *Inventory is exempt.* s. 196.185, F.S. takes inventory off the roll
 *      entirely. In Texas it is rendered at full cost on Schedule C. A Florida
 *      client who reported inventory on a DR-405 is overpaying the whole of the
 *      tax on it, not being valued generously — which is why the category rule
 *      below says `exempt` rather than `none`.
 *   2. *Licensed vehicles are outside tangible personal property.* s.
 *      192.001(11)(d), F.S. excludes them from the definition; they are reached
 *      by the motor vehicle licence tax instead. Texas renders them on Schedule
 *      D of Form 50-144.
 *   3. *Leasehold improvements are affirmatively taxable.* Line 20 of the
 *      DR-405 asks for them by name. Texas Tax Code 23.24 runs the other way —
 *      it bars appraising as personal property an improvement the real-property
 *      appraisal already includes — and the Texas leasehold double-tax finding
 *      does not survive the state line.
 *   4. *The exemption is $25,000, not $125,000*, and it is granted per return,
 *      per location, per county under s. 196.183, F.S. See `exemptionFor`.
 *   5. *The guidelines are not rules.* s. 195.062, F.S. says the Department's
 *      guidelines "shall not have the force and effect of rules", and s.
 *      195.032 makes them prima facie correct while providing they "shall not
 *      be deemed to establish the just value of any property". A Texas county's
 *      published guide is the district's own method and arguing against it is
 *      arguing against the assessor. A Florida county's application of the DOR
 *      guidelines is neither binding on the property appraiser nor conclusive
 *      against the taxpayer, and any position taken off these tables should say
 *      so out loud. Attachment C says as much itself: a county that prefers
 *      another comparable table may use it, county-wide.
 *
 * **Three places these tables are read more coarsely than they are printed.**
 * Each is named because each moves money, and each is resolved in the direction
 * that raises the district's value rather than the client's refund — an
 * overstated recovery is the one error this product must never make.
 *
 *   1. *One index row, where the Department prints fifty-one.* Attachment B
 *      gives a factor per industry, and `indexFactors` below carries only the
 *      "Average of all" row. That is not a shortcut around the table: section
 *      VIII.G states in terms that "the average of all industry index factors
 *      may be used". It is still a real spread — at the oldest vintage the rows
 *      run from 1.35 (Communication) to 2.95 (Mining and milling) against an
 *      average of 2.62 — so a client in a heavy-industry line is trended low
 *      here, and a position worth real money should be re-run against that
 *      client's own row before it is taken to an appraiser.
 *   2. *Trending past the end of economic life.* Attachment C's note 1 says
 *      trending is typically applied only over the item's economic life. This
 *      schedule keeps applying the acquisition year's factor, because the
 *      clamping rule lives in `appraise` and is shared with Texas. The effect
 *      is bounded — percent good has floored at 18–21% by then — and it runs
 *      toward a higher district value.
 *   3. *The two-year step past age twenty.* The Department stops printing every
 *      year at that point and prints ages 22, 24, 26, 28, 30 and 32. A step
 *      table holds its last printed value until the next step, so age 21 is
 *      read as age 20 rather than as age 22. Reading it the other way would
 *      depreciate the asset further than the Department published.
 *
 * One thing Attachment C does *not* say is that computers escape trending. Note
 * 2 to section VIII.G says only that trending "may not be appropriate when
 * assets' costs are decreasing due to emerging technologies" — permissive, and
 * addressed to the appraiser. So every Florida category below is indexed,
 * including the computer classes that Harris County depreciates straight off
 * cost. That is the conservative reading, and note 2 is left in the computer
 * categories' descriptions because it is a live argument a taxpayer can make.
 */

/**
 * What Florida changes about a shared category key.
 *
 * Every key whose Harris rule points at one of the named equipment schedules
 * — `pc`, `mf`, `spc`, `telecom8` — has to be re-answered here, because those
 * are a Harris County device and `specialPercentGood` is empty for Florida on
 * purpose. The Department assigns a life in years to the equipment itself, so
 * a Florida personal computer is a four-year age/life rather than a "pc" table.
 *
 * Two keys are deliberately left to fall through to the shared table, because
 * Attachment D agrees with it and an override would only be noise: `vessels`
 * against "Water transportation ... 20", and `solar`, which Attachment D does
 * not list at all and which the DR-405 collects on line 24 as a renewable
 * energy source device.
 */
const FL_CATEGORIES: Readonly<Record<string, CategoryRule>> = {
  inventory: {
    key: 'inventory',
    label: 'Inventory',
    schedule: 'exempt',
    indexed: false,
    exemptAuthority: 's. 196.185, F.S. — inventory is exempt from ad valorem taxation',
    description:
      'Finished goods, raw materials, work in process, and goods held for sale or lease. Exempt, and it does not belong on the DR-405 at all. Supplies consumed in the business are not inventory and remain taxable.',
  },
  vehicles: {
    key: 'vehicles',
    label: 'Licensed vehicles',
    schedule: 'exempt',
    indexed: false,
    exemptAuthority:
      's. 192.001(11)(d), F.S. — licensed motor vehicles are excluded from tangible personal property',
    description:
      'Vehicles carrying a Florida licence plate. Reached by the motor vehicle licence tax rather than the ad valorem roll, so they are not rendered. Unlicensed and off-road equipment stays taxable.',
  },
  'leasehold-improvements': {
    key: 'leasehold-improvements',
    label: 'Leasehold improvements',
    schedule: 10,
    indexed: true,
    description:
      'Tenant build-out. The DR-405 asks for it by name on line 20, so unlike Texas there is no double-taxation argument to make from the landlord’s real-property assessment — the return is built to collect it. Ten years is this firm’s reading and not the Department’s: Attachment D has no leasehold line, and line 20 asks for the improvements grouped by type and year of installation, which is the Department expecting them to be lifed one type at a time.',
  },
  'furniture-fixtures': {
    key: 'furniture-fixtures',
    label: 'Furniture and fixtures',
    schedule: 10,
    indexed: true,
    description:
      'Desks, seating, shelving, casework, and fixtures. Ten years under Attachment D ("Office furniture and equipment"), against eight in Harris County — the same desk is a different number on each side of the state line.',
  },
  'office-equipment': {
    key: 'office-equipment',
    label: 'General office equipment',
    schedule: 10,
    indexed: true,
    description:
      'Copiers and general office machines. Ten years under Attachment D ("Office furniture and equipment"), against six in Harris County.',
  },
  'machinery-equipment': {
    key: 'machinery-equipment',
    label: 'Machinery and equipment',
    schedule: 10,
    indexed: true,
    description:
      'Production and shop machinery. Ten years, from Attachment D’s "Machinery manufacturing, except as otherwise listed". The life is not SIC-driven the way Harris County’s is: the Department lifes equipment by industry group in Attachment D rather than reading a life off the taxpayer’s SIC code, and several of those groups — food and beverage production at 12, printing and publishing at 11, retail fixtures at 9 — differ from this default enough to be worth checking by hand.',
  },
  'computer-pc': {
    key: 'computer-pc',
    label: 'Computer equipment (PC)',
    schedule: 4,
    indexed: true,
    description:
      'Desktops, laptops, monitors and peripherals. Four years under Attachment D, on the age/life table rather than a computer schedule of its own — and trended, which Harris County does not do. Note 2 to section VIII.G is the argument against trending, since it allows that trending "may not be appropriate when assets’ costs are decreasing due to emerging technologies"; it is permissive and addressed to the appraiser, so it is a position to take rather than a rule to rely on.',
  },
  'computer-mainframe': {
    key: 'computer-mainframe',
    label: 'Mainframe and point of sale',
    schedule: 6,
    indexed: true,
    description:
      'Mainframes, high-speed production printers, and point-of-sale registers. Six years under Attachment D ("mainframe", and "Peripherals"). The same note 2 argument against trending applies.',
  },
  'specific-equipment': {
    key: 'specific-equipment',
    label: 'Specific equipment',
    schedule: 6,
    indexed: true,
    description:
      'Telephone systems (PBX), mobile radio equipment, mobile handsets, and fax machines. Six years, from Attachment D’s "Data handling equipment, except computers" and "smart phones". Attachment D lifes a plain cellular phone at 5, so a register of older handsets is worth separating out.',
  },
  'telecom-8': {
    key: 'telecom-8',
    label: 'Telecommunications equipment',
    schedule: 8,
    indexed: true,
    description:
      'Telecommunications equipment, including servers. Eight years under Attachment D, which puts analog and digital switching, digital circuit and "all other equipment" at 8. Cable and outside plant run far longer — metallic cable 12, fibre, poles and conduit 20 — so a carrier’s register does not belong on this one line.',
  },
};

export const FL_DOR_2026: DepreciationSchedule = {
  provenance: {
    ruleId: 'valuation:fl:2026',
    title: 'Florida DOR tangible personal property valuation, tax year 2026',
    citation:
      'Florida Department of Revenue, Tangible Personal Property Appraisal Guidelines, Attachments B (equipment index factors, rev. 1/15/2026), C (untrended depreciation) and D (life expectancies). Issued under s. 195.062, F.S.; prima facie correct under s. 195.032, F.S., and not conclusive as to just value.',
    source: {
      title: 'Florida DOR Tangible Personal Property Appraisal Guidelines',
      url: 'https://floridarevenue.com/property/Documents/TPPGuidelines.pdf',
      pages: 'Attachments B, C, D',
    },
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    jurisdictions: ['fl-*'],
    taxYears: [2026],
    authoredBy: 'kajmeri',
    authoredAt: '2026-08-28',
    approvedBy: null,
    approvedAt: null,
    notes:
      'Tables transcribed from the published attachments and pinned against five independent checkpoints, including the Department’s own worked example (ten-year life, age seven, 39%). Carries the "Average of all" index row, which section VIII.G expressly permits; a client in a heavy-industry line should be re-run against that industry’s own row.',
  },
  jurisdictionId: 'fl',
  jurisdictionName: 'Florida (Department of Revenue guidelines)',
  taxYear: 2026,
  source: {
    title: 'Florida DOR Tangible Personal Property Appraisal Guidelines',
    url: 'https://floridarevenue.com/property/Documents/TPPGuidelines.pdf',
    pages: 'Attachments B, C, D',
  },
  /**
   * Attachment B, "Average of all" row, revised 1/15/2026 and sourced from
   * Marshall Valuation Service Section 98. Keyed by year acquired: the table is
   * printed with 7/25 as the base at 1.00, so 2025 is age one for tax year 2026.
   */
  indexFactors: {
    2025: 1.0,
    2024: 1.04,
    2023: 1.05,
    2022: 1.06,
    2021: 1.26,
    2020: 1.37,
    2019: 1.38,
    2018: 1.43,
    2017: 1.48,
    2016: 1.52,
    2015: 1.5,
    2014: 1.5,
    2013: 1.53,
    2012: 1.54,
    2011: 1.58,
    2010: 1.64,
    2009: 1.63,
    2008: 1.67,
    2007: 1.73,
    2006: 1.83,
    2005: 1.9,
    2004: 2.05,
    2003: 2.13,
    2002: 2.17,
    2001: 2.19,
    2000: 2.2,
    1999: 2.25,
    1998: 2.25,
    1997: 2.27,
    1996: 2.31,
    1995: 2.32,
    1994: 2.41,
    1993: 2.47,
    1992: 2.53,
    1991: 2.57,
    1990: 2.62,
  },

  /**
   * Attachment C, keyed life class → year acquired → percent good.
   *
   * Life 3 is empty because the Department does not publish a three-year
   * column; Attachment C starts at four. Nothing routes to it — every Florida
   * category above names a life the table actually carries — and an asset that
   * somehow reached it gets a reported gap rather than a number, which is the
   * behaviour an empty table is supposed to produce.
   *
   * Each column stops one or two years past its own life, at a floor of 18-21%.
   * That is the table's own shape rather than a truncation: `appraise` reads a
   * year older than the last published one as fully depreciated in the
   * Department's model and flags it, which is exactly the finding worth having
   * when a client is still carrying the asset at cost.
   */
  percentGood: {
    3: {},
    4: { 2025: 83, 2024: 65, 2023: 43, 2022: 24, 2021: 18 },
    5: { 2025: 85, 2024: 69, 2023: 52, 2022: 34, 2021: 23, 2020: 18 },
    6: { 2025: 87, 2024: 73, 2023: 57, 2022: 41, 2021: 30, 2020: 23, 2019: 19 },
    8: { 2025: 90, 2024: 79, 2023: 67, 2022: 54, 2021: 43, 2020: 33, 2019: 26, 2018: 22, 2017: 20 },
    10: {
      2025: 92,
      2024: 84,
      2023: 76,
      2022: 67,
      2021: 58,
      2020: 49,
      2019: 39,
      2018: 30,
      2017: 24,
      2016: 21,
      2015: 20,
    },
    12: {
      2025: 94,
      2024: 87,
      2023: 80,
      2022: 73,
      2021: 66,
      2020: 58,
      2019: 50,
      2018: 43,
      2017: 36,
      2016: 29,
      2015: 24,
      2014: 22,
      2013: 20,
    },
    15: {
      2025: 95,
      2024: 90,
      2023: 85,
      2022: 79,
      2021: 73,
      2020: 68,
      2019: 62,
      2018: 55,
      2017: 49,
      2016: 43,
      2015: 37,
      2014: 31,
      2013: 26,
      2012: 23,
      2011: 21,
      2010: 20,
    },
    20: {
      2025: 97,
      2024: 93,
      2023: 90,
      2022: 86,
      2021: 82,
      2020: 78,
      2019: 74,
      2018: 70,
      2017: 65,
      2016: 60,
      2015: 55,
      2014: 50,
      2013: 45,
      2012: 40,
      2011: 35,
      2010: 31,
      2009: 27,
      2008: 24,
      2007: 22,
      2006: 21,
      2005: 21,
      2004: 20,
    },
    25: {
      2025: 98,
      2024: 95,
      2023: 93,
      2022: 90,
      2021: 87,
      2020: 84,
      2019: 81,
      2018: 78,
      2017: 75,
      2016: 71,
      2015: 68,
      2014: 64,
      2013: 60,
      2012: 56,
      2011: 52,
      2010: 48,
      2009: 44,
      2008: 39,
      2007: 34,
      2006: 30,
      2005: 30,
      2004: 26,
      2003: 26,
      2002: 23,
      2001: 23,
      2000: 21,
    },
    30: {
      2025: 98,
      2024: 97,
      2023: 95,
      2022: 93,
      2021: 91,
      2020: 89,
      2019: 86,
      2018: 84,
      2017: 82,
      2016: 79,
      2015: 76,
      2014: 74,
      2013: 71,
      2012: 68,
      2011: 65,
      2010: 61,
      2009: 58,
      2008: 54,
      2007: 51,
      2006: 47,
      2005: 47,
      2004: 40,
      2003: 40,
      2002: 34,
      2001: 34,
      2000: 28,
      1999: 28,
      1998: 23,
      1997: 23,
      1996: 21,
      1995: 21,
      1994: 20,
    },
  },
  /**
   * Empty, and correctly so even now the tables are transcribed. Florida runs
   * one age/life form rather than the named equipment schedules Harris
   * publishes, so a Florida computer is a life in years and not a "pc" table.
   * No category above routes here, and `fl-dor-2026.test.ts` pins that.
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
   * Empty, and not a placeholder. The SIC-driven life is a Harris County
   * device: HCAD publishes a life per line of business and reads it off the
   * taxpayer's SIC code. The Department assigns life by what the equipment is,
   * not by what the business does, so machinery falls to its category life and
   * `lifeSource` correctly reports `category` rather than `sic`.
   */
  sicProfiles: {},
  categories: FL_CATEGORIES,
  appliesStatewide: true,
  status: 'committed',
};
