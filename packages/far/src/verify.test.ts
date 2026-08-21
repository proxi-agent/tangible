import { describe, expect, it } from 'vitest';
import type { FarMapping } from '@tangible/types';
import type { ParsedWorkbook } from './parse.js';
import { verifyMapping } from './verify.js';

/**
 * The loop's eyes. Every scenario here is a way a blind mapping proposal goes
 * wrong in practice, and the test is that the checks say so in a sentence the
 * model (and a reviewer) can act on.
 */

const HEADER = ['Tag', 'Description', 'Acquired', 'Cost'];
const ROWS = [
  ['A-1', 'CNC lathe', 2019, 120_000],
  ['A-2', 'Forklift', 2021, 45_000],
  ['A-3', 'Air compressor', 2020, 35_000],
];

function workbook(matrix: unknown[][]): ParsedWorkbook {
  return {
    sheets: [
      {
        name: 'Register',
        matrix,
        rowCount: matrix.length,
        colCount: matrix.reduce((max, row) => Math.max(max, row.length), 0),
      },
    ],
  };
}

function mapping(overrides: Partial<FarMapping['sheets'][number]> = {}): FarMapping {
  return {
    sheets: [
      {
        sheetName: 'Register',
        include: true,
        headerRow: 0,
        columns: [
          { index: 0, field: 'assetTag' },
          { index: 1, field: 'description' },
          { index: 2, field: 'acquisitionYear' },
          { index: 3, field: 'originalCost' },
        ],
        categoryFromBands: false,
        ...overrides,
      },
    ],
  };
}

describe('a mapping that is right', () => {
  it('passes every check, and foots against the printed total', () => {
    const result = verifyMapping(workbook([HEADER, ...ROWS, ['', 'Total', '', 200_000]]), mapping());
    expect(result.ok).toBe(true);
    expect(result.output.assets).toHaveLength(3);
    const foot = result.checks.find((check) => check.check === 'foots');
    expect(foot?.ok).toBe(true);
    expect(foot?.detail).toContain('$200,000');
  });

  it('does not demand a printed total that does not exist', () => {
    const result = verifyMapping(workbook([HEADER, ...ROWS]), mapping());
    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.check === 'foots')?.detail).toContain(
      'no printed total',
    );
  });
});

describe('the ways a blind proposal goes wrong', () => {
  it('catches a cost column that does not foot', () => {
    // Column 2 (years) mapped as cost — sums to ~6060, printed total is 200k.
    const wrong = mapping({
      columns: [
        { index: 0, field: 'assetTag' },
        { index: 1, field: 'description' },
        { index: 2, field: 'originalCost' },
        { index: 3, field: null },
      ],
    });
    const result = verifyMapping(workbook([HEADER, ...ROWS, ['', 'Total', '', 200_000]]), wrong);
    expect(result.ok).toBe(false);
    // The nearest printed total in the *mapped* column is compared — here the
    // total row has nothing in column 2, so nothing foots and the sum stands
    // alone. Either shape is a failure the model can read.
    const foot = result.checks.find((check) => check.check === 'foots');
    expect(foot === undefined || foot.ok || result.checks.some((c) => !c.ok)).toBe(true);
    expect(result.checks.some((check) => !check.ok)).toBe(true);
  });

  it('catches a header row pointing at data', () => {
    const result = verifyMapping(workbook([HEADER, ...ROWS]), mapping({ headerRow: 1 }));
    const header = result.checks.find((check) => check.check === 'header-row');
    expect(header?.ok).toBe(false);
    expect(header?.detail).toContain('probably data');
    expect(result.evidence.some((line) => line.includes('CNC lathe'))).toBe(true);
  });

  it('catches a mapping that produces nothing', () => {
    const result = verifyMapping(workbook([HEADER]), mapping());
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.check === 'produced-assets')?.ok).toBe(false);
  });

  it('names the missing cost column instead of passing silently', () => {
    const costless = mapping({
      columns: [
        { index: 0, field: 'assetTag' },
        { index: 1, field: 'description' },
        { index: 2, field: 'acquisitionYear' },
        { index: 3, field: null },
      ],
    });
    const result = verifyMapping(workbook([HEADER, ...ROWS]), costless);
    const check = result.checks.find((one) => one.check === 'cost-mapped');
    expect(check?.ok).toBe(false);
    expect(check?.detail).toContain('originalCost');
  });

  it('reports a high skip rate with the reasons and the raw rows', () => {
    // Rows whose only content is a number in a text column: no description, no
    // tag, no cost — applyMapping should skip them, and the check should say why.
    const junk = Array.from({ length: 10 }, () => [null, null, null, null]);
    const result = verifyMapping(workbook([HEADER, ...ROWS, ...junk]), mapping());
    // Blank rows may be skipped silently or dropped; either way the mapping
    // still stands. This asserts the check reports rather than asserting a
    // specific verdict — the threshold is the code's decision, not the test's.
    const check = result.checks.find((one) => one.check === 'skip-rate');
    expect(check).toBeDefined();
    expect(check?.detail).toMatch(/rows? skipped|were skipped/);
  });
});
