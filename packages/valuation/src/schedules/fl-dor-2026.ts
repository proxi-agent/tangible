import type { CategoryRule, DepreciationSchedule } from '../types.js';

/**
 * Florida, tax year 2026 — the second state, and the first jurisdiction wired
 * up before its depreciation tables were transcribed.
 *
 * Everything about valuing property in Florida that can be established from a
 * statute or a form is below and is citable. What is not below is the
 * arithmetic: the Department of Revenue's index factors, percent-good columns
 * and life expectancies live in three attachments to a PDF, they are several
 * hundred cells, and there is no honest way to produce them except to read them
 * off the page. So this schedule is `awaiting-transcription`, its tables are
 * empty on purpose, and `appraise` returns a named gap for every Florida asset
 * rather than a number.
 *
 * That is the safe direction and it is worth saying why. A missing index factor
 * defaulted to 1.000 would understate the district's own market value, which
 * would overstate what the client is overpaying, which is the one direction an
 * error in this product must never go. A gap on a report is a question. A
 * confident wrong number is a bill somebody disputes.
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
 *      so out loud.
 *
 * The percent-good arithmetic itself is expected to port. Both Harris County
 * and the Department's Attachment C descend from Marshall Valuation Service
 * Section 97, and the two agree where they have been checked against each other
 * — an eight-year asset at age three is 67% under both, a ten-year asset at age
 * three is 76% under both. Where they diverge is the four-year column, which
 * Florida publishes as 83 / 65 / 43 / 24 against Harris's 75 / 42 / 26 / 13.
 * Those four cells are the transcription's first checkpoint: a reading of
 * Attachment C that does not reproduce them was read wrong.
 */

/**
 * What Florida changes about a shared category key.
 *
 * Only the answers that come from a statute or from the face of the DR-405 are
 * here. Every other key falls through to the Harris table, which is *not* a
 * claim that Florida agrees with it — it is the same placeholder the empty
 * depreciation tables are, and it is unreachable while the schedule is awaiting
 * transcription because nothing values at all. Attachment D is what settles the
 * rest, and it is named in `awaiting.missing` below.
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
      'Tenant build-out. The DR-405 asks for it by name on line 20, so unlike Texas there is no double-taxation argument to make from the landlord’s real-property assessment — the return is built to collect it.',
  },
  'furniture-fixtures': {
    key: 'furniture-fixtures',
    label: 'Furniture and fixtures',
    schedule: 10,
    indexed: true,
    description:
      'Desks, seating, shelving, casework, and fixtures. Ten years under the Department’s life expectancy table, against eight in Harris County — the same desk is a different number on each side of the state line.',
  },
  'office-equipment': {
    key: 'office-equipment',
    label: 'General office equipment',
    schedule: 10,
    indexed: true,
    description:
      'Copiers and general office machines. Ten years, against six in Harris County.',
  },
};

export const FL_DOR_2026: DepreciationSchedule = {
  provenance: {
    ruleId: 'valuation:fl:2026',
    title: 'Florida DOR tangible personal property valuation, tax year 2026',
    citation:
      'Florida Department of Revenue, Tangible Personal Property Appraisal Guidelines, Attachments B (index factors), C (untrended depreciation) and D (life expectancies). Issued under s. 195.062, F.S.; prima facie correct under s. 195.032, F.S., and not conclusive as to just value.',
    source: {
      title: 'Florida DOR Tangible Personal Property Appraisal Guidelines',
      url: 'https://floridarevenue.com/property/Pages/Cofficial.aspx',
      pages: 'Attachments B, C, D',
    },
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    jurisdictions: ['fl-*'],
    taxYears: [2026],
    authoredBy: 'kajmeri',
    authoredAt: '2026-08-27',
    approvedBy: null,
    approvedAt: null,
    notes:
      'The statutory rules below are cited and checked. The depreciation tables are not transcribed and this schedule values nothing until they are — see `awaiting`.',
  },
  jurisdictionId: 'fl',
  jurisdictionName: 'Florida (Department of Revenue guidelines)',
  taxYear: 2026,
  source: {
    title: 'Florida DOR Tangible Personal Property Appraisal Guidelines',
    url: 'https://floridarevenue.com/property/Pages/Cofficial.aspx',
    pages: 'Attachments B, C, D',
  },
  /**
   * Empty, deliberately. Florida trends every class — including computers,
   * which Harris County does not — so an absent index factor is not a class
   * that happens to be untrended, it is a factor nobody has read. `appraise`
   * gaps on it.
   */
  indexFactors: {},
  percentGood: { 3: {}, 4: {}, 5: {}, 6: {}, 8: {}, 10: {}, 12: {}, 15: {}, 20: {}, 25: {}, 30: {} },
  /**
   * Florida runs one age/life form rather than the named equipment schedules
   * Harris publishes, so these stay empty even after Attachment C lands. A
   * Florida computer is a life in years, not a "pc" table.
   */
  specialPercentGood: {
    pc: {},
    spc: {},
    mf: {},
    telecom4: {},
    telecom6: {},
    telecom8: {},
    solar10: {},
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
  status: 'awaiting-transcription',
  awaiting: {
    document: 'Florida DOR Tangible Personal Property Appraisal Guidelines, Attachments B, C and D',
    url: 'https://floridarevenue.com/property/Pages/Cofficial.aspx',
    missing: [
      'Attachment B — index factors by year acquired. Every Florida class is trended, so nothing values without these.',
      'Attachment C — percent good by life and age. Check the reading against the four-year column: 83 / 65 / 43 / 24.',
      'Attachment D — life expectancy by category. Until it is read, every category other than furniture, office equipment and leasehold improvements falls back to the Harris life, which is a placeholder and not a claim about Florida.',
      'County millage. Florida rates run roughly 16 to 23 mills against Harris County’s 2.2 to 2.5 percent, and the blended rate is per county rather than per state.',
    ],
  },
};
