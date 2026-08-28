import type { CategoryRule, DepreciationSchedule } from './types.js';

/**
 * Asset categories and the schedule each is valued on, transcribed from page 1
 * of HCAD's 2026 guide ("Asset Category / Schedule").
 *
 * This is the table an asset has to be classified into before it can be valued,
 * and the classes are not interchangeable: the same $20,000 of equipment
 * acquired in 2022 is worth $2,600 as a personal computer and $12,800 as
 * 12-year machinery. Getting an asset into the right row is where the savings
 * are, which is why classification is reviewed by a person rather than trusted
 * to a description match.
 */
export const HCAD_CATEGORIES: readonly CategoryRule[] = [
  {
    key: 'inventory',
    label: 'Inventory and supplies',
    schedule: 'none',
    indexed: false,
    description:
      'Finished goods, supplies, raw materials, and work in process. Carried at 100% of original cost — no index, no depreciation. Only what is on hand January 1 is renderable.',
  },
  {
    key: 'furniture-fixtures',
    label: 'Furniture and fixtures',
    schedule: 8,
    indexed: true,
    description: 'Desks, seating, shelving, casework, and fixtures. Eight-year age/life.',
  },
  {
    key: 'office-equipment',
    label: 'General office equipment',
    schedule: 6,
    indexed: true,
    description: 'Copiers, general office machines, and equipment that is not a computer.',
  },
  {
    key: 'machinery-equipment',
    label: 'Machinery and equipment',
    schedule: 10,
    indexed: true,
    sicDriven: true,
    description:
      "Production and shop machinery. The life comes from the business's SIC code rather than a single default; 10 years stands in until the SIC is known.",
  },
  {
    key: 'computer-pc',
    label: 'Computer equipment (PC)',
    schedule: 'pc',
    indexed: false,
    description:
      'Desktops, laptops, monitors, keyboards, printers, and other input and output devices. Servers are valued on the telecommunications life instead.',
  },
  {
    key: 'computer-mainframe',
    label: 'Mainframe and point of sale',
    schedule: 'mf',
    indexed: false,
    description: 'Mainframes, high-speed production printers, and point-of-sale registers.',
  },
  {
    key: 'specific-equipment',
    label: 'Specific equipment',
    schedule: 'spc',
    indexed: false,
    description:
      'Telephone systems (PBX), mobile radio equipment, cellular telephones, and fax machines.',
  },
  {
    key: 'telecom-8',
    label: 'Telecommunications equipment',
    schedule: 'telecom8',
    indexed: false,
    description:
      'Telecommunications equipment, including servers. The life depends on the type of electronic component; the 8-year schedule is the common case.',
  },
  {
    key: 'leasehold-improvements',
    label: 'Leasehold improvements',
    schedule: 6,
    indexed: true,
    description:
      'Tenant build-out carried as personal property. Worth checking against the landlord’s real-property assessment — Tax Code 23.24 bars taxing the same improvement twice when the real property was appraised by a method that already includes it.',
  },
  {
    key: 'solar',
    label: 'Solar energy device',
    schedule: 10,
    indexed: true,
    description:
      'On-site solar generation. Ten-year age/life; may also qualify for the Tax Code 11.27 exemption, which is a separate application.',
  },
  {
    key: 'vehicles',
    label: 'Licensed vehicles',
    schedule: 6,
    indexed: false,
    description:
      'Valued from Info Nation rather than cost where a match exists, otherwise a six-year age/life off original cost with no index. Vehicles are carried on their own account.',
  },
  {
    key: 'vessels',
    label: 'Vessels',
    schedule: 20,
    indexed: true,
    description: 'Marine vessels. Twenty-year age/life.',
  },
];

export const CATEGORY_BY_KEY: Readonly<Record<string, CategoryRule>> = Object.fromEntries(
  HCAD_CATEGORIES.map((category) => [category.key, category]),
);

/**
 * The same keys as a literal tuple.
 *
 * Structured-output schemas need a closed enum the type system can see, and
 * `HCAD_CATEGORIES.map(c => c.key)` widens to string[]. Spelling them twice is
 * the price; a test asserts the two lists never drift apart, so a category added
 * to one and forgotten in the other fails in CI rather than at a client.
 */
export const HCAD_CATEGORY_KEYS = [
  'inventory',
  'furniture-fixtures',
  'office-equipment',
  'machinery-equipment',
  'computer-pc',
  'computer-mainframe',
  'specific-equipment',
  'telecom-8',
  'leasehold-improvements',
  'solar',
  'vehicles',
  'vessels',
] as const;

export type HcadCategoryKey = (typeof HCAD_CATEGORY_KEYS)[number];

/**
 * How this jurisdiction values this category.
 *
 * The lookup order is the whole point of the second state: a jurisdiction's own
 * answer wins, and the HCAD table is what everywhere else falls back to. Note
 * that a jurisdiction can only *re-answer* a key, never invent one — the keys
 * are the classification vocabulary, and a schedule that carried a category
 * nothing can be classified into would be a table with no way to reach it.
 */
export function categoryFor(
  schedule: DepreciationSchedule | null,
  key: string,
): CategoryRule | undefined {
  return schedule?.categories?.[key] ?? CATEGORY_BY_KEY[key];
}

/** Every category as this jurisdiction values it, in the shared display order. */
export function categoriesFor(schedule: DepreciationSchedule | null): CategoryRule[] {
  return HCAD_CATEGORIES.map((category) => schedule?.categories?.[category.key] ?? category);
}
