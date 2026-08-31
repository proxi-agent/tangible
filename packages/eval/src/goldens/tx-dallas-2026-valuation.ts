import type { ValuationGolden } from '../valuation-goldens.js';

/**
 * Dallas County, tax year 2026: known asset in, known assessed value out.
 *
 * Same guarantee and same limit as the Harris suite — every case is
 * `published-schedule`, computed from the tables in `packages/valuation`, so
 * what it pins is that those tables have not moved since a person read them.
 * A cell transcribed wrong out of DCAD's worksheet is wrong here too and this
 * file is green. Only `assessment-notice` cases close that, and Dallas has
 * none.
 *
 * What is different about Dallas is worth stating, because three of the cases
 * below would look like bugs anywhere else in this suite:
 *
 *   - `indexFactor` is 1 in every case, including on categories that are
 *     indexed in Harris County. DCAD publishes one consolidated figure — RCLND,
 *     replacement cost less depreciation, as a percentage of original cost —
 *     and `appraise` refuses to trend a schedule that is already trended.
 *   - `percentGood` exceeds 100 in the twenty-five-year case, and the market
 *     value comes out above original cost. Six years of construction inflation
 *     against six years of depreciation on a long life is a net gain, and the
 *     worksheet prints 107%.
 *   - `percentGood` for 2021 is *higher* than for 2022 on the ten-year column.
 *     The 2021 and 2020 acquisition years sit at the top of the post-2020 cost
 *     run-up. That case is here precisely so a future "fix" to restore
 *     monotonicity fails loudly.
 *
 * The remaining cases were chosen to pin the four places Dallas and Harris
 * disagree about which column a shared category points at — furniture, office
 * equipment, telecommunications and vehicles — since those are the differences
 * that would otherwise be silently lost if someone aliased Dallas to Harris.
 *
 * To regenerate after loading a new guide: run each `input` through `appraise`
 * against the new schedule, diff this file, and have the diff approved.
 */
export const TX_DALLAS_2026_VALUATION_GOLDENS: readonly ValuationGolden[] = [
  {
    id: 'tx-dallas-2026-furniture-2019',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Office furniture bought 2019, ten-year class',
    input: { originalCost: 42_000, acquisitionYear: 2019, categoryKey: 'furniture-fixtures' },
    expected: { indexFactor: 1, percentGood: 66, marketValue: 27_720, atFloor: false },
    citation:
      'DCAD 2026 worksheet, 10 Years column, 2019 → 66% RCLND; "furniture & fixtures" is printed under that column. Harris County would put the same desk on an eight-year life at 1.369 × 26% = 35.6% of cost, against 66% here.',
  },
  {
    id: 'tx-dallas-2026-furniture-2021',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Office furniture bought 2021, worth more than the same desk bought 2022',
    input: { originalCost: 42_000, acquisitionYear: 2021, categoryKey: 'furniture-fixtures' },
    expected: { indexFactor: 1, percentGood: 75, marketValue: 31_500, atFloor: false },
    citation:
      'DCAD 2026 worksheet, 10 Years column: 2022 → 71%, 2021 → 75%. RCLND rises with age while the cost index outruns depreciation, so this is the district’s published figure and not a swapped pair of cells.',
  },
  {
    id: 'tx-dallas-2026-office-2023',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2023, five-year class',
    input: { originalCost: 18_500, acquisitionYear: 2023, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1, percentGood: 54, marketValue: 9_990, atFloor: false },
    citation:
      'DCAD 2026 worksheet, 5 Years column, 2023 → 54%; "copier and fax" is printed under that column. Harris County runs office equipment on six years.',
  },
  {
    id: 'tx-dallas-2026-office-2016',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2016, older than the five-year column runs',
    input: { originalCost: 18_500, acquisitionYear: 2016, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1, percentGood: 13, marketValue: 2_405, atFloor: true },
    citation:
      'The worksheet’s own footnote: "For example on 5 year life assets, any assets purchased prior to 2018, total the assets’ cost and apply 13% RCLND." This case is the cross-check that the transcription found the right floor.',
  },
  {
    id: 'tx-dallas-2026-machinery-2020',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Machine shop equipment bought 2020, with an SIC on file that changes nothing',
    input: {
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
      businessSic: '3599',
    },
    expected: { indexFactor: 1, percentGood: 73, marketValue: 182_500, atFloor: false },
    citation:
      'DCAD 2026 worksheet, 10 Years column, 2020 → 73%. The SIC is ignored because DCAD publishes no business-line table; the same asset in Harris County reads SIC 3599 to a fifteen-year life. This case pins that the SIC lever does not exist in Dallas.',
  },
  {
    id: 'tx-dallas-2026-machinery-2020-25yr',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'The same machine put on a twenty-five-year life, worth more than it cost',
    input: {
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
      lifeClassOverride: 25,
    },
    expected: { indexFactor: 1, percentGood: 107, marketValue: 267_500, atFloor: false },
    citation:
      'DCAD 2026 worksheet, 25 Years column, 2020 → 107%. RCLND is not bounded by 100: the consolidated cost index has outrun depreciation on a twenty-five-year life. A range check that caps this column at 100 is checking a property of percent good that Dallas does not have.',
  },
  {
    id: 'tx-dallas-2026-pc-2024',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Desktop computers bought 2024',
    input: { originalCost: 9_000, acquisitionYear: 2024, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1, percentGood: 56, marketValue: 5_040, atFloor: false },
    citation:
      'DCAD 2026 worksheet, "Computers % Good" column, 2024 → 56%. Unlike the life columns this one is untrended percent good: it falls with age and never exceeds 100.',
  },
  {
    id: 'tx-dallas-2026-mainframe-2024',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Point-of-sale hardware bought 2024, on the one computer column DCAD publishes',
    input: { originalCost: 9_000, acquisitionYear: 2024, categoryKey: 'computer-mainframe' },
    expected: { indexFactor: 1, percentGood: 56, marketValue: 5_040, atFloor: false },
    citation:
      'DCAD publishes no mainframe or point-of-sale schedule, so this routes to the Computers column and is valued as a PC. Harris County reads the same hardware at 70%, which is the difference this case exists to record.',
  },
  {
    id: 'tx-dallas-2026-pc-2015',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Computers bought 2015, long past the computer floor',
    input: { originalCost: 9_000, acquisitionYear: 2015, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1, percentGood: 5, marketValue: 450, atFloor: true },
    citation:
      'The Computers column ends at 2019 → 5%. Anything older sits at the floor, per the worksheet’s "apply the lowest percentage shown" footnote.',
  },
  {
    id: 'tx-dallas-2026-telecom-2022',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Phone system bought 2022, five years rather than Harris County’s eight',
    input: { originalCost: 30_000, acquisitionYear: 2022, categoryKey: 'telecom-8' },
    expected: { indexFactor: 1, percentGood: 44, marketValue: 13_200, atFloor: false },
    citation:
      'DCAD prints "phone systems" and "mobile phones" under 5 Years and publishes no named telecommunications schedule. Harris County’s telecom8 table reads the same equipment at 54%.',
  },
  {
    id: 'tx-dallas-2026-vehicle-2023',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Pickup bought 2023, the ordinary licensed vehicle',
    input: { originalCost: 55_000, acquisitionYear: 2023, categoryKey: 'vehicles' },
    expected: { indexFactor: 1, percentGood: 54, marketValue: 29_700, atFloor: false },
    citation:
      'DCAD prints "cars l pickups" under 5 Years. A truck of one ton or greater is printed under 8 Years and needs an override — the category carries one default and the worksheet carries two answers.',
  },
  {
    id: 'tx-dallas-2026-inventory-2024',
    jurisdictionId: 'tx-dallas',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Inventory, carried at cost and depreciated not at all',
    input: { originalCost: 400_000, acquisitionYear: 2024, categoryKey: 'inventory' },
    expected: {
      indexFactor: 1,
      percentGood: 100,
      marketValue: 400_000,
      atFloor: false,
      exempt: false,
    },
    citation:
      'Texas taxes inventory and it goes on Schedule C at cost. Asserted `exempt: false` deliberately: this is the case that distinguishes Texas from Florida, where s. 196.185 takes the same property off the roll entirely.',
  },
];
