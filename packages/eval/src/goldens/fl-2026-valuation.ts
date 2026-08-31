import type { ValuationGolden } from '../valuation-goldens.js';

/**
 * Florida, tax year 2026: the Department's own arithmetic, held in place.
 *
 * Every case is `published-schedule`, with the same limit the Harris suite
 * states about itself — the expectations were computed from the tables in
 * `packages/valuation`, so they prove those tables have not moved since a
 * person read them, and they cannot prove the reading was right. Florida needs
 * `assessment-notice` cases for that, off a real TRIM notice from a real
 * county, and has none yet.
 *
 * What this suite carries that Harris's does not is the seam. Florida is not
 * Texas with different digits: two whole categories leave the roll, the
 * computer schedules are trended where Harris depreciates off cost, and a
 * taxpayer's line of business changes nothing. Each of those is a case here,
 * because each is a place where a plausible edit — copying a Harris category
 * rule across, wiring the special schedules in, marking inventory `'none'`
 * instead of `'exempt'` — would still run and produce a number.
 *
 * The transcription is checked five ways in the schedule file's own header.
 * Two of those checks are repeated here as cases rather than left as prose, so
 * they run every time: the Department's worked example, and the six-year column
 * that agrees with Harris cell-for-cell.
 *
 * To regenerate after a new guideline release: run each `input` through
 * `appraise` against the new schedule, diff this file, and have the diff
 * approved. The diff is the review.
 */
export const FL_2026_VALUATION_GOLDENS: readonly ValuationGolden[] = [
  {
    id: 'fl-2026-worked-example-machinery-2019',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: "Machinery bought 2019, the Department's own worked example at age seven",
    input: { originalCost: 250_000, acquisitionYear: 2019, categoryKey: 'machinery-equipment' },
    expected: { indexFactor: 1.38, percentGood: 39, marketValue: 134_550, atFloor: false },
    citation:
      'TPP Appraisal Guidelines VIII.G works a ten-year asset at age seven to 39% and indexes 2019 at 1.38. This case is the one place the transcription is checked against a number the Department published as an answer rather than as a table cell.',
  },
  {
    id: 'fl-2026-furniture-2022',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Office furniture bought 2022, ten-year indexed',
    input: { originalCost: 120_000, acquisitionYear: 2022, categoryKey: 'furniture-fixtures' },
    expected: { indexFactor: 1.06, percentGood: 67, marketValue: 85_224, atFloor: false },
    citation:
      'Attachment D puts furniture and fixtures on ten years; Attachment B indexes 2022 at 1.06 and Attachment C reads 67% at age four.',
  },
  {
    id: 'fl-2026-office-2023',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Copier bought 2023 — ten years in Florida, six in Harris',
    input: { originalCost: 18_500, acquisitionYear: 2023, categoryKey: 'office-equipment' },
    expected: { indexFactor: 1.05, percentGood: 76, marketValue: 14_763, atFloor: false },
    citation:
      'Attachment D gives office equipment the same ten-year life as furniture. The identical asset is a six-year line in Harris, so a rule copied across county lines shows up here as a number that moved.',
  },
  {
    id: 'fl-2026-pc-2024',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Laptops bought 2024 — four-year, and trended, which Harris does not do',
    input: { originalCost: 96_000, acquisitionYear: 2024, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1.04, percentGood: 65, marketValue: 64_896, atFloor: false },
    citation:
      'Attachment C reads the four-year column 83 / 65 / 43 / 24. An index factor of 1.000 here would mean the computers had been quietly wired to the Harris treatment, where the PC schedule runs off original cost — a change that lowers value, which is the direction this product must never drift in by accident.',
  },
  {
    id: 'fl-2026-pc-2009',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Laptops bought 2009, long past the four-year floor',
    input: { originalCost: 96_000, acquisitionYear: 2009, categoryKey: 'computer-pc' },
    expected: { indexFactor: 1.63, percentGood: 18, marketValue: 28_166.4, atFloor: true },
    citation:
      'The four-year column stops at 18%, and an asset older than the last printed row sits there. Trending a sixteen-year-old PC up by 1.63 before flooring it is what the guidelines say to do and is also the argument a taxpayer makes against it — VIII.G note 2 is preserved in the category description for exactly that reason.',
  },
  {
    id: 'fl-2026-mainframe-2021',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Server hardware bought 2021, on the six-year column Harris also publishes',
    input: { originalCost: 310_000, acquisitionYear: 2021, categoryKey: 'computer-mainframe' },
    expected: { indexFactor: 1.26, percentGood: 30, marketValue: 117_180, atFloor: false },
    citation:
      'Florida and Harris print the same six-year percent-good column, cell for cell. That agreement is one of the five checks on the transcription, and this case is it — if 30% ever stops matching the Harris table at the same age, one of the two was mistyped.',
  },
  {
    id: 'fl-2026-telecom-2020',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Telecom equipment bought 2020, eight-year and indexed',
    input: { originalCost: 130_000, acquisitionYear: 2020, categoryKey: 'telecom-8' },
    expected: { indexFactor: 1.37, percentGood: 33, marketValue: 58_773, atFloor: false },
    citation:
      'Attachment D, eight years. Harris runs its industrial telecom schedule unindexed; Florida has no separate telecom table at all and trends it with everything else.',
  },
  {
    id: 'fl-2026-leasehold-2018',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Tenant improvements booked 2018, on a ten-year life this firm chose',
    input: { originalCost: 640_000, acquisitionYear: 2018, categoryKey: 'leasehold-improvements' },
    expected: { indexFactor: 1.43, percentGood: 30, marketValue: 274_560, atFloor: false },
    citation:
      'DR-405 line 20 makes leasehold improvements returnable, and Attachment D has no line for them. Ten years is this firm’s reading, not the Department’s, and it is pinned here so that reading is a decision somebody signed rather than a default nobody noticed.',
  },
  {
    id: 'fl-2026-specific-2022',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Shorter-lived specific equipment bought 2022',
    input: { originalCost: 65_000, acquisitionYear: 2022, categoryKey: 'specific-equipment' },
    expected: { indexFactor: 1.06, percentGood: 41, marketValue: 28_249, atFloor: false },
    citation: 'Attachment D, six years.',
  },
  {
    id: 'fl-2026-vessels-2015',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'A commercial vessel bought 2015, on the twenty-year table',
    input: { originalCost: 480_000, acquisitionYear: 2015, categoryKey: 'vessels' },
    expected: { indexFactor: 1.5, percentGood: 55, marketValue: 396_000, atFloor: false },
    citation:
      'Florida overrides ten categories and deliberately lets vessels fall through to the shared twenty-year table, because Attachment D’s water-transportation line says twenty as well. The case exists to keep that fall-through honest: it mixes Florida index factors with a percent-good column Florida did not override, and if either half moves the product changes.',
  },
  {
    id: 'fl-2026-machinery-2025-base-year',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Machinery bought in the base year 2025',
    input: { originalCost: 500_000, acquisitionYear: 2025, categoryKey: 'machinery-equipment' },
    expected: { indexFactor: 1, percentGood: 92, marketValue: 460_000, atFloor: false },
    citation:
      'The base year sits at 1.000 and the first year of depreciation. If it ever drifts off 1.000 every other factor in Attachment B is suspect, which is why the cheapest case in the suite is worth keeping.',
  },
  {
    id: 'fl-2026-machinery-sic-ignored',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'The same 2019 machinery with a bakery SIC on file, which changes nothing',
    input: {
      originalCost: 250_000,
      acquisitionYear: 2019,
      categoryKey: 'machinery-equipment',
      businessSic: '2051',
    },
    expected: { indexFactor: 1.38, percentGood: 39, marketValue: 134_550, atFloor: false },
    citation:
      'Harris reads the machinery life off the taxpayer’s SIC and the same ovens are $30,000 apart on a different line of business. Florida publishes one life per equipment type and no SIC table, so this case must equal the worked example exactly — the pair is what stops the Harris behaviour being inherited by a jurisdiction that does not do it.',
  },
  {
    id: 'fl-2026-inventory-exempt',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'Inventory, which Florida does not tax at all',
    input: { originalCost: 1_200_000, acquisitionYear: 2025, categoryKey: 'inventory' },
    expected: { indexFactor: 1, percentGood: 0, marketValue: 0, atFloor: false, exempt: true },
    citation:
      's. 196.185 exempts inventory outright. Texas renders it at cost, so this is the widest divergence between the two jurisdictions the product serves, and the `exempt` flag is asserted rather than just the zero: a zero alone would also be produced by a table nobody filled in.',
  },
  {
    id: 'fl-2026-vehicle-exempt',
    jurisdictionId: 'fl',
    taxYear: 2026,
    basis: 'published-schedule',
    description: 'A licensed pickup, which is not tangible personal property in Florida',
    input: { originalCost: 55_000, acquisitionYear: 2022, categoryKey: 'vehicles' },
    expected: { indexFactor: 1, percentGood: 0, marketValue: 0, atFloor: false, exempt: true },
    citation:
      's. 192.001(11)(d) puts licensed vehicles outside the definition of tangible personal property, so they never reach the DR-405. Harris values the same truck at 41% of cost. A client with fleet on both sides of the state line is rendered two different ways, and this case is the one that fails if that ever collapses into one.',
  },
];
