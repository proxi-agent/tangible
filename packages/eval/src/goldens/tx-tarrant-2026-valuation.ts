import type { ValuationGolden } from '../valuation-goldens.js';

/**
 * Tarrant County, tax year 2026: known asset in, known assessed value out.
 *
 * Same guarantee and same limit as every other published-schedule suite — the
 * expectations are computed from the tables in `packages/valuation`, so what
 * they pin is that those tables have not moved since a person read them. A cell
 * transcribed wrong out of TAD's packet is wrong here too and this file is
 * green. Only `assessment-notice` cases close that, and Tarrant has none.
 *
 * Two properties are pinned here that no other Texas suite can pin.
 *
 * The first is that nothing is trended. `indexFactor` is 1 in every case,
 * including on categories Harris County indexes, because TAD publishes percent
 * good and no cost index at all. Unlike Dallas and Collin that is not enforced
 * by `costIndexIncluded`; it rests on all twelve category rules being
 * `indexed: false`, which is exactly the kind of fact that decays quietly. Every
 * case below asserts it.
 *
 * The second is the age-to-year conversion. TAD's schedule is printed by
 * effective age with a blank Year Acquired column, and this transcription
 * resolved it as 2026 minus age. The 1996 vessel case sits on the last printed
 * row — "& OLDER", age 30 — so a conversion that slipped by one year fails
 * there rather than passing everywhere and being wrong by a row.
 *
 * The rest were chosen where Tarrant's answer differs from a neighbour's:
 * leasehold improvements are ten years here and six in Harris, point of sale
 * splits away from mainframes onto a five-year line, and a semiconductor fab's
 * tools land on the ordinary machinery line because no category key reaches
 * TAD's own semiconductor column.
 *
 * To regenerate after loading a new packet: run each `input` through `appraise`
 * against the new schedule, diff this file, and have the diff approved.
 */
export const TX_TARRANT_2026_VALUATION_GOLDENS: readonly ValuationGolden[] = [
  {
    id: 'tx-tarrant-2026-furniture-2019',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Office furniture bought 2019, ten-year class',
    input: { originalCost: 42_000, acquisitionYear: 2019, categoryKey: 'furniture-fixtures' },
    expected: { indexFactor: 1, percentGood: 56, marketValue: 23_520, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 10-year column, effective age 7 → 56%. "*Furniture & Fixtures" is printed under that column and is one of the district’s own starred rendition categories.',
  },
  {
    id: 'tx-tarrant-2026-office-2023',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2023, six-year class',
    input: { originalCost: 18_500, acquisitionYear: 2023, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1, percentGood: 62, marketValue: 11_470, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 6-year column, effective age 3 → 62%. "*Office Equip (phones, copiers, faxes)" is printed under that column.',
  },
  {
    id: 'tx-tarrant-2026-office-2016',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2016, older than the six-year column runs',
    input: { originalCost: 18_500, acquisitionYear: 2016, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1, percentGood: 14, marketValue: 2_590, atFloor: true },
    citation:
      'TAD 2026 Percent Good Schedule, 6-year column: the last printed row is effective age 9 at 14%. The district’s own instruction is to use the category’s lowest percent good for anything older, which is what `atFloor` records.',
  },
  {
    id: 'tx-tarrant-2026-machinery-2020',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Shop machinery bought 2020 by a business with a Harris County SIC life of 12',
    input: {
      originalCost: 250_000,
      acquisitionYear: 2020,
      categoryKey: 'machinery-equipment',
      businessSic: '3599',
    },
    expected: { indexFactor: 1, percentGood: 61, marketValue: 152_500, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 10-year column, effective age 6 → 61%. The SIC is supplied and ignored: TAD names SIC codes only for fast food restaurant equipment and rental-leasing vehicle inventory, so the largest lever on a Harris County rendition does not exist here.',
  },
  {
    id: 'tx-tarrant-2026-pc-2024',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Laptops bought 2024',
    input: { originalCost: 9_000, acquisitionYear: 2024, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1, percentGood: 58, marketValue: 5_220, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 4-year column, effective age 2 → 58%. Computers are a life class in Tarrant, not a separate equipment table as they are in Harris, Dallas and Collin.',
  },
  {
    id: 'tx-tarrant-2026-pos-2024',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Point-of-sale registers bought 2024',
    input: { originalCost: 9_000, acquisitionYear: 2024, categoryKey: 'computer-mainframe' },
    expected: { indexFactor: 1, percentGood: 66, marketValue: 5_940, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 5-year column, effective age 2 → 66%. TAD prints "Point of Sale (POS) Equipment" at five years and excludes it by name from the four-year computers line, so this category and `computer-pc` land on different columns for the same acquisition year.',
  },
  {
    id: 'tx-tarrant-2026-telecom-2022',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Servers bought 2022',
    input: { originalCost: 30_000, acquisitionYear: 2022, categoryKey: 'telecom-8' },
    expected: { indexFactor: 1, percentGood: 35, marketValue: 10_500, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 4-year column, effective age 4 → 35%. TAD names servers in the computers line rather than giving telecommunications a life; Harris County values the same servers on an eight-year telecom table.',
  },
  {
    id: 'tx-tarrant-2026-vehicle-2023',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Pickup bought 2023',
    input: { originalCost: 55_000, acquisitionYear: 2023, categoryKey: 'vehicles' },
    expected: { indexFactor: 1, percentGood: 62, marketValue: 34_100, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 6-year column, effective age 3 → 62%. "*Autos, Trucks, & Trailers" is printed under that column. A rental or leasing fleet is TAD’s five-year line instead.',
  },
  {
    id: 'tx-tarrant-2026-leasehold-2018',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Tenant build-out capitalised 2018',
    input: {
      originalCost: 120_000,
      acquisitionYear: 2018,
      categoryKey: 'leasehold-improvements',
    },
    expected: { indexFactor: 1, percentGood: 52, marketValue: 62_400, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 10-year column, effective age 8 → 52%. "*Leaseholds" is printed under that column. Harris County puts the same build-out on six years, so this is one of the widest single disagreements between the two districts.',
  },
  {
    id: 'tx-tarrant-2026-specific-2022',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Telephone system bought 2022',
    input: { originalCost: 24_000, acquisitionYear: 2022, categoryKey: 'specific-equipment' },
    expected: { indexFactor: 1, percentGood: 53, marketValue: 12_720, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 6-year column, effective age 4 → 53%. TAD publishes no "specific equipment" column, but it does print phones and faxes inside its office equipment line, so this category has a published home in Tarrant where in Dallas it has none and gaps.',
  },
  {
    id: 'tx-tarrant-2026-vessel-1996',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Vessel bought 1996, the last row TAD prints',
    input: { originalCost: 500_000, acquisitionYear: 1996, categoryKey: 'vessels' },
    expected: { indexFactor: 1, percentGood: 25, marketValue: 125_000, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 20-year column, final row "& OLDER" → 25%. This case exists to pin the age-to-year conversion at its far end: the row is effective age 30, and 2026 minus 30 is 1996. An off-by-one in that conversion moves this cell and nothing else obvious.',
  },
  {
    id: 'tx-tarrant-2026-semiconductor-2022',
    jurisdictionId: 'tx-tarrant',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Semiconductor fabrication tools bought 2022, valued as ordinary machinery',
    input: { originalCost: 1_000_000, acquisitionYear: 2022, categoryKey: 'machinery-equipment' },
    expected: { indexFactor: 1, percentGood: 72, marketValue: 720_000, atFloor: false },
    citation:
      'TAD 2026 Percent Good Schedule, 10-year column, effective age 4 → 72%. TAD publishes a SPECIAL column for semiconductor manufacturing equipment that reads 30% at the same age, and this schedule does not carry it because no category key reaches it. The case is here to record what that costs: 72% where the district itself would say 30%. It overstates our value and understates the client’s claim, which is the safe direction, and it is still wrong.',
  },
  {
    id: 'tx-tarrant-2026-inventory-2024',
    jurisdictionId: 'tx-tarrant',
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
      'TAD’s schedule states that it "does not apply to \'Inventory\' items such as Raw Materials, Goods In Process, Finished Goods, Merchandise, or Supplies". Texas taxes inventory, so this is full cost and explicitly not exempt — the assertion that separates Texas from Florida.',
  },
];
