import type { ValuationGolden } from '../valuation-goldens.js';

/**
 * Collin County, tax year 2026: known asset in, known assessed value out.
 *
 * Same guarantee and same limit as every other published-schedule suite — the
 * expectations are computed from the tables in `packages/valuation`, so what
 * they pin is that those tables have not moved since a person read them. A cell
 * transcribed wrong out of CCAD's sheet is wrong here too and this file is
 * green. Only `assessment-notice` cases close that, and Collin has none.
 *
 * Collin publishes a Percent Value Factor rather than a percent good: its own
 * sheet says MARKET VALUE ESTIMATE = HISTORICAL COST x PVF, so the cost index
 * is already inside the printed figure. Three of the cases below exist because
 * of that and would look like bugs anywhere else — a factor above 100, and a
 * factor that is *higher* for an older asset than a newer one. Both are the
 * district's arithmetic, and both are asserted here so that a later reader who
 * assumes percent good must argue with a test rather than quietly "fix" a cell.
 *
 * `indexFactor` is 1 in every case, and that too is load-bearing. Trending an
 * already-trended table would value an asset above its own cost twice over,
 * which overstates the client's claim — the one direction this product must
 * never err — and would be invisible for exactly that reason.
 *
 * The rest were chosen where Collin's answer is unique among the four Texas
 * districts: a nine-year furniture life no one else publishes, its own vehicles
 * column that is close to its five-year line without being it, and a computers
 * column that turns out to be cell-for-cell identical to Harris County's.
 *
 * To regenerate after loading a new sheet: run each `input` through `appraise`
 * against the new schedule, diff this file, and have the diff approved.
 */
export const TX_COLLIN_2026_VALUATION_GOLDENS: readonly ValuationGolden[] = [
  {
    id: 'tx-collin-2026-furniture-2019',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Office furniture bought 2019, nine-year class',
    input: { originalCost: 42_000, acquisitionYear: 2019, categoryKey: 'furniture-fixtures' },
    expected: { indexFactor: 1, percentGood: 45, marketValue: 18_900, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 9 YEARS column, year acquired 2019 → 45%. "OFFICE FURNITURE & FIXTURES" is printed under that column. Collin is the only one of the four Texas districts here that publishes a nine-year life at all: Harris says eight, Dallas and Tarrant say ten.',
  },
  {
    id: 'tx-collin-2026-office-2023',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2023, five-year class',
    input: { originalCost: 18_500, acquisitionYear: 2023, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1, percentGood: 54, marketValue: 9_990, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 5 YEARS column, year acquired 2023 → 54%. "OFFICE EQUIP (COPIER, FAX, PHONE)" is printed under that column.',
  },
  {
    id: 'tx-collin-2026-office-2015',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2015, older than the five-year column runs',
    input: { originalCost: 18_500, acquisitionYear: 2015, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1, percentGood: 13, marketValue: 2_405, atFloor: true },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 5 YEARS column: the last printed row is 2018 at 13%, which is where the column bottoms out. Anything older takes that figure, which is what `atFloor` records.',
  },
  {
    id: 'tx-collin-2026-machinery-2020',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Manufacturing equipment bought 2020 by a business with a Harris SIC life of 12',
    input: {
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
      businessSic: '3599',
    },
    expected: { indexFactor: 1, percentGood: 67, marketValue: 167_500, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 10 YEARS column, year acquired 2020 → 67%. "MANUFACTURING EQUIPMENT" is printed under that column. The SIC is supplied and ignored: CCAD publishes business-line legends under each column but no SIC table, so the largest lever on a Harris County rendition does not exist here.',
  },
  {
    id: 'tx-collin-2026-machinery-2021',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'The same equipment a year older, and worth more',
    input: { originalCost: 250_000, acquisitionYear: 2021, categoryKey: 'machinery-equipment' },
    expected: { indexFactor: 1, percentGood: 73, marketValue: 182_500, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 10 YEARS column: 2022 reads 71 and 2021 reads 73. A factor that rises with age is impossible for percent good and ordinary for a PVF, because the cost index inside it outruns a year of depreciation. This case and the one above are a pair on purpose — an "obvious" correction to either breaks the other.',
  },
  {
    id: 'tx-collin-2026-pc-2024',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Laptops bought 2024',
    input: { originalCost: 9_000, acquisitionYear: 2024, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1, percentGood: 56, marketValue: 5_040, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, COMPUTERS column, year acquired 2024 → 56%. That column reads 78 / 56 / 35 / 13 / 10, which is cell for cell the HCAD personal computer table. Two districts landing on identical figures is the strongest external check this transcription has, and it is why the same 56 appears in the Harris suite.',
  },
  {
    id: 'tx-collin-2026-mainframe-2024',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Servers and point-of-sale registers bought 2024',
    input: { originalCost: 9_000, acquisitionYear: 2024, categoryKey: 'computer-mainframe' },
    expected: { indexFactor: 1, percentGood: 66, marketValue: 5_940, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 4 YEARS column, year acquired 2024 → 66%. CCAD prints "MAINFRAMES, SERVERS, ROUTERS" and "POS EQUIPMT" under the same four-year column, so unlike Tarrant this district does not split the two.',
  },
  {
    id: 'tx-collin-2026-telecom-2022',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Network gear bought 2022',
    input: { originalCost: 30_000, acquisitionYear: 2022, categoryKey: 'telecom-8' },
    expected: { indexFactor: 1, percentGood: 32, marketValue: 9_600, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 4 YEARS column, year acquired 2022 → 32%. CCAD names routers in that column rather than giving telecommunications a life of its own; Harris County values the same gear on an eight-year telecom table, which is a wide disagreement on a category whose key is named for the Harris life.',
  },
  {
    id: 'tx-collin-2026-specific-2022',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Telephone system bought 2022',
    input: { originalCost: 24_000, acquisitionYear: 2022, categoryKey: 'specific-equipment' },
    expected: { indexFactor: 1, percentGood: 36, marketValue: 8_640, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 5 YEARS column, year acquired 2022 → 36%. CCAD publishes no separate specific-equipment table, but it does print phones and faxes inside its five-year office line, so this category has a published home in Collin where in Dallas it has none and gaps. Cell phones are the district’s three-year column and are not this key.',
  },
  {
    id: 'tx-collin-2026-vehicle-2023',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Pickup under one ton bought 2023',
    input: { originalCost: 55_000, acquisitionYear: 2023, categoryKey: 'vehicles' },
    expected: { indexFactor: 1, percentGood: 51, marketValue: 28_050, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, VEHICLES (UNDER ONE TON) column, year acquired 2023 → 51%. Collin publishes its own vehicles column and it is close to the five-year line without being it — 51 here against 54 there. The gap is why this schedule carries a `veh` table rather than rounding one onto the other, and this case is what would catch that rounding.',
  },
  {
    id: 'tx-collin-2026-vehicle-2016',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Pickup bought 2016, older than the vehicles column runs',
    input: { originalCost: 55_000, acquisitionYear: 2016, categoryKey: 'vehicles' },
    expected: { indexFactor: 1, percentGood: 15, marketValue: 8_250, atFloor: true },
    citation:
      'CCAD BPP Depreciation Schedule 2026, VEHICLES column: the last printed row is 2018 at 15%. Anything older takes that figure.',
  },
  {
    id: 'tx-collin-2026-leasehold-2019',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Tenant build-out capitalised 2019, on the shared six-year default',
    input: {
      originalCost: 120_000,
      acquisitionYear: 2019,
      categoryKey: 'leasehold-improvements',
    },
    expected: { indexFactor: 1, percentGood: 26, marketValue: 31_200, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 6 YEARS column, year acquired 2019 → 26%. CCAD prints no legend entry for leasehold improvements at all, so this category keeps the shared six-year default rather than a district answer. It is the weakest case in this file and is here to be visible rather than assumed.',
  },
  {
    id: 'tx-collin-2026-vessel-2020',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Long-lived asset bought 2020, worth more than it cost',
    input: { originalCost: 500_000, acquisitionYear: 2020, categoryKey: 'vessels' },
    expected: { indexFactor: 1, percentGood: 106, marketValue: 530_000, atFloor: false },
    citation:
      'CCAD BPP Depreciation Schedule 2026, 20 YEARS column, year acquired 2020 → 106%. Above 100 because six years of construction inflation outran six years of depreciation on a twenty-year life, and the district publishes the product of the two. A ceiling of 100 imposed anywhere in this package would understate the district’s value and overstate the client’s claim, which is the unsafe direction; this case is the tripwire for it.',
  },
  {
    id: 'tx-collin-2026-inventory-2024',
    jurisdictionId: 'tx-collin',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Finished goods on hand January 1',
    input: { originalCost: 400_000, acquisitionYear: 2024, categoryKey: 'inventory' },
    expected: {
      indexFactor: 1,
      percentGood: 100,
      marketValue: 400_000,
      atFloor: false,
      exempt: false,
    },
    citation:
      'CCAD’s sheet is a depreciation schedule for depreciable assets and prints no inventory column. Texas taxes inventory at market value, so it is carried at full cost and explicitly not exempt — the assertion that separates Texas from Florida.',
  },
];
