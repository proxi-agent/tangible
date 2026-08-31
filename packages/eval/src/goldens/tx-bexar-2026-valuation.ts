import type { ValuationGolden } from '../valuation-goldens.js';

/**
 * Bexar County, tax year 2026: known asset in, known assessed value out.
 *
 * Same guarantee and same limit as every other published-schedule suite — the
 * expectations are computed from the tables in `packages/valuation`, so what
 * they pin is that those tables have not moved since a person read them. A cell
 * transcribed wrong out of BCAD's factor table is wrong here too and this file
 * is green. Only `assessment-notice` cases close that, and Bexar has none.
 *
 * Two properties are pinned here that the other Texas suites cannot pin.
 *
 * The first is the residual. BCAD heads its columns 0410, 0520 … 3020 — life,
 * then the residual the column stops at — and that reading is what turned nine
 * unlabelled columns into life classes 4 through 30. Two cases sit below the
 * bottom of their column so the residual is asserted rather than inferred: a
 * 2014 copier floors at 20% on the eight-year line, and a 2020 laptop floors at
 * **10%** on the four-year line, which is the one column in the table that does
 * not bottom out at 20. Read the codes as anything but life-and-residual and
 * that pair disagrees.
 *
 * The second is that nothing is trended, for the third distinct reason in this
 * directory. Harris publishes an index and applies it; Tarrant publishes none;
 * Bexar publishes a figure with the trending already inside it and sets
 * `costIndexIncluded`. `indexFactor` is 1 in every case below, and unlike
 * Tarrant that does not rest on the category rules — `appraise` reads the flag
 * as authoritative, so a rule flipped to `indexed: true` would still produce 1
 * and these cases would not notice. What they do notice is the flag being
 * removed, which is the failure that would matter: `indexFactors` is empty, so
 * every value here would be unchanged and only `bexar.test.ts` would fall over.
 *
 * Three of BCAD's nine columns are unreachable from here and that is a fact
 * about the district rather than a hole in the suite. No shared category key
 * points at the twelve-, fifteen- or thirty-year columns: those are specialty
 * and heavy manufacturing, breweries and meat packing, pipelines and fibre.
 * They are transcribed, they are tested for shape in `bexar.test.ts`, and a
 * client reaches them only when a preparer moves them there deliberately —
 * which is exactly what the machinery rule's description tells them to
 * consider.
 *
 * To regenerate after loading a new table: run each `input` through `appraise`
 * against the new schedule, diff this file, and have the diff approved.
 */
export const TX_BEXAR_2026_VALUATION_GOLDENS: readonly ValuationGolden[] = [
  {
    id: 'tx-bexar-2026-furniture-2019',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Office furniture bought 2019, eight-year class',
    input: { originalCost: 42_000, acquisitionYear: 2019, categoryKey: 'furniture-fixtures' },
    expected: { indexFactor: 1, percentGood: 33, marketValue: 13_860, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 0820, year acquired 2019 (age 7) → 33%. The 0820 legend opens "All Furniture & Fixtures".',
  },
  {
    id: 'tx-bexar-2026-office-2023',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2023, eight-year class',
    input: { originalCost: 18_500, acquisitionYear: 2023, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1, percentGood: 66, marketValue: 12_210, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 0820, year acquired 2023 (age 3) → 66%. Read off "Office Equipment (Non-IT)"; the 0520 legend also says "Office Equipment", which would give 49% instead.',
  },
  {
    id: 'tx-bexar-2026-office-2014-floor',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2014, past the bottom of the eight-year column',
    input: { originalCost: 18_500, acquisitionYear: 2014, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1, percentGood: 20, marketValue: 3_700, atFloor: true },
    citation:
      'BCAD 2026 Present Value Factor Table, column 0820. The column stops at 2017 (age 9) at 20%, which is the residual its own heading names, and an older asset holds there.',
  },
  {
    id: 'tx-bexar-2026-machinery-2020',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Auto repair equipment bought 2020, ten-year class, SIC supplied',
    input: {
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
      businessSic: '3599',
    },
    expected: { indexFactor: 1, percentGood: 55, marketValue: 137_500, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 1020, year acquired 2020 (age 6) → 55%. The SIC is supplied and ignored: BCAD publishes no SIC table, so the category default is the whole answer.',
  },
  {
    id: 'tx-bexar-2026-pc-2024',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Laptops bought 2024, four-year class',
    input: { originalCost: 9_000, acquisitionYear: 2024, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1, percentGood: 56, marketValue: 5_040, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 0410 ("Computers, Laptops, Tablets"), year acquired 2024 (age 2) → 56%.',
  },
  {
    id: 'tx-bexar-2026-pc-2020-floor',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Laptops bought 2020, past the bottom of the four-year column',
    input: { originalCost: 9_000, acquisitionYear: 2020, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1, percentGood: 10, marketValue: 900, atFloor: true },
    citation:
      'BCAD 2026 Present Value Factor Table, column 0410. The column stops at 2021 (age 5) at 10% — the only residual in the table that is not 20, and the reason the column codes read as life-then-residual rather than as anything else.',
  },
  {
    id: 'tx-bexar-2026-pos-2024',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Point-of-sale registers bought 2024, five-year class',
    input: { originalCost: 9_000, acquisitionYear: 2024, categoryKey: 'computer-mainframe' },
    expected: { indexFactor: 1, percentGood: 64, marketValue: 5_760, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 0520, year acquired 2024 (age 2) → 64%. The 0520 legend names "POS" and "Servers" together, so unlike Tarrant point of sale and mainframes are not split here.',
  },
  {
    id: 'tx-bexar-2026-specific-2022',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Audio-visual and security equipment bought 2022, five-year class',
    input: { originalCost: 24_000, acquisitionYear: 2022, categoryKey: 'specific-equipment' },
    expected: { indexFactor: 1, percentGood: 33, marketValue: 7_920, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 0520 ("Audio/Visual Systems", "Security Equipment", "Small Electronic Tools"), year acquired 2022 (age 4) → 33%.',
  },
  {
    id: 'tx-bexar-2026-telecom-2022',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Network and telephone gear bought 2022, five-year class',
    input: { originalCost: 30_000, acquisitionYear: 2022, categoryKey: 'telecom-8' },
    expected: { indexFactor: 1, percentGood: 33, marketValue: 9_900, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 0520, on "Servers". Carrier plant is a different column entirely — 3020 names fibre optic equipment and utility transmission at 93% for the same year.',
  },
  {
    id: 'tx-bexar-2026-vehicle-2023',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Delivery van bought 2023, six-year class',
    input: { originalCost: 55_000, acquisitionYear: 2023, categoryKey: 'vehicles' },
    expected: { indexFactor: 1, percentGood: 60, marketValue: 33_000, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 0620, whose legend begins "All Vehicles", year acquired 2023 (age 3) → 60%.',
  },
  {
    id: 'tx-bexar-2026-leasehold-2018',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Tenant build-out completed 2018, eight-year class',
    input: { originalCost: 120_000, acquisitionYear: 2018, categoryKey: 'leasehold-improvements' },
    expected: { indexFactor: 1, percentGood: 30, marketValue: 36_000, atFloor: false },
    citation:
      'BCAD publishes nothing for leasehold improvements; column 0820 is taken as the district’s general-purpose line. Harris County says six years and Tarrant says ten, so this is the case to re-run first if the assignment is ever corrected.',
  },
  {
    id: 'tx-bexar-2026-solar-2021',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Rooftop solar array installed 2021, twenty-year class',
    input: { originalCost: 400_000, acquisitionYear: 2021, categoryKey: 'solar' },
    expected: { indexFactor: 1, percentGood: 88, marketValue: 352_000, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 2020, which names "Solar Panel Equipment" outright — the first district after Harris County to publish an answer for solar rather than take a default.',
  },
  {
    id: 'tx-bexar-2026-vessel-2006',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Vessel acquired 2006, twenty-year class',
    input: { originalCost: 500_000, acquisitionYear: 2006, categoryKey: 'vessels' },
    expected: { indexFactor: 1, percentGood: 26, marketValue: 130_000, atFloor: false },
    citation:
      'BCAD 2026 Present Value Factor Table, column 2020, year acquired 2006 (age 20) → 26%. The column exists and the shared twenty-year default lands on it, but its legend is petroleum, quarry and utility plant and says nothing about boats.',
  },
  {
    id: 'tx-bexar-2026-inventory-2024',
    jurisdictionId: 'tx-bexar',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Merchandise inventory, carried at full cost',
    input: { originalCost: 400_000, acquisitionYear: 2024, categoryKey: 'inventory' },
    expected: {
      indexFactor: 1,
      percentGood: 100,
      marketValue: 400_000,
      atFloor: false,
      exempt: false,
    },
    citation:
      'Tex. Tax Code 23.12(a): inventory is market value, and a Texas rendition reports it at cost. BCAD publishes no column for it. Asserted `exempt: false` because the same key is exempt in Florida under s. 196.185, and the two must never be allowed to converge.',
  },
];
