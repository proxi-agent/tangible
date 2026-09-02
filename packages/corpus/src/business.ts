import type { CorpusAsset, CorpusBusiness, CorpusSite } from './types.js';

/**
 * Five businesses, and everything each of them owns.
 *
 * The files in this corpus are renderings, not inventions: the assets are
 * defined once here and printed differently by each register format, so a test
 * can say what the right answer is without re-deriving it from the file it is
 * checking. It also makes the corpus internally consistent — the prior-year
 * rendition and the notice for a business report figures that tie to its own
 * register, which is the only way the carry-forward and comparison paths can be
 * exercised on something other than a coincidence.
 *
 * The businesses were chosen for the questions they raise rather than for
 * variety of name. A fabricator whose property sits in two Texas counties. A
 * Florida distributor whose largest single number is exempt inventory. A dental
 * group with more sites than any of them is worth filing a full return for. A
 * carrier whose fleet belongs on Schedule D and whose yard is in three states.
 * And one small clean company, because a corpus of nothing but hard files would
 * quietly redefine "hard" as normal.
 */

const money = (value: number): number => Math.round(value * 100) / 100;

const day = (year: number, month: number, dayOfMonth: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;

interface Spread {
  /** Item descriptions, cycled. */
  items: readonly string[];
  category: string;
  kind: CorpusAsset['kind'];
  count: number;
  /** Cost of the first item; the rest fan out around it deterministically. */
  base: number;
  life: number;
  /** Sites the class is spread across, cycled with the item index. */
  sites: readonly string[];
  tagPrefix: string;
  /** First acquisition year; later items step forward through the range. */
  from: number;
  through: number;
  vendor?: string;
}

/**
 * Expand a class of property into individual rows.
 *
 * Deterministic on purpose — the same costs and dates every run — so a golden
 * total stays a golden total and two runs of the generator can be diffed. The
 * arithmetic is index-derived rather than random for the same reason the far
 * fixture's is: a seeded RNG makes the numbers reproducible but not *legible*,
 * and somebody reading a failing test should be able to work out which row it
 * is talking about.
 */
function spread(spec: Spread, serial: { next: number }): CorpusAsset[] {
  const years = Math.max(1, spec.through - spec.from + 1);
  return Array.from({ length: spec.count }, (_, i) => {
    const year = spec.from + ((i * 7) % years);
    const month = 1 + ((i * 5) % 12);
    const dayOfMonth = 1 + ((i * 11) % 28);
    const cost = money(spec.base * (0.4 + ((i * 37) % 100) / 60));
    const age = 2027 - year;
    const accumulated = money(Math.min(cost, (cost * Math.min(age, spec.life)) / spec.life));
    serial.next += 1;
    return {
      tag: `${spec.tagPrefix}-${String(1000 + serial.next * 3).padStart(5, '0')}`,
      description: spec.items[i % spec.items.length]!,
      category: spec.category,
      kind: spec.kind,
      cost,
      quantity: 1,
      acquired: day(year, month, dayOfMonth),
      life: spec.life,
      siteId: spec.sites[i % spec.sites.length]!,
      accumulated,
      disposedOn: null,
      vendor: spec.vendor ?? null,
    } satisfies CorpusAsset;
  });
}

function build(specs: readonly Spread[]): CorpusAsset[] {
  const serial = { next: 0 };
  return specs.flatMap((spec) => spread(spec, serial));
}

// ---------------------------------------------------------------------------
// Ironwood Fabrication Group, LP — Texas, two counties
// ---------------------------------------------------------------------------

const IRONWOOD_SITES: readonly CorpusSite[] = [
  {
    id: 'hou',
    label: 'Houston Plant',
    aliases: ['Houston Plant', 'HOU', 'Houston - Plant 1', 'Plant 1'],
    street: '4400 Clinton Dr',
    city: 'Houston',
    state: 'TX',
    zip: '77020',
    county: 'Harris',
    account: '0421030000018',
  },
  {
    id: 'katy',
    label: 'Katy Warehouse',
    aliases: ['Katy Whse', 'KATY WAREHOUSE', 'Katy'],
    street: '1875 Katy Fort Bend Rd',
    city: 'Katy',
    state: 'TX',
    zip: '77493',
    county: 'Fort Bend',
    account: 'B0114552',
  },
];

const IRONWOOD_ASSETS = build([
  {
    items: [
      'CNC MILL, HAAS VF-4SS',
      'PRESS BRAKE, AMADA HFE-1003',
      'LASER CUTTER, TRUMPF TRULASER 3030',
      'WELDING CELL, LINCOLN POWER WAVE',
      'SURFACE GRINDER, OKAMOTO ACC-1224',
      'AIR COMPRESSOR, 100HP ROTARY SCREW',
      'OVERHEAD CRANE, 10 TON',
      'BANDSAW, DOALL C-916M',
    ],
    category: 'Machinery & Equipment',
    kind: 'machinery',
    count: 34,
    base: 48_000,
    life: 10,
    sites: ['hou', 'hou', 'katy'],
    tagPrefix: 'M',
    from: 2009,
    through: 2026,
  },
  {
    items: [
      'DESK, 60X30 LAMINATE',
      'TASK CHAIR, HERMAN MILLER AERON',
      'CONFERENCE TABLE, 10 FT',
      'FILE CABINET, 4-DRAWER LATERAL',
      'SHOP WORKBENCH, 8 FT STEEL',
    ],
    category: 'Furniture & Fixtures',
    kind: 'furniture',
    count: 16,
    base: 2_400,
    life: 7,
    sites: ['hou', 'katy'],
    tagPrefix: 'F',
    from: 2012,
    through: 2025,
  },
  {
    items: [
      'DELL LATITUDE 5540 LAPTOP',
      'DELL PRECISION 5860 WORKSTATION',
      'HP LASERJET M611DN',
      'CISCO CATALYST 9200 SWITCH',
      'DELL POWEREDGE R750 SERVER',
    ],
    category: 'Computer Equipment',
    kind: 'computer',
    count: 22,
    base: 3_100,
    life: 5,
    sites: ['hou', 'hou', 'katy'],
    tagPrefix: 'C',
    from: 2019,
    through: 2026,
  },
  {
    items: ['FORD F-250 CREW CAB', 'FORD TRANSIT 250 CARGO VAN', 'CHEVROLET SILVERADO 2500HD'],
    category: 'Vehicles',
    kind: 'vehicle',
    count: 6,
    base: 62_000,
    life: 5,
    sites: ['hou'],
    tagPrefix: 'V',
    from: 2020,
    through: 2026,
  },
  {
    items: ['OFFICE BUILD-OUT, SUITE 200', 'ELECTRICAL SERVICE UPGRADE, 480V', 'DOCK LEVELER'],
    category: 'Leasehold Improvements',
    kind: 'leasehold',
    count: 5,
    base: 27_000,
    life: 15,
    sites: ['katy'],
    tagPrefix: 'L',
    from: 2018,
    through: 2024,
  },
  {
    items: ['SOLIDWORKS PREMIUM LICENSE (5 SEATS)', 'ERP IMPLEMENTATION - CAPITALIZED'],
    category: 'Software',
    kind: 'software',
    count: 4,
    base: 18_000,
    life: 3,
    sites: ['hou'],
    tagPrefix: 'S',
    from: 2022,
    through: 2026,
  },
]);

// ---------------------------------------------------------------------------
// Coastal Provisions Co. — Florida, two counties, inventory-heavy
// ---------------------------------------------------------------------------

const COASTAL_SITES: readonly CorpusSite[] = [
  {
    id: 'tampa',
    label: 'Tampa Distribution Center',
    aliases: ['Tampa DC', 'TAMPA', 'Coastal : FL : Tampa DC'],
    street: '5210 Adamo Dr',
    city: 'Tampa',
    state: 'FL',
    zip: '33619',
    county: 'Hillsborough',
    account: 'T-0448216',
  },
  {
    id: 'miami',
    label: 'Miami Branch',
    aliases: ['Miami Branch', 'MIA', 'Coastal : FL : Miami Branch'],
    street: '7900 NW 25th St',
    city: 'Doral',
    state: 'FL',
    zip: '33122',
    county: 'Miami-Dade',
    account: '30-3122-014-0090',
  },
];

const COASTAL_ASSETS = build([
  {
    items: [
      'WALK-IN COOLER, 12X20 (INSTALLED)',
      'REACH-IN FREEZER, TRUE T-49F',
      'BLAST CHILLER, IRINOX MF 180',
      'ICE MACHINE, MANITOWOC IYT0500A',
      'REFRIGERATED CASE, 8 FT',
    ],
    category: 'Refrigeration',
    kind: 'machinery',
    count: 26,
    base: 21_000,
    life: 10,
    sites: ['tampa', 'tampa', 'miami'],
    tagPrefix: 'RF',
    from: 2013,
    through: 2026,
  },
  {
    items: [
      'PALLET RACKING, 40 BAY SECTION',
      'ELECTRIC PALLET JACK, CROWN PE4500',
      'CONVEYOR, GRAVITY ROLLER 60 FT',
      'SHRINK WRAPPER, ORION MA',
      'FLOOR SCRUBBER, TENNANT T300',
    ],
    category: 'Warehouse Equipment',
    kind: 'machinery',
    count: 30,
    base: 9_400,
    life: 10,
    sites: ['tampa', 'miami'],
    tagPrefix: 'WH',
    from: 2011,
    through: 2026,
  },
  {
    items: [
      'ZEBRA ZT411 LABEL PRINTER',
      'HONEYWELL CK65 HANDHELD SCANNER',
      'DELL OPTIPLEX 7010 DESKTOP',
      'UBIQUITI UNIFI ACCESS POINT',
    ],
    category: 'Office & Computer',
    kind: 'computer',
    count: 18,
    base: 2_300,
    life: 5,
    sites: ['tampa', 'miami'],
    tagPrefix: 'IT',
    from: 2020,
    through: 2026,
  },
  {
    items: ['FREIGHTLINER M2 106 BOX TRUCK', 'ISUZU NPR-HD REEFER TRUCK'],
    category: 'Delivery Fleet',
    kind: 'vehicle',
    count: 7,
    base: 96_000,
    life: 7,
    sites: ['tampa', 'miami'],
    tagPrefix: 'TR',
    from: 2019,
    through: 2026,
  },
  {
    items: ['COOLER LEASE - PEPSI MERCHANDISER', 'COFFEE EQUIPMENT ON LOAN - LAVAZZA'],
    category: 'Leased from Others',
    kind: 'leased',
    count: 4,
    base: 4_800,
    life: 7,
    sites: ['tampa', 'miami'],
    tagPrefix: 'LS',
    from: 2021,
    through: 2025,
    vendor: 'Gulf Coast Beverage Services',
  },
  {
    items: ['FROZEN & DRY GOODS INVENTORY - PHYSICAL COUNT 12/31'],
    category: 'Inventory',
    kind: 'inventory',
    count: 2,
    base: 1_240_000,
    life: 1,
    sites: ['tampa', 'miami'],
    tagPrefix: 'INV',
    from: 2026,
    through: 2026,
  },
]);

// ---------------------------------------------------------------------------
// Lone Star Dental Partners, PLLC — Texas, four small offices
// ---------------------------------------------------------------------------

const DENTAL_SITES: readonly CorpusSite[] = [
  {
    id: 'heights',
    label: 'Heights Office',
    aliases: ['Heights', 'HTS', '01 - Heights'],
    street: '1130 Yale St',
    city: 'Houston',
    state: 'TX',
    zip: '77008',
    county: 'Harris',
    account: '0662180000004',
  },
  {
    id: 'sugarland',
    label: 'Sugar Land Office',
    aliases: ['Sugar Land', 'SGL', '02 - Sugar Land'],
    street: '16090 City Walk',
    city: 'Sugar Land',
    state: 'TX',
    zip: '77479',
    county: 'Fort Bend',
    account: 'B0229471',
  },
  {
    id: 'plano',
    label: 'Plano Office',
    aliases: ['Plano', 'PLN', '03 - Plano'],
    street: '5045 Legacy Dr',
    city: 'Plano',
    state: 'TX',
    zip: '75024',
    county: 'Collin',
    account: '2648831',
  },
  {
    id: 'domain',
    label: 'Domain Office',
    aliases: ['Domain', 'ATX', '04 - Domain'],
    street: '11005 Burnet Rd',
    city: 'Austin',
    state: 'TX',
    zip: '78758',
    county: 'Travis',
    account: '0244911',
  },
];

const DENTAL_ASSETS = build([
  {
    items: [
      'DENTAL CHAIR, A-DEC 500',
      'DELIVERY UNIT, A-DEC 532',
      'OPERATORY LIGHT, LED',
      'INTRAORAL X-RAY, PLANMECA PROX',
      'PANORAMIC X-RAY, VATECH GREEN X',
      'AUTOCLAVE, MIDMARK M11',
      'INTRAORAL SCANNER, ITERO ELEMENT 5D',
      'AIR COMPRESSOR, DENTAL 5HP',
      'VACUUM PUMP, DRY 3HP',
    ],
    category: 'Dental Equipment',
    kind: 'machinery',
    count: 44,
    base: 12_500,
    life: 10,
    sites: ['heights', 'sugarland', 'plano', 'domain'],
    tagPrefix: 'DE',
    from: 2014,
    through: 2026,
  },
  {
    items: [
      'RECEPTION DESK, CUSTOM MILLWORK',
      'WAITING ROOM SEATING (SET OF 6)',
      'STERILIZATION CENTER CASEWORK',
      'STAFF LOCKERS',
    ],
    category: 'Furniture & Fixtures',
    kind: 'furniture',
    count: 16,
    base: 5_600,
    life: 7,
    sites: ['heights', 'sugarland', 'plano', 'domain'],
    tagPrefix: 'FF',
    from: 2015,
    through: 2025,
  },
  {
    items: [
      'FRONT DESK PC, DELL OPTIPLEX',
      'OPERATORY MONITOR, 24IN',
      'PRACTICE SERVER, DELL T350',
      'NETWORK SWITCH, MERAKI MS120',
    ],
    category: 'Computers',
    kind: 'computer',
    count: 24,
    base: 1_900,
    life: 5,
    sites: ['heights', 'sugarland', 'plano', 'domain'],
    tagPrefix: 'PC',
    from: 2019,
    through: 2026,
  },
]);

// ---------------------------------------------------------------------------
// Halcyon Logistics LLC — three states, a fleet, and a yard
// ---------------------------------------------------------------------------

const HALCYON_SITES: readonly CorpusSite[] = [
  {
    id: 'mobile',
    label: 'Mobile Terminal',
    aliases: ['Mobile', 'MOB', 'AL-MOBILE'],
    street: '1200 Virginia St',
    city: 'Mobile',
    state: 'AL',
    zip: '36605',
    county: 'Mobile',
    account: '02-27-0-000-014.000',
  },
  {
    id: 'pensacola',
    label: 'Pensacola Yard',
    aliases: ['Pensacola', 'PNS', 'FL-PENSACOLA'],
    street: '3400 W Fairfield Dr',
    city: 'Pensacola',
    state: 'FL',
    zip: '32505',
    county: 'Escambia',
    account: '07-1S-30-1000',
  },
  {
    id: 'houston',
    label: 'Houston Cross-Dock',
    aliases: ['Houston', 'HOU', 'TX-HOUSTON'],
    street: '8200 Wallisville Rd',
    city: 'Houston',
    state: 'TX',
    zip: '77029',
    county: 'Harris',
    account: '0770420000011',
  },
];

const HALCYON_ASSETS = build([
  {
    items: [
      'FREIGHTLINER CASCADIA 126 SLEEPER',
      'INTERNATIONAL LT625 DAY CAB',
      'PETERBILT 579 SLEEPER',
      'KENWORTH T680 DAY CAB',
    ],
    category: 'Revenue Equipment - Tractors',
    kind: 'vehicle',
    count: 18,
    base: 148_000,
    life: 7,
    sites: ['mobile', 'pensacola', 'houston'],
    tagPrefix: 'TRC',
    from: 2018,
    through: 2026,
  },
  {
    items: [
      'DRY VAN TRAILER, 53FT WABASH',
      'REEFER TRAILER, UTILITY 3000R',
      'FLATBED TRAILER, 48FT UTILITY',
      'CHASSIS, 40FT INTERMODAL',
    ],
    category: 'Revenue Equipment - Trailers',
    kind: 'vehicle',
    count: 26,
    base: 44_000,
    life: 10,
    sites: ['mobile', 'pensacola', 'houston'],
    tagPrefix: 'TRL',
    from: 2015,
    through: 2026,
  },
  {
    items: [
      'YARD TRUCK, KALMAR OTTAWA T2',
      'FORKLIFT, HYSTER H80XT',
      'DOCK LEVELER, HYDRAULIC',
      'FUEL ISLAND & TANK, 12,000 GAL',
      'TIRE CHANGER, HEAVY TRUCK',
    ],
    category: 'Shop & Yard Equipment',
    kind: 'machinery',
    count: 21,
    base: 38_000,
    life: 12,
    sites: ['mobile', 'pensacola', 'houston'],
    tagPrefix: 'YD',
    from: 2012,
    through: 2026,
  },
  {
    items: [
      'DISPATCH WORKSTATION, DELL',
      'ELD TABLET, SAMSUNG GALAXY TAB ACTIVE',
      'TMS SERVER, HPE PROLIANT DL360',
    ],
    category: 'Office & Technology',
    kind: 'computer',
    count: 15,
    base: 2_100,
    life: 5,
    sites: ['mobile', 'pensacola', 'houston'],
    tagPrefix: 'OT',
    from: 2020,
    through: 2026,
  },
]);

// ---------------------------------------------------------------------------
// Brightline Analytics, Inc. — one office, fourteen assets, nothing wrong
// ---------------------------------------------------------------------------

const BRIGHTLINE_SITES: readonly CorpusSite[] = [
  {
    id: 'austin',
    label: 'Austin Office',
    aliases: ['Austin Office', 'Austin'],
    street: '600 Congress Ave, Suite 1400',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    county: 'Travis',
    account: '0912440',
  },
];

const BRIGHTLINE_ASSETS = build([
  {
    items: [
      'MACBOOK PRO 16 M4 PRO',
      'DELL U3223QE 32IN MONITOR',
      'HERMAN MILLER EMBODY CHAIR',
      'SIT-STAND DESK, 60X30',
      'LOGITECH RALLY BAR CONFERENCE SYSTEM',
      'UBIQUITI DREAM MACHINE PRO',
      'BREAKROOM REFRIGERATOR',
    ],
    category: 'Office Equipment',
    kind: 'computer',
    count: 14,
    base: 3_400,
    life: 5,
    sites: ['austin'],
    tagPrefix: 'BL',
    from: 2023,
    through: 2026,
  },
]);

export const BUSINESSES: readonly CorpusBusiness[] = [
  {
    id: 'ironwood',
    name: 'Ironwood Fabrication Group',
    entity: 'LP',
    sic: '3441',
    trade: 'structural steel fabrication',
    sites: IRONWOOD_SITES,
    assets: IRONWOOD_ASSETS,
  },
  {
    /**
     * The register the product was rehearsed on, kept in the corpus because it
     * is the hardest file we have and there is no reason to write a second one.
     * Its assets are not enumerated here: they live in
     * `@tangible/far/fixtures`, where the unit tests that pin their totals also
     * live, and restating them would create two answers to one question.
     */
    id: 'meridian',
    name: 'Meridian Fabrication Group',
    entity: 'LP',
    sic: '3441',
    trade: 'structural steel fabrication',
    sites: [
      {
        id: 'hou',
        label: 'Houston Plant',
        aliases: ['Houston Plant', 'HOU', 'Houston - Plant 1'],
        street: '4400 Clinton Dr',
        city: 'Houston',
        state: 'TX',
        zip: '77020',
        county: 'Harris',
        account: '0431770000009',
      },
      {
        id: 'katy',
        label: 'Katy Warehouse',
        aliases: ['Katy Whse', 'KATY WAREHOUSE'],
        street: '1875 Katy Fort Bend Rd',
        city: 'Katy',
        state: 'TX',
        zip: '77493',
        county: 'Fort Bend',
        account: 'B0114779',
      },
    ],
    assets: [],
  },
  {
    id: 'coastal',
    name: 'Coastal Provisions Co.',
    entity: 'Inc.',
    sic: '5142',
    trade: 'wholesale frozen food distribution',
    sites: COASTAL_SITES,
    assets: COASTAL_ASSETS,
  },
  {
    id: 'lonestar',
    name: 'Lone Star Dental Partners',
    entity: 'PLLC',
    sic: '8021',
    trade: 'group dental practice',
    sites: DENTAL_SITES,
    assets: DENTAL_ASSETS,
  },
  {
    id: 'halcyon',
    name: 'Halcyon Logistics',
    entity: 'LLC',
    sic: '4213',
    trade: 'regional trucking and cross-dock',
    sites: HALCYON_SITES,
    assets: HALCYON_ASSETS,
  },
  {
    id: 'brightline',
    name: 'Brightline Analytics',
    entity: 'Inc.',
    sic: '7372',
    trade: 'software',
    sites: BRIGHTLINE_SITES,
    assets: BRIGHTLINE_ASSETS,
  },
];

export function business(id: string): CorpusBusiness {
  const found = BUSINESSES.find((one) => one.id === id);
  if (found === undefined) throw new Error(`No corpus business "${id}".`);
  return found;
}

export function site(one: CorpusBusiness, siteId: string): CorpusSite {
  const found = one.sites.find((each) => each.id === siteId);
  if (found === undefined) throw new Error(`${one.name} has no site "${siteId}".`);
  return found;
}

/** Sum to the cent, the way a subtotal row has to add up. */
export function totalCost(assets: readonly CorpusAsset[]): number {
  return money(assets.reduce((sum, asset) => sum + asset.cost, 0));
}

export function acquisitionYear(asset: CorpusAsset): number {
  return Number(asset.acquired.slice(0, 4));
}

/** Historical cost by year acquired — the shape Schedule E is filed in. */
export function costByYear(assets: readonly CorpusAsset[]): Map<number, number> {
  const byYear = new Map<number, number>();
  for (const asset of assets) {
    const year = acquisitionYear(asset);
    byYear.set(year, money((byYear.get(year) ?? 0) + asset.cost));
  }
  return new Map([...byYear].sort((a, b) => a[0] - b[0]));
}

export { money, day };
