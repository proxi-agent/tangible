import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { FarMapping } from '@tangible/types';
import { applyMapping } from './normalize.js';
import { clampToUsedRange, detectHeaderRow, parseWorkbook, summarizeWorkbook } from './parse.js';
import { dateValue, numberValue } from './values.js';

/** Build a real xlsx in memory so the test exercises the same reader as production. */
function workbookFrom(sheets: Record<string, unknown[][]>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), name);
  }
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

// The shape accountants actually send: a title row, headers, section bands with
// the category carried by position, subtotals, parenthesized negatives, money
// as text, dates as dates, and a year-only column.
const MESSY_SHEET: unknown[][] = [
  ['Acme Manufacturing — Fixed Asset Register', null, null, null, null],
  [null, null, null, null, null],
  ['Asset #', 'Description', 'Acquired', 'Cost', 'Status'],
  ['Machinery & Equipment', null, null, null, null],
  ['M-001', 'CNC lathe', new Date(2019, 0, 15), '$125,000.00', null],
  ['M-002', 'Forklift', new Date(2021, 5, 1), 48000, 'Sold 2024'],
  [null, 'Subtotal', null, 173000, null],
  ['Computers', null, null, null, null],
  ['C-101', 'Dell workstation x4', 2022, '(1,200)', null],
  ['C-102', 'File server', '3/9/2023', 18500, null],
  [null, null, null, null, null],
  ['Grand Total', null, null, 190300, null],
];

const MAPPING: FarMapping = {
  sheets: [
    {
      sheetName: 'Register',
      include: true,
      headerRow: 2,
      categoryFromBands: true,
      columns: [
        { index: 0, field: 'assetTag' },
        { index: 1, field: 'description' },
        { index: 2, field: 'acquisitionDate' },
        { index: 3, field: 'originalCost' },
        { index: 4, field: 'disposalIndicator' },
      ],
    },
    {
      sheetName: 'Summary',
      include: false,
      headerRow: null,
      categoryFromBands: false,
      columns: [],
    },
  ],
};

describe('parseWorkbook + applyMapping', () => {
  const parsed = parseWorkbook(
    workbookFrom({ Register: MESSY_SHEET, Summary: [['Totals'], ['whatever', 1]] }),
  );

  it('finds the header row past the title', () => {
    const register = parsed.sheets.find((s) => s.name === 'Register');
    expect(register).toBeDefined();
    expect(detectHeaderRow(register!.matrix)).toBe(2);
  });

  it('summarizes with a bounded string preview', () => {
    const summary = summarizeWorkbook(parsed).find((s) => s.name === 'Register');
    expect(summary?.detectedHeaderRow).toBe(2);
    expect(summary?.preview[2]).toEqual(['Asset #', 'Description', 'Acquired', 'Cost', 'Status']);
    // Date cells preview as ISO dates, not serials or locale strings.
    expect(summary?.preview[4]?.[2]).toBe('2019-01-15');
  });

  it('normalizes assets, assigns band categories, and skips totals', () => {
    const { assets, skipped } = applyMapping(parsed, MAPPING);

    expect(assets).toHaveLength(4);
    const [lathe, forklift, dell, server] = assets;

    expect(lathe?.category).toBe('Machinery & Equipment');
    expect(lathe?.originalCost).toBe(125000);
    expect(lathe?.acquisitionDate).toBe('2019-01-15');
    expect(lathe?.acquisitionYear).toBe(2019);
    expect(lathe?.isDisposed).toBe(false);

    expect(forklift?.isDisposed).toBe(true);

    expect(dell?.category).toBe('Computers');
    // Year-only acquisition and a parenthesized negative both survive.
    expect(dell?.acquisitionYear).toBe(2022);
    expect(dell?.acquisitionDate).toBeNull();
    expect(dell?.originalCost).toBe(-1200);
    expect(dell?.warnings).toContain('negative cost — credit or adjustment row?');

    expect(server?.acquisitionDate).toBe('2023-03-09');

    const reasons = skipped.map((s) => s.reason);
    expect(reasons.some((r) => r.includes('section header'))).toBe(true);
    expect(reasons.filter((r) => r === 'subtotal/total row')).toHaveLength(2);
    // The excluded Summary sheet contributes nothing at all.
    expect(assets.every((a) => a.sourceSheet === 'Register')).toBe(true);
  });

  it('records a missing sheet instead of throwing', () => {
    const { skipped } = applyMapping(parsed, {
      sheets: [
        {
          sheetName: 'Nope',
          include: true,
          headerRow: 0,
          categoryFromBands: false,
          columns: [{ index: 0, field: 'description' }],
        },
      ],
    });
    expect(skipped[0]?.reason).toContain('not in the workbook');
  });
});

describe('value parsers', () => {
  it('reads accounting-format numbers', () => {
    expect(numberValue('$1,234.56')).toBe(1234.56);
    expect(numberValue('(2,000)')).toBe(-2000);
    expect(numberValue('')).toBeNull();
    expect(numberValue('n/a')).toBeNull();
  });

  // A comma means opposite things on either side of the Atlantic, and a
  // European subsidiary's register read as US grouping is a 100x error in the
  // cost column with nothing on screen to suggest it.
  it('reads European and space-grouped money without a 100x error', () => {
    expect(numberValue('1.234,56')).toBe(1234.56);
    expect(numberValue('12,34')).toBe(12.34);
    expect(numberValue('1 200,50')).toBe(1200.5);
    expect(numberValue('1.234.567,89')).toBe(1234567.89);
    // Three digits after a lone comma stays US grouping — the common case here.
    expect(numberValue('1,234')).toBe(1234);
    expect(numberValue('1,234,567')).toBe(1234567);
  });

  it('reads signs written the way ERP exports write them', () => {
    expect(numberValue('$ (1,200.00)')).toBe(-1200);
    expect(numberValue('1200-')).toBe(-1200); // SAP trailing minus
    expect(numberValue('-1,200.00')).toBe(-1200);
    expect(numberValue('\u22121,200.00')).toBe(-1200); // typographic minus
    expect(numberValue('\u2013500')).toBe(-500); // en dash
  });

  it('reads the date shapes registers use', () => {
    expect(dateValue('3/9/2023')).toEqual({ date: '2023-03-09', year: 2023 });
    expect(dateValue('FY20').year).toBe(2020);
    expect(dateValue(2019)).toEqual({ date: null, year: 2019 });
    expect(dateValue(43480).date).toBeNull(); // bare serial: refuse to guess
  });

  /**
   * A spelled-out month is the one date shape that carries its own order, which
   * is why day-first is safe to read here and nowhere else: "14-Mar-2020" has
   * no second reading, while "14-03-2020" has two. Printed depreciation
   * schedules — AssetKeeper, Sage, most of what arrives as a scan — write dates
   * this way, and before this they read as no date at all on every row.
   */
  it('reads a month written out, in whichever order it was written', () => {
    expect(dateValue('14-Mar-2020')).toEqual({ date: '2020-03-14', year: 2020 });
    expect(dateValue('Mar 14, 2020')).toEqual({ date: '2020-03-14', year: 2020 });
    expect(dateValue('14 March 2020')).toEqual({ date: '2020-03-14', year: 2020 });
    expect(dateValue('2020-Mar-14')).toEqual({ date: '2020-03-14', year: 2020 });
    expect(dateValue('01-SEP-99')).toEqual({ date: '1999-09-01', year: 1999 });
    expect(dateValue('Sept. 3, 2021')).toEqual({ date: '2021-09-03', year: 2021 });
  });

  /**
   * A month and a year with no day is the same fact "FY20" carries, and gets
   * the same answer: a year, and no date. "Mar-20" is refused because it is
   * either March 2020 or the twentieth of March, and nothing in the cell says
   * which — the ambiguity the m/d/y rule exists to avoid, arriving by another
   * door.
   */
  it('takes a year from a month-and-year, and refuses a month and a bare number', () => {
    expect(dateValue('Mar-2020')).toEqual({ date: null, year: 2020 });
    expect(dateValue('March 2020')).toEqual({ date: null, year: 2020 });
    expect(dateValue('Mar-20')).toEqual({ date: null, year: null });
    expect(dateValue('Mar')).toEqual({ date: null, year: null });
    expect(dateValue('31-Feb-2020')).toEqual({ date: null, year: null });
    expect(dateValue('Machine, 3 ton')).toEqual({ date: null, year: null });
  });

  // An impossible date is either a Postgres insert failure or a JavaScript
  // silent roll-forward to the first of the next month. Neither belongs in a
  // filing, so it reads as no date at all.
  it('refuses dates that do not exist', () => {
    expect(dateValue('6/31/2021')).toEqual({ date: null, year: null });
    expect(dateValue('2023-13-05')).toEqual({ date: null, year: null });
    expect(dateValue('2023-02-30')).toEqual({ date: null, year: null });
    expect(dateValue('2023-00-00')).toEqual({ date: null, year: null });
    expect(dateValue('2024-02-29').date).toBe('2024-02-29'); // a real leap day
  });
});

describe('subtotal and section-band detection', () => {
  const columns = [
    { index: 0, field: 'assetTag' as const },
    { index: 1, field: 'description' as const },
    { index: 2, field: 'acquisitionDate' as const },
    { index: 3, field: 'originalCost' as const },
  ];
  const mappingFor = (sheetName: string, categoryFromBands = true): FarMapping => ({
    sheets: [{ sheetName, include: true, headerRow: 0, categoryFromBands, columns }],
  });

  it('keeps assets whose text merely reads like a total', () => {
    const parsed = parseWorkbook(
      workbookFrom({
        S: [
          ['Tag', 'Description', 'Acquired', 'Cost'],
          ['M-1', 'Total Station Leica TS16', new Date(2021, 3, 2), 18500],
          ['M-2', 'Grand Total Systems controller', new Date(2022, 1, 9), 7400],
        ],
      }),
    );
    const { assets } = applyMapping(parsed, mappingFor('S'));
    expect(assets.map((a) => a.description)).toEqual([
      'Total Station Leica TS16',
      'Grand Total Systems controller',
    ]);
  });

  it('skips subtotals written with the label last', () => {
    const parsed = parseWorkbook(
      workbookFrom({
        S: [
          ['Tag', 'Description', 'Acquired', 'Cost'],
          ['M-1', 'Lathe', new Date(2019, 0, 15), 25000],
          [null, 'Machinery & Equipment Total', null, 25000],
        ],
      }),
    );
    const { assets, skipped } = applyMapping(parsed, mappingFor('S'));
    expect(assets).toHaveLength(1);
    expect(skipped.some((s) => s.row === 2 && s.reason === 'subtotal/total row')).toBe(true);
  });

  it('skips a subtotal whose label sits in an unmapped column', () => {
    const parsed = parseWorkbook(
      workbookFrom({
        S: [
          ['Label', 'Tag', 'Description', 'Cost'],
          [null, 'M-1', 'Lathe', 25000],
          ['Subtotal', null, null, 25000],
        ],
      }),
    );
    const { assets } = applyMapping(parsed, {
      sheets: [
        {
          sheetName: 'S',
          include: true,
          headerRow: 0,
          categoryFromBands: false,
          columns: [
            { index: 1, field: 'assetTag' },
            { index: 2, field: 'description' },
            { index: 3, field: 'originalCost' },
          ],
        },
      ],
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]?.originalCost).toBe(25000);
  });

  // A cost-less line item is a real asset with a gap, not a section label. Read
  // as a band it would vanish AND rename the category of every row beneath it.
  it('keeps a sparse asset row instead of reading it as a band', () => {
    const parsed = parseWorkbook(
      workbookFrom({
        S: [
          ['Tag', 'Description', 'Acquired', 'Cost'],
          ['Machinery & Equipment', null, null, null],
          [null, 'Spare die set (no cost recorded)', null, null],
          ['M-2', 'Surface grinder', new Date(2020, 4, 4), 44000],
        ],
      }),
    );
    const { assets } = applyMapping(parsed, mappingFor('S'));
    expect(assets).toHaveLength(2);
    expect(assets[0]?.description).toBe('Spare die set (no cost recorded)');
    expect(assets[0]?.warnings).toContain('no cost value');
    // The band above still applies; the sparse row did not become the category.
    expect(assets.map((a) => a.category)).toEqual([
      'Machinery & Equipment',
      'Machinery & Equipment',
    ]);
  });

  it('reports rows above the header row rather than dropping them silently', () => {
    const parsed = parseWorkbook(
      workbookFrom({
        S: [
          ['Acme Machining — Register', null, null, null],
          ['As of 12/31/2026', null, null, null],
          ['Tag', 'Description', 'Acquired', 'Cost'],
          ['M-1', 'Lathe', new Date(2019, 0, 15), 25000],
        ],
      }),
    );
    const { assets, skipped } = applyMapping(parsed, {
      sheets: [{ sheetName: 'S', include: true, headerRow: 2, categoryFromBands: false, columns }],
    });
    expect(assets).toHaveLength(1);
    expect(skipped.some((s) => /2 non-empty rows above the header/.test(s.reason))).toBe(true);
  });
});

describe('delimited text input', () => {
  const csv = (text: string) => new TextEncoder().encode(text);

  // SheetJS runs a fuzzy date parse and numeric coercion over CSV fields, which
  // rewrites a Sage useful life of "10/06" into a 2001 date and an asset tag of
  // "00123" into 123. Text stays text; values.ts does the interpreting.
  it('keeps identifiers and lives as written', () => {
    const parsed = parseWorkbook(
      csv('Tag,Description,Life,Cost\n00123,Lathe,10/06,"1,234.56"\n5E10,Mill,05/00,2500\n'),
    );
    const { assets } = applyMapping(parsed, {
      sheets: [
        {
          sheetName: parsed.sheets[0]!.name,
          include: true,
          headerRow: 0,
          categoryFromBands: false,
          columns: [
            { index: 0, field: 'assetTag' },
            { index: 1, field: 'description' },
            { index: 2, field: 'usefulLife' },
            { index: 3, field: 'originalCost' },
          ],
        },
      ],
    });
    expect(assets.map((a) => a.assetTag)).toEqual(['00123', '5E10']);
    expect(assets.map((a) => a.usefulLife)).toEqual(['10/06', '05/00']);
    expect(assets[0]?.originalCost).toBe(1234.56);
  });
});

describe('sheet reading limits', () => {
  // Excel stamps the stored range as far as any formatting reaches, so a
  // hand-built register can advertise thousands of empty columns. Materializing
  // the advertised range is how a 200-row file becomes an out-of-memory crash.
  // (Tested on the worksheet directly: writing a ballooned workbook would
  // materialize the same range on the way out.)
  it('reads the real extent, not the advertised one', () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Tag', 'Description', 'Cost'],
      ['M-1', 'Lathe', 25000],
    ]);
    sheet['!ref'] = 'A1:XFD1048576';

    clampToUsedRange(sheet, 'Ballooned');

    expect(sheet['!ref']).toBe('A1:C2');
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    expect(matrix).toHaveLength(2);
    expect(matrix[0]).toHaveLength(3);
  });

  it('refuses a sheet too large to hold in memory rather than crashing', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['Tag']]);
    // One real cell far out in both directions: 3M rows x 2 columns of extent.
    sheet.A3000000 = { t: 's', v: 'stray' };
    sheet.B3000000 = { t: 's', v: 'stray' };
    expect(() => clampToUsedRange(sheet, 'Huge')).toThrow(/beyond what this reader will load/);
  });
});

describe('detectHeaderRow', () => {
  // A header carries labels and no values; the first asset row carries several
  // text fields and a number. The number is what decides it.
  it('prefers a sparse header over a wide data row', () => {
    const matrix: unknown[][] = [
      ['Tag', 'Description', 'Cost'],
      ['M-1', 'CNC lathe', 'Machinery', 'Houston Plant', 'Ops', 'Haas', 'SL', 185000],
      ['M-2', 'Vertical mill', 'Machinery', 'Houston Plant', 'Ops', 'Bridgeport', 'SL', 42500],
    ];
    expect(detectHeaderRow(matrix)).toBe(0);
  });
});

/**
 * A report that was printed rather than exported repeats its masthead every
 * twenty rows, and those repeats land in the middle of the data. Nothing else
 * in this module catches them: they carry no cost, so the totals still foot;
 * they carry text in the tag column, so the subtotal rule passes them; they
 * fill several columns, so the band-label rule passes them too. Before this
 * they arrived as costless assets — real enough to be counted, empty enough to
 * be invisible in any check that measures money.
 */
describe('page headers repeated inside the data', () => {
  const PRINTED: unknown[][] = [
    ['HALCYON LOGISTICS, LLC', null, null, 'PAGE 1'],
    ['ASSET DEPRECIATION SCHEDULE', null, null, 'RUN 01/09/2027'],
    ['UNIT', 'DESCRIPTION', 'ACQUIRED', 'COST'],
    ['0104', 'Yard tractor', '14-Mar-2020', '84,000.00'],
    ['0105', 'Dock leveller', '02-Jun-2021', '12,500.00'],
    // The page breaks here, and the whole masthead comes round again — with a
    // different page number, which is the only thing about it that changes.
    ['\fHALCYON LOGISTICS, LLC', null, null, 'PAGE 2'],
    ['\fASSET DEPRECIATION SCHEDULE', null, null, 'RUN 01/09/2027'],
    ['\fUNIT', 'DESCRIPTION', 'ACQUIRED', 'COST'],
    ['0106', 'Reach truck', '18-Sep-2022', '31,750.00'],
  ];

  const PRINTED_MAPPING: FarMapping = {
    sheets: [
      {
        sheetName: 'Sheet1',
        include: true,
        headerRow: 2,
        categoryFromBands: false,
        columns: [
          { index: 0, field: 'assetTag' },
          { index: 1, field: 'description' },
          { index: 2, field: 'acquisitionDate' },
          { index: 3, field: 'originalCost' },
        ],
      },
    ],
  };

  it('reads three assets from a nine-row printout', () => {
    const output = applyMapping(parseWorkbook(workbookFrom({ Sheet1: PRINTED })), PRINTED_MAPPING);
    expect(output.assets.map((asset) => asset.assetTag)).toEqual(['0104', '0105', '0106']);
    expect(output.skipped.filter((row) => row.reason.includes('page header'))).toHaveLength(3);
  });

  /**
   * The rule is made of the mapping's own statement about the file: these lines
   * were placed at or above the header row, which is where a mapping says
   * "not data". With no header row there is no such statement, and a rule this
   * strong must not run on an assumption.
   */
  it('does not run when the mapping names no header row', () => {
    const headerless = { ...PRINTED_MAPPING.sheets[0]!, headerRow: null };
    const output = applyMapping(parseWorkbook(workbookFrom({ Sheet1: PRINTED })), {
      sheets: [headerless],
    });
    expect(output.skipped.filter((row) => row.reason.includes('page header'))).toHaveLength(0);
  });

  /**
   * Position is part of the identity. An asset whose description happens to
   * repeat the report's title is still an asset, because the title sat in the
   * tag column and this does not.
   */
  it('keeps a row that only shares the masthead\u2019s wording', () => {
    const shifted = [...PRINTED, ['0107', 'ASSET DEPRECIATION SCHEDULE', '01-Feb-2023', '900.00']];
    const output = applyMapping(parseWorkbook(workbookFrom({ Sheet1: shifted })), PRINTED_MAPPING);
    expect(output.assets.map((asset) => asset.assetTag)).toEqual(['0104', '0105', '0106', '0107']);
  });

  /**
   * Digits are normalized away so that two page numbers match, which would let
   * a bare year above the header swallow every row of a year column. A masthead
   * line has to carry a letter before it is allowed to match anything.
   */
  it('does not let a numeric title line match a numeric data row', () => {
    const numeric: unknown[][] = [
      ['2026', null, null, null],
      ['Unit', 'Description', 'Year', 'Cost'],
      ['2027', null, null, null],
      ['0104', 'Yard tractor', 2020, '84,000.00'],
    ];
    const mapping: FarMapping = {
      sheets: [
        {
          sheetName: 'Sheet1',
          include: true,
          headerRow: 1,
          categoryFromBands: false,
          columns: [
            { index: 0, field: 'assetTag' },
            { index: 1, field: 'description' },
            { index: 2, field: 'acquisitionYear' },
            { index: 3, field: 'originalCost' },
          ],
        },
      ],
    };
    const output = applyMapping(parseWorkbook(workbookFrom({ Sheet1: numeric })), mapping);
    expect(output.skipped.filter((row) => row.reason.includes('page header'))).toHaveLength(0);
    expect(output.assets.map((asset) => asset.assetTag)).toContain('0104');
  });
});
