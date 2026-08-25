import * as XLSX from 'xlsx';
import type { FarMapping } from '@tangible/types';
import type { ParsedWorkbook } from '../parse.js';

/**
 * A fixed asset register with the mess a real one has.
 *
 * Everything the pipeline had been tested against until now was clean: a header
 * row, a rectangle of asset rows, one row per asset. No register a client sends
 * looks like that. They come out of Sage or ProSystem or twenty years of one
 * bookkeeper's Excel, and they carry a title block, group bands, subtotals that
 * would double the cost if read as assets, description text that wraps onto the
 * following row, costs typed as "$ 12,345.00", dates typed as "Various", and a
 * page footer at the bottom.
 *
 * So this is the register we get to meet before a client sends one. It is a
 * fixture rather than a stored file on purpose — the pathologies are legible as
 * code and each one can be pointed at from a test, which a binary xlsx checked
 * into the repo could not do. {@link messyRegisterMatrix} is also what the
 * rehearsal script writes out as a real workbook, so the live run and the unit
 * test are looking at the same register.
 *
 * The bulk rows are generated from an index rather than typed out, because the
 * thing worth testing at three hundred rows is not the three hundredth row's
 * particular text — it is that the totals still foot and the skips are still
 * explained when the file is bigger than a screen.
 */

/** Where the deliberate pathologies live, so a test can name what it is checking. */
export const MESSY_REGISTER_FACTS = {
  headerRow: 4,
  /** Rows above the header: company, report title, period, blank. */
  titleBlockRows: 3,
  /** Band labels, in the description column — where every register puts them. */
  bands: [
    'MACHINERY & EQUIPMENT',
    'FURNITURE & FIXTURES',
    'COMPUTER EQUIPMENT',
    'VEHICLES',
    'LEASEHOLD IMPROVEMENTS',
    'SOFTWARE & INTANGIBLES',
    'LAND & BUILDINGS',
  ],
  /** Every real asset row, band by band. Subtotals and bands are not counted. */
  assetsPerBand: [140, 60, 90, 12, 8, 9, 3],
  /** Asset tag carried by two different rows — a real register duplicates tags. */
  duplicateTag: 'M-8801',
} as const;

const HEADER = [
  'Asset #',
  'Description',
  'Location',
  'Date in Service',
  'Cost',
  'Accum Depr',
  'Net Book Value',
  'Life',
  'Status',
];

/** Column index by canonical field, matching {@link MESSY_REGISTER_MAPPING}. */
const COL = {
  assetTag: 0,
  description: 1,
  location: 2,
  inServiceDate: 3,
  originalCost: 4,
  accumulatedDepreciation: 5,
  netBookValue: 6,
  usefulLife: 7,
  disposalIndicator: 8,
} as const;

type Cell = string | number | Date | null;

/**
 * Site names as a register writes them: four spellings of two places, plus the
 * rows nobody filled in. Situs decides the account and the jurisdiction, so a
 * register that cannot say where the property sits is a register that produces
 * questions rather than a filing.
 */
const LOCATIONS = [
  'Houston Plant',
  'HOU',
  'Houston - Plant 1',
  'Katy Whse',
  'KATY WAREHOUSE',
  null,
];

/** Costs the way registers type them, one convention per row rather than one per file. */
function costCell(amount: number, style: number): Cell {
  const fixed = amount.toFixed(2);
  switch (style % 4) {
    case 0:
      return amount; // a real numeric cell
    case 1:
      return `$${Number(fixed).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    case 2:
      return ` ${Number(fixed).toLocaleString('en-US', { minimumFractionDigits: 2 })} `;
    default:
      return fixed;
  }
}

/** Dates the way registers type them, including the two that mean "we don't know". */
function dateCell(year: number, month: number, day: number, style: number): Cell {
  switch (style % 5) {
    case 0:
      return new Date(year, month - 1, day);
    case 1:
      return `${month}/${day}/${year}`;
    case 2:
      return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}/${String(year).slice(2)}`;
    case 3:
      return String(year);
    default:
      return 'Various';
  }
}

const MACHINERY = [
  'CNC MILL, HAAS VF-4SS',
  'PRESS BRAKE, AMADA HFE-1003',
  'LASER CUTTER, TRUMPF TRULASER 3030',
  'WELDING CELL, LINCOLN POWER WAVE',
  'SURFACE GRINDER, OKAMOTO ACC-1224',
  'AIR COMPRESSOR, 100HP ROTARY SCREW',
  'OVERHEAD CRANE, 10 TON',
  'BANDSAW, DOALL C-916M',
  'SHOT BLAST CABINET',
  'FORKLIFT, TOYOTA 8FGU25 (PROPANE)',
];

const FURNITURE = [
  'DESK, 60X30 LAMINATE',
  'TASK CHAIR, HERMAN MILLER AERON',
  'CONFERENCE TABLE, 10 FT',
  'FILE CABINET, 4-DRAWER LATERAL',
  'SHOP WORKBENCH, 8 FT STEEL',
  'BREAKROOM TABLE AND CHAIRS',
];

const COMPUTERS = [
  'DELL LATITUDE 5540 LAPTOP',
  'DELL PRECISION 5860 WORKSTATION',
  'HP LASERJET M611DN',
  'CISCO CATALYST 9200 SWITCH',
  'DELL POWEREDGE R750 SERVER',
  'MONITOR, DELL U2723QE 27IN',
  'APC SMART-UPS 3000VA',
];

const VEHICLES = [
  'FORD F-250 CREW CAB, VIN 1FT7W2BT9NE...',
  'FORD TRANSIT 250 CARGO VAN',
  'CHEVROLET SILVERADO 2500HD',
];

const LEASEHOLD = [
  'OFFICE BUILD-OUT, SUITE 200',
  'ELECTRICAL SERVICE UPGRADE, 480V',
  'DOCK LEVELER INSTALLATION',
  'PAINT BOOTH VENTILATION, INSTALLED',
];

const SOFTWARE = [
  'SOLIDWORKS PREMIUM LICENSE (5 SEATS)',
  'AUTOCAD SUBSCRIPTION',
  'ERP IMPLEMENTATION — CAPITALIZED',
  'MICROSOFT 365 E3, ANNUAL',
];

const REALTY = ['LAND — 4400 CLINTON DR', 'BUILDING — 4400 CLINTON DR', 'PARKING LOT RESURFACING'];

const CATALOG = [MACHINERY, FURNITURE, COMPUTERS, VEHICLES, LEASEHOLD, SOFTWARE, REALTY];
const TAG_PREFIX = ['M', 'F', 'C', 'V', 'L', 'S', 'R'];
const BASE_COST = [48_000, 2_400, 3_100, 62_000, 27_000, 18_000, 410_000];
const LIVES = ['10', '7', '5', '5', '15', '3', '39'];

/**
 * The register as a cell matrix.
 *
 * Deterministic: the same rows every run, so a test can assert an exact total
 * and the rehearsal can be repeated after a fix and compared against the run
 * before it.
 */
export function messyRegisterMatrix(): Cell[][] {
  const rows: Cell[][] = [];
  const blank = (): Cell[] => [];

  rows.push(['MERIDIAN FABRICATION GROUP, LP']);
  rows.push(['Fixed Asset Detail — All Locations']);
  rows.push(['For the period ended 12/31/2026']);
  rows.push(blank());
  rows.push([...HEADER]);

  let serial = 0;

  MESSY_REGISTER_FACTS.bands.forEach((band, b) => {
    // The band label sits in the description column, not at the left margin —
    // column A holds the asset number, and no register leaves it empty to make
    // room for a heading.
    const bandRow: Cell[] = [];
    bandRow[COL.description] = band;
    rows.push(bandRow);

    const catalog = CATALOG[b]!;
    const count = MESSY_REGISTER_FACTS.assetsPerBand[b]!;
    let bandTotal = 0;

    for (let i = 0; i < count; i++) {
      serial += 1;
      const row: Cell[] = new Array(HEADER.length).fill(null);
      const tag = `${TAG_PREFIX[b]}-${1000 + i * 7 + b}`;
      const cost = Math.round(BASE_COST[b]! * (0.35 + ((i * 37) % 100) / 55) * 100) / 100;
      const year = 2005 + ((i * 3 + b) % 21);
      const month = 1 + ((i * 5) % 12);
      const day = 1 + ((i * 11) % 28);
      const accum = Math.round(cost * (0.2 + ((i * 13) % 70) / 100) * 100) / 100;

      row[COL.assetTag] = tag;
      row[COL.description] = catalog[i % catalog.length]!;
      row[COL.location] = LOCATIONS[(i + b) % LOCATIONS.length] ?? null;
      row[COL.inServiceDate] = dateCell(year, month, day, i + b);
      row[COL.originalCost] = costCell(cost, i + b);
      row[COL.accumulatedDepreciation] = accum;
      row[COL.netBookValue] = Math.round((cost - accum) * 100) / 100;
      row[COL.usefulLife] = LIVES[b]!;

      // What a correct reader should get out of this row, which is not always
      // `cost` — a disposal is a credit and a written-down asset is zero. The
      // band's printed subtotal is the sum of these, so a test can foot the
      // band against it exactly.
      let effective = cost;

      // ——— the pathologies, seeded at fixed positions inside the bulk ———

      if (b === 0 && i === 3) {
        // Description too long for the column, wrapped onto the next row by
        // hand. The continuation has nothing else in it.
        row[COL.description] = 'CNC MILL, HAAS VF-4SS WITH 4TH AXIS ROTARY,';
        bandTotal += effective;
        rows.push(row);
        const cont: Cell[] = [];
        cont[COL.description] = '   TSC, AND 20-POCKET SIDE-MOUNT TOOL CHANGER';
        rows.push(cont);
        continue;
      }

      if (b === 0 && i === 9) {
        // A disposal: parenthesised credit, and the status column says so.
        row[COL.originalCost] = `(${cost.toLocaleString('en-US', { minimumFractionDigits: 2 })})`;
        row[COL.disposalIndicator] = 'Disposed 06/30/2026';
        effective = -cost;
      }

      if (b === 0 && i === 17) {
        // Two rows carrying the same asset number. The register does it when a
        // machine is split across two GL entries; nothing downstream may assume
        // the tag is unique.
        row[COL.assetTag] = MESSY_REGISTER_FACTS.duplicateTag;
      }
      if (b === 0 && i === 18) {
        row[COL.assetTag] = MESSY_REGISTER_FACTS.duplicateTag;
      }

      if (b === 0 && i === 25) {
        // Fully depreciated and still on the books at zero. Texas taxes it
        // anyway — there is no zero-value exemption for property in use.
        row[COL.originalCost] = 0;
        row[COL.accumulatedDepreciation] = 0;
        row[COL.netBookValue] = 0;
        effective = 0;
      }

      if (b === 0 && i === 33) {
        row[COL.assetTag] = null; // no tag at all
      }

      if (b === 0 && i === 41) {
        row[COL.description] = null; // a cost with nothing said about it
      }

      if (b === 0 && i === 55) {
        // Not an asset: a supplies line somebody capitalized into the register.
        row[COL.description] = 'SHOP SUPPLIES & CONSUMABLES — 2026 ACCRUAL';
      }

      if (b === 0 && i === 70) {
        row[COL.description] = 'SEE ATTACHED SCHEDULE A';
        row[COL.inServiceDate] = 'Various';
      }

      if (b === 2 && i === 12) {
        // Non-breaking space inside the number, straight out of a web export.
        row[COL.originalCost] = `$ ${cost.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      }

      bandTotal += effective;
      rows.push(row);

      if (b === 0 && i === 60) {
        // A blank row mid-band. Excel files are full of them.
        rows.push(blank());
      }
    }

    // The subtotal. Its label sits in the description column and its amount in
    // the cost column, which is exactly the shape that doubles a band's cost if
    // it is read as an asset.
    const subtotal: Cell[] = [];
    subtotal[COL.description] = `Total ${titleCase(band)}`;
    subtotal[COL.originalCost] = round2(bandTotal);
    rows.push(subtotal);
    rows.push(blank());
  });

  const grand: Cell[] = [];
  grand[COL.description] = 'Grand Total';
  grand[COL.originalCost] = 'see attached';
  rows.push(grand);
  rows.push(blank());
  rows.push(['Report generated by Sage Fixed Assets — Depreciation 2026.1 on 01/14/2027']);
  rows.push(['Page 1 of 1']);

  return rows;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function titleCase(band: string): string {
  return band
    .toLowerCase()
    .split(' ')
    .map((word) => (word === '&' ? '&' : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

/**
 * A second sheet holding this season's additions, and a third holding notes.
 *
 * Both are ordinary: a register is a workbook, not a table, and the mapping has
 * to decide which sheets are assets. The additions sheet repeats assets that are
 * already on the detail sheet — including it as well would double them, which is
 * the mistake a mapping is there to prevent.
 */
export function additionsMatrix(): Cell[][] {
  return [
    ['2027 ADDITIONS — SUBSET OF DETAIL, DO NOT DOUBLE COUNT'],
    [],
    ['Asset #', 'Description', 'In Service', 'Cost'],
    ['M-1140', 'CNC MILL, HAAS VF-4SS', new Date(2026, 8, 14), 51_200],
    ['C-1092', 'DELL POWEREDGE R750 SERVER', new Date(2026, 10, 2), 14_800],
  ];
}

export function notesMatrix(): Cell[][] {
  return [
    ['Notes'],
    [],
    ['Insurance schedule updated 11/2026.'],
    ['Katy warehouse lease expires 03/2028 — leasehold improvements amortized to that date.'],
    ['Vehicles are titled and taxed separately; confirm before rendering.'],
  ];
}

export const MESSY_REGISTER_SHEETS = {
  detail: 'FA Detail',
  additions: '2027 Additions',
  notes: 'Notes',
} as const;

export function messyRegisterWorkbook(): ParsedWorkbook {
  const build = (name: string, matrix: Cell[][]) => ({
    name,
    matrix: matrix as unknown[][],
    rowCount: matrix.length,
    colCount: matrix.reduce((max, row) => Math.max(max, row.length), 0),
  });
  return {
    sheets: [
      build(MESSY_REGISTER_SHEETS.detail, messyRegisterMatrix()),
      build(MESSY_REGISTER_SHEETS.additions, additionsMatrix()),
      build(MESSY_REGISTER_SHEETS.notes, notesMatrix()),
    ],
  };
}

/**
 * The mapping a competent reviewer would confirm for this workbook: the detail
 * sheet in, the additions sheet out (its rows are already on the detail sheet),
 * the notes sheet out.
 */
export const MESSY_REGISTER_MAPPING: FarMapping = {
  sheets: [
    {
      sheetName: MESSY_REGISTER_SHEETS.detail,
      include: true,
      headerRow: MESSY_REGISTER_FACTS.headerRow,
      categoryFromBands: true,
      columns: [
        { index: COL.assetTag, field: 'assetTag' },
        { index: COL.description, field: 'description' },
        { index: COL.location, field: 'location' },
        { index: COL.inServiceDate, field: 'inServiceDate' },
        { index: COL.originalCost, field: 'originalCost' },
        { index: COL.accumulatedDepreciation, field: 'accumulatedDepreciation' },
        { index: COL.netBookValue, field: 'netBookValue' },
        { index: COL.usefulLife, field: 'usefulLife' },
        { index: COL.disposalIndicator, field: 'disposalIndicator' },
      ],
    },
    {
      sheetName: MESSY_REGISTER_SHEETS.additions,
      include: false,
      headerRow: 2,
      categoryFromBands: false,
      columns: [],
    },
    {
      sheetName: MESSY_REGISTER_SHEETS.notes,
      include: false,
      headerRow: null,
      categoryFromBands: false,
      columns: [],
    },
  ],
};

/**
 * The same register as a real .xlsx, for driving the whole pipeline — upload,
 * mapping proposal, confirm — rather than only the normalizer. The unit test
 * and the live rehearsal then disagree about nothing, because they are reading
 * the same rows.
 */
export function messyRegisterXlsx(): Uint8Array {
  const book = XLSX.utils.book_new();
  const add = (name: string, matrix: Cell[][]) =>
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(matrix), name);
  add(MESSY_REGISTER_SHEETS.detail, messyRegisterMatrix());
  add(MESSY_REGISTER_SHEETS.additions, additionsMatrix());
  add(MESSY_REGISTER_SHEETS.notes, notesMatrix());
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}
