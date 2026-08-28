import type { ValuationGolden } from '../valuation-goldens.js';

/**
 * Harris County, tax year 2026: known asset in, known assessed value out.
 *
 * Every case here is `published-schedule` — the expectation was computed from
 * the tables committed in `packages/valuation`, and what it guarantees is that
 * those tables have not moved since a person last read them. That is the guard
 * this phase exists to build, and it is worth being exact about its limit: if a
 * figure was transcribed wrong out of HCAD's PDF, it is wrong here too and this
 * suite is green.
 *
 * Closing that gap needs `assessment-notice` cases — a real account, a real
 * notice, and the district's own number. The gate warns for any jurisdiction
 * with none, and Harris has none yet.
 *
 * The cases were chosen to cover the ways the arithmetic branches rather than
 * to cover many dollars: an indexed class and an unindexed one, a life read off
 * the SIC table and the same asset with no SIC on file, a life set by hand, the
 * floor reached in both the general and the special tables, the base year at
 * the top of the index, and inventory, which is carried at cost and depreciates
 * not at all.
 *
 * To regenerate after loading a new guide: run each `input` through `appraise`
 * against the new schedule, diff this file, and have the diff approved. The
 * diff *is* the review — that is why the expectations are committed rather than
 * computed at test time.
 */
export const TX_HARRIS_2026_VALUATION_GOLDENS: readonly ValuationGolden[] = [
  {
    id: 'tx-harris-2026-furniture-2019',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Office furniture bought 2019, eight-year indexed',
    input: { originalCost: 42_000, acquisitionYear: 2019, categoryKey: 'furniture-fixtures' },
    expected: { indexFactor: 1.369, percentGood: 26, marketValue: 14_949.48, atFloor: false },
    citation: 'HCAD 2026 PP Calc Guide pp. 3-4: index 1.369 for 2019, 8-year class 26%.',
  },
  {
    id: 'tx-harris-2026-furniture-1998',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Office furniture bought 1998, long past the eight-year floor',
    input: { originalCost: 42_000, acquisitionYear: 1998, categoryKey: 'furniture-fixtures' },
    expected: { indexFactor: 2.228, percentGood: 13, marketValue: 12_164.88, atFloor: true },
    citation:
      'The 8-year class stops at 13%. An asset older than the last published row sits at the floor, which is what `atFloor` asserts here — a client still rendering this at cost is the fully-depreciated finding.',
  },
  {
    id: 'tx-harris-2026-office-2023',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2023, six-year indexed',
    input: { originalCost: 18_500, acquisitionYear: 2023, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1.048, percentGood: 57, marketValue: 11_051.16, atFloor: false },
    citation: 'HCAD 2026 PP Calc Guide pp. 3-4: index 1.048 for 2023, 6-year class 57%.',
  },
  {
    id: 'tx-harris-2026-pc-2024',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Laptops bought 2024 — the computer schedule, which is not indexed',
    input: { originalCost: 96_000, acquisitionYear: 2024, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1, percentGood: 56, marketValue: 53_760, atFloor: false },
    citation:
      'The PC schedule depreciates straight off original cost. An index factor other than 1.000 here would mean the special schedules had been wired to the general table.',
  },
  {
    id: 'tx-harris-2026-pc-2019',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Laptops bought 2019, past the computer floor',
    input: { originalCost: 96_000, acquisitionYear: 2019, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1, percentGood: 10, marketValue: 9_600, atFloor: true },
    citation: 'The PC schedule floors at 10%.',
  },
  {
    id: 'tx-harris-2026-machinery-sic-bakery',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Bakery ovens bought 2016, life read off SIC 2051',
    input: {
      originalCost: 250_000,
      acquisitionYear: 2016,
      categoryKey: 'machinery-equipment',
      businessSic: '2051',
    },
    expected: { indexFactor: 1.496, percentGood: 29, marketValue: 108_460, atFloor: false },
    citation:
      "HCAD reads the machinery life off the taxpayer's SIC code. Bread and bakery products is a twelve-year line of business.",
  },
  {
    id: 'tx-harris-2026-machinery-no-sic',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'The same machinery with no SIC on file, which is a different number',
    input: { originalCost: 250_000, acquisitionYear: 2016, categoryKey: 'machinery-equipment' },
    expected: { indexFactor: 1.496, percentGood: 21, marketValue: 78_540, atFloor: false },
    citation:
      "The category default is ten years. The pair of cases is the point: the same machine on a different line of business is $30,000 apart, which is the misclassification lever priced.",
  },
  {
    id: 'tx-harris-2026-machinery-override-15',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Machinery bought 2012 with a fifteen-year life set by hand',
    input: {
      originalCost: 800_000,
      acquisitionYear: 2012,
      categoryKey: 'machinery-equipment',
      lifeClassOverride: 15,
    },
    expected: { indexFactor: 1.53, percentGood: 23, marketValue: 281_520, atFloor: false },
    citation: 'An explicit life beats both the SIC table and the category default.',
  },
  {
    id: 'tx-harris-2026-vehicle-2022',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Pickup bought 2022',
    input: { originalCost: 55_000, acquisitionYear: 2022, categoryKey: 'vehicles' },
    expected: { indexFactor: 1, percentGood: 41, marketValue: 22_550, atFloor: false },
    citation: 'Vehicles depreciate off original cost without being trended up first.',
  },
  {
    id: 'tx-harris-2026-telecom-2021',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Industrial telecom equipment bought 2021',
    input: { originalCost: 130_000, acquisitionYear: 2021, categoryKey: 'telecom-8' },
    expected: { indexFactor: 1, percentGood: 43, marketValue: 55_900, atFloor: false },
    citation: 'The eight-year industrial telecom schedule, unindexed.',
  },
  {
    id: 'tx-harris-2026-solar-2023',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Rooftop solar bought 2023',
    input: { originalCost: 400_000, acquisitionYear: 2023, categoryKey: 'solar' },
    expected: { indexFactor: 1.048, percentGood: 76, marketValue: 318_592, atFloor: false },
    citation: 'HCAD 2026 PP Calc Guide pp. 3-4.',
  },
  {
    id: 'tx-harris-2026-specific-2020',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Specific equipment bought 2020',
    input: { originalCost: 65_000, acquisitionYear: 2020, categoryKey: 'specific-equipment' },
    expected: { indexFactor: 1, percentGood: 10, marketValue: 6_500, atFloor: false },
    citation:
      'The specific-equipment schedule is short and steep — 2020 is its last published row at 10%, not the floor, which is why `atFloor` is false here and true one year earlier.',
  },
  {
    id: 'tx-harris-2026-inventory',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Inventory, carried at cost',
    input: { originalCost: 1_200_000, acquisitionYear: 2025, categoryKey: 'inventory' },
    expected: { indexFactor: 1, percentGood: 100, marketValue: 1_200_000, atFloor: false },
    citation:
      'Inventory is rendered at cost and depreciates not at all. A percent good below 100 here would understate a rendition, which is the one direction of error this product must never make.',
  },
  {
    id: 'tx-harris-2026-machinery-base-year',
    jurisdictionId: 'tx-harris',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Machinery bought in the base year 2025, SIC 3599',
    input: {
      originalCost: 500_000,
      acquisitionYear: 2025,
      categoryKey: 'machinery-equipment',
      businessSic: '3599',
    },
    expected: { indexFactor: 1, percentGood: 95, marketValue: 475_000, atFloor: false },
    citation:
      'The base year sits at index 1.000 and the first year of depreciation. If the base year ever drifts off 1.000, every other index factor in the table is suspect.',
  },
];
