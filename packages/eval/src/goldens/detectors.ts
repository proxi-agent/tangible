import type { SavingsAsset, SavingsInput } from '@tangible/savings';
import type { DetectorGolden } from '../detector-goldens.js';

/**
 * Five small registers, hand-built, each aimed at what one group of detectors
 * has to get right.
 *
 * They are small on purpose. A golden that is a thousand rows tells you the
 * suite went red and nothing else; a golden that is four rows tells you which
 * asset stopped being found and why a person thought it should be. Coverage
 * comes from having several of them rather than from any one being large.
 *
 * Two of the expectations here are not about whether a detector fires but about
 * how loudly. `p1`/`p2` are two pallet jacks with different serial numbers:
 * the duplicate detector is supposed to notice them and then score them down
 * below the medium threshold, because a register cannot tell two identical
 * machines from one machine entered twice. `maxConfidence` is how that promise
 * is held to — a threshold change that quietly promotes them into a reviewer's
 * queue fails here rather than in front of a client.
 *
 * The registers also pin down the *ordering* rule the engine applies, which is
 * invisible in any single detector's own tests: an asset whose value comes off
 * the return entirely is claimed by the first finding that takes it, so a
 * machine at an out-of-district site is a situs question and not also a
 * de-minimis one. Two `mustNotFlag` entries below exist only to hold that.
 */

const asset = (over: Partial<SavingsAsset> & { id: string }): SavingsAsset => ({
  description: 'Asset',
  acquisitionYear: 2022,
  originalCost: 100_000,
  isDisposed: false,
  registerCategory: 'Machinery',
  categoryKey: 'machinery-equipment',
  lifeClassOverride: null,
  status: 'confirmed',
  ...over,
});

const HOUSTON = {
  label: 'Houston Office',
  jurisdictionId: 'tx-harris',
  jurisdictionName: 'Harris County, TX',
};
const AUSTIN = {
  label: 'Austin Plant',
  jurisdictionId: 'tx-travis',
  jurisdictionName: 'Travis County, TX',
};

const base = (
  assets: SavingsAsset[],
  over: Partial<Omit<SavingsInput, 'schedule'>> = {},
): Omit<SavingsInput, 'schedule'> => ({
  engagementId: 'golden',
  clientName: 'Golden Co',
  taxYear: 2026,
  jurisdictionId: 'tx-harris',
  assets,
  assessed: null,
  businessSic: '3599',
  blendedTaxRate: 0.025,
  exemptionAmount: 125_000,
  generatedAt: '2026-08-27T00:00:00.000Z',
  ...over,
});

export const DETECTOR_GOLDENS: readonly DetectorGolden[] = [
  {
    id: 'golden-disposals',
    description: 'Disposals and dead weight',
    input: base(
      [
        asset({
          id: 'g1',
          description: 'Haas lathe',
          acquisitionYear: 2019,
          originalCost: 180_000,
          isDisposed: true,
          disposalDate: '2025-06-30',
          registerLocation: 'Houston Plant',
          serialNumber: 'HL-4410',
        }),
        asset({
          id: 'f1',
          description: 'Belt conveyor',
          acquisitionYear: 2005,
          originalCost: 220_000,
          registerLocation: 'Houston Plant',
          serialNumber: 'BC-9021',
        }),
        asset({
          id: 's1',
          description: 'Misc shop equipment',
          acquisitionYear: 1999,
          originalCost: 40_000,
          registerLocation: null,
          serialNumber: null,
          costCenter: 'SHOP',
        }),
        asset({
          id: 'ok1',
          description: 'CNC machining center',
          acquisitionYear: 2023,
          originalCost: 300_000,
          registerLocation: 'Houston Plant',
          serialNumber: 'CNC-88231',
        }),
      ],
      { knownLocations: ['Houston Plant'] },
    ),
    mustFlag: [
      {
        assetId: 'g1',
        findingKey: 'ghost-assets',
        reason: 'A disposal date in the register is the least arguable adjustment on the list',
        minConfidence: 0.9,
      },
      {
        assetId: 'f1',
        findingKey: 'fully-depreciated',
        reason:
          'A 2005 conveyor is below the schedule floor and the register still carries it at cost',
      },
      {
        assetId: 's1',
        findingKey: 'suspected-retired',
        reason: 'Twenty-seven years old, no location, no serial — worth a walk-through',
        maxConfidence: 0.45,
      },
    ],
    mustNotFlag: [
      {
        assetId: 'ok1',
        findingKey: 'ghost-assets',
        reason: 'It is three years old, in service, and nothing says it left',
      },
      {
        assetId: 'ok1',
        findingKey: 'suspected-retired',
        reason: 'It has a serial number, a location and an age well inside its life',
      },
      {
        assetId: 'ok1',
        findingKey: 'fully-depreciated',
        reason: 'A 2023 machine is nowhere near the floor',
      },
    ],
  },
  {
    id: 'golden-what-the-register-calls-an-asset',
    description: 'Improvements, double entries, leases and impairments',
    input: base(
      [
        asset({
          id: 'x1',
          description: 'NetSuite implementation - capitalized',
          categoryKey: 'excluded-intangible',
          registerCategory: 'Software',
          acquisitionYear: 2023,
          originalCost: 380_000,
        }),
        asset({
          id: 'x2',
          description: 'Warehouse slab and dock levellers',
          categoryKey: 'excluded-real-property',
          registerCategory: 'Buildings',
          acquisitionYear: 2020,
          originalCost: 1_100_000,
        }),
        asset({
          id: 'n1',
          description: 'Leasehold improvements - tenant build out',
          categoryKey: 'leasehold-improvements',
          registerCategory: 'Leasehold Improvements',
          acquisitionYear: 2021,
          originalCost: 640_000,
        }),
        asset({
          id: 'd1',
          description: 'Packaging line',
          acquisitionYear: 2022,
          originalCost: 125_000,
          vendor: 'Bosch',
          acquisitionDate: '2022-03-14',
        }),
        asset({
          id: 'd2',
          description: 'Packaging line',
          acquisitionYear: 2022,
          originalCost: 125_000,
          vendor: 'Bosch',
          acquisitionDate: '2022-03-14',
        }),
        asset({
          id: 'p1',
          description: 'Pallet jack',
          acquisitionYear: 2022,
          originalCost: 4_200,
          serialNumber: 'PJ-001',
        }),
        asset({
          id: 'p2',
          description: 'Pallet jack',
          acquisitionYear: 2022,
          originalCost: 4_200,
          serialNumber: 'PJ-002',
        }),
        asset({
          id: 'l1',
          description: 'ROU asset - forklift operating lease',
          acquisitionYear: 2023,
          originalCost: 88_000,
          vendor: 'Toyota Industries Commercial Finance',
        }),
        asset({
          id: 'i1',
          description: 'Extruder line',
          acquisitionYear: 2021,
          originalCost: 500_000,
          netBookValue: 5_000,
          accumulatedDepreciation: 495_000,
          registerLife: '15',
        }),
      ],
      { knownLocations: ['Houston Plant'] },
    ),
    mustFlag: [
      {
        assetId: 'x1',
        findingKey: 'non-taxable',
        reason:
          'Software and its capitalized implementation are not tangible personal property under Tax Code 11.02, and a register that books them beside machinery renders them anyway',
      },
      {
        assetId: 'x2',
        findingKey: 'non-taxable',
        reason:
          'A slab is appraised on the real property account. Rendering it here pays for it twice',
      },
      {
        assetId: 'n1',
        findingKey: 'leasehold-double-tax',
        reason:
          "Tax Code 23.24 bars appraising an improvement as personal property where the landlord's real property assessment already includes it",
      },
      {
        assetId: 'd1',
        findingKey: 'duplicate-capitalization',
        reason: 'Same description, cost, vendor and purchase date, and neither line has a serial',
        minConfidence: 0.9,
      },
      {
        assetId: 'd2',
        findingKey: 'duplicate-capitalization',
        reason: 'The other half of the same pair',
        minConfidence: 0.9,
      },
      {
        assetId: 'p1',
        findingKey: 'duplicate-capitalization',
        reason:
          'Two identical pallet jacks with distinct serial numbers must be noticed and then scored down — a reviewer should see that it was considered and set aside, not have it in their queue',
        maxConfidence: 0.45,
      },
      {
        assetId: 'p2',
        findingKey: 'duplicate-capitalization',
        reason: 'The other half of the pair that is really two machines',
        maxConfidence: 0.45,
      },
      {
        assetId: 'l1',
        findingKey: 'leased-double-report',
        reason: 'An ASC 842 right-of-use line: the lessor owns it and renders it',
      },
      {
        assetId: 'i1',
        findingKey: 'idle-obsolete',
        reason:
          'Written down to 1% of cost five years into a fifteen-year life. A lead for an obsolescence argument, and no more than that',
        maxConfidence: 0.45,
      },
    ],
    mustNotFlag: [
      {
        assetId: 'd1',
        findingKey: 'ghost-assets',
        reason: 'A double entry is not a disposal',
      },
    ],
  },
  {
    id: 'golden-situs-and-the-invoice',
    description: 'Property in the wrong place, and cost that was never property',
    input: base(
      [
        asset({
          id: 'inv1',
          description: 'Finished goods inventory',
          categoryKey: 'inventory',
          registerCategory: 'Inventory',
          acquisitionYear: 2025,
          originalCost: 2_400_000,
        }),
        asset({
          id: 'sit1',
          description: 'Environmental test chamber',
          acquisitionYear: 2022,
          originalCost: 210_000,
          registerLocation: 'Tulsa OK Yard',
          serialNumber: 'ETC-7',
        }),
        asset({
          id: 'ok2',
          description: 'Hydraulic press brake',
          acquisitionYear: 2021,
          originalCost: 340_000,
          registerLocation: 'Houston Plant',
          serialNumber: 'HPB-3',
        }),
        asset({
          id: 'nac1',
          description: 'Stamping press with installation',
          acquisitionYear: 2024,
          originalCost: 460_000,
          registerLocation: 'Houston Plant',
          serialNumber: 'SP-9',
        }),
      ],
      {
        knownLocations: ['Houston Plant'],
        invoiceSplits: [
          {
            assetId: 'nac1',
            bookedCost: 460_000,
            assessableCost: 380_000,
            excluded: [
              { label: 'Freight and rigging', amount: 46_000 },
              { label: 'Millwright labour', amount: 24_000 },
              { label: 'Sales tax', amount: 10_000 },
            ],
            extractionConfidence: 0.9,
            reviewed: true,
            documentLabel: 'Schuler invoice 44120',
          },
        ],
      },
    ),
    mustFlag: [
      {
        assetId: 'inv1',
        findingKey: 'freeport',
        reason:
          'Inventory raises the 11.251 question. It stays a question — nothing in a register says what share ships out of state inside 175 days',
        maxConfidence: 0.45,
      },
      {
        assetId: 'sit1',
        findingKey: 'situs-error',
        reason: 'The register puts it in Oklahoma and Oklahoma is not one of the sites on file',
      },
      {
        assetId: 'nac1',
        findingKey: 'non-assessable-cost',
        reason:
          'A read and reviewed invoice showing $80,000 of freight, labour and sales tax inside a capitalized equipment line',
        minConfidence: 0.9,
      },
    ],
    mustNotFlag: [
      {
        assetId: 'ok2',
        findingKey: 'situs-error',
        reason: 'It sits at a location the client told us about',
      },
      {
        assetId: 'ok2',
        findingKey: 'non-assessable-cost',
        reason:
          'Nothing is ever estimated from a percentage here. No invoice behind the line means no finding',
      },
      {
        assetId: 'sit1',
        findingKey: 'duplicate-capitalization',
        reason: 'Different machines at different costs are not a double entry',
      },
    ],
  },
  {
    id: 'golden-copied-forward',
    description: "Last year's return copied forward, and a class the client set too short",
    input: base(
      [
        asset({
          id: 'c1',
          description: 'Injection moulder',
          acquisitionYear: 2022,
          originalCost: 240_000,
          registerLocation: 'Houston Plant',
          serialNumber: 'IM-1',
        }),
        asset({
          id: 'c2',
          description: 'Chiller unit',
          acquisitionYear: 2022,
          originalCost: 160_000,
          registerLocation: 'Houston Plant',
          serialNumber: 'CH-1',
        }),
        asset({
          id: 'm1',
          description: 'Server rack and switchgear',
          acquisitionYear: 2023,
          originalCost: 600_000,
          registerLife: '3',
          registerLocation: 'Houston Plant',
          serialNumber: 'SR-1',
        }),
      ],
      {
        knownLocations: ['Houston Plant'],
        priorFiling: {
          taxYear: 2025,
          lines: [
            { categoryKey: 'machinery-equipment', yearAcquired: 2022, historicalCost: 900_000 },
          ],
        },
      },
    ),
    mustFlag: [
      {
        assetId: 'c1',
        findingKey: 'carryforward-error',
        reason:
          'The 2025 return claimed $900,000 of 2022 machinery against $400,000 on the books. Each row carries its pro-rata share of the excess',
      },
      {
        assetId: 'c2',
        findingKey: 'carryforward-error',
        reason: 'The other row in the over-reported bucket',
      },
      {
        assetId: 'm1',
        findingKey: 'misclassification',
        reason:
          "The client's own books depreciate it over three years while the return renders it over fifteen. The two cannot both be right",
      },
    ],
    mustNotFlag: [
      {
        assetId: 'm1',
        findingKey: 'carryforward-error',
        reason: 'It is 2023 property and the over-reported bucket is 2022',
      },
    ],
  },
  {
    id: 'golden-small-office',
    description: 'A whole location under the exemption threshold',
    input: base(
      [
        asset({
          id: 'big1',
          description: 'Injection moulder',
          acquisitionYear: 2022,
          originalCost: 900_000,
          registerLocation: 'Austin Plant',
          serialNumber: 'IM-1',
          site: AUSTIN,
        }),
        asset({
          id: 'm1',
          description: 'Server rack',
          acquisitionYear: 2023,
          originalCost: 60_000,
          registerLife: '3',
          registerLocation: 'Houston Office',
          serialNumber: 'SR-1',
          site: HOUSTON,
        }),
        asset({
          id: 'sm1',
          description: 'Workbenches and shelving',
          acquisitionYear: 2023,
          originalCost: 12_000,
          categoryKey: 'furniture-fixtures',
          registerCategory: 'Furniture',
          registerLocation: 'Houston Office',
          serialNumber: 'WB-1',
          site: HOUSTON,
        }),
      ],
      { knownLocations: ['Houston Office', 'Austin Plant'] },
    ),
    mustFlag: [
      {
        assetId: 'm1',
        findingKey: 'de-minimis',
        reason:
          'Everything the client holds in Harris adds to less than the $125,000 threshold, so the whole position goes to zero rather than being reduced',
      },
      {
        assetId: 'sm1',
        findingKey: 'de-minimis',
        reason: 'The other row in the district that falls under',
      },
      {
        assetId: 'big1',
        findingKey: 'situs-error',
        reason: 'The plant is in Travis County and this return is Harris',
      },
    ],
    mustNotFlag: [
      {
        assetId: 'big1',
        findingKey: 'de-minimis',
        reason:
          'It belongs to the Travis position, not this one. The ordering rule — value that comes off entirely is claimed once — is what keeps the two from being counted twice',
      },
      {
        assetId: 'm1',
        findingKey: 'misclassification',
        reason:
          'The same ordering rule. Arguing the class of an asset already exempt in full would be arguing for nothing',
      },
    ],
  },
];
