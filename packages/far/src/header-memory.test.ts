import { describe, expect, it } from 'vitest';
import type { FarMapping, SheetSummary } from '@tangible/types';
import {
  harvestHeaderDecisions,
  headerFingerprint,
  headerFingerprints,
  headerHints,
  headersFromSummaries,
  headersFromWorkbook,
  memoryDisagreements,
  type HeaderMemoryRecord,
  type SheetHeaders,
} from './header-memory.js';

const sheet = (over: Partial<FarMapping['sheets'][number]> = {}): FarMapping['sheets'][number] => ({
  sheetName: 'Register',
  include: true,
  headerRow: 0,
  columns: [
    { index: 0, field: 'description' },
    { index: 1, field: 'originalCost' },
  ],
  categoryFromBands: false,
  ...over,
});

const headers = (over: Partial<SheetHeaders> = {}): SheetHeaders => ({
  sheetName: 'Register',
  headers: ['Asset Description', 'Acq. Cost'],
  ...over,
});

const record = (over: Partial<HeaderMemoryRecord> = {}): HeaderMemoryRecord => ({
  fingerprint: 'acq cost',
  sampleHeader: 'Acq. Cost',
  field: 'originalCost',
  confirmations: 9,
  conflicted: false,
  conflictingField: null,
  ...over,
});

describe('headerFingerprint', () => {
  it('folds case, punctuation and spacing', () => {
    const key = headerFingerprint('Acq. Cost');
    expect(key).toBe('acq cost');
    expect(headerFingerprint('ACQ COST')).toBe(key);
    expect(headerFingerprint('  acq   cost  ')).toBe(key);
  });

  it('drops bare numbers, so a year on the header does not split the key', () => {
    expect(headerFingerprint('Cost (2024)')).toBe('cost');
    expect(headerFingerprint('Cost 2023')).toBe('cost');
  });

  it('keeps numbers that are part of a word', () => {
    expect(headerFingerprint('FY24 Cost')).toBe('fy24 cost');
  });

  it('reads an ampersand as a word', () => {
    expect(headerFingerprint('Furniture & Fixtures')).toBe('furniture and fixtures');
  });

  it('does not expand abbreviations', () => {
    expect(headerFingerprint('Acq Cost')).not.toBe(headerFingerprint('Acquisition Cost'));
  });

  it('refuses what cannot carry a decision', () => {
    expect(headerFingerprint(null)).toBeNull();
    expect(headerFingerprint('')).toBeNull();
    expect(headerFingerprint('   ')).toBeNull();
    expect(headerFingerprint('42')).toBeNull();
    expect(headerFingerprint('A')).toBeNull();
  });
});

describe('harvestHeaderDecisions', () => {
  it('remembers the header a confirmed column was pointed at', () => {
    const decisions = harvestHeaderDecisions([headers()], { sheets: [sheet()] });
    expect(decisions).toEqual([
      { fingerprint: 'asset description', sampleHeader: 'Asset Description', field: 'description' },
      { fingerprint: 'acq cost', sampleHeader: 'Acq. Cost', field: 'originalCost' },
    ]);
  });

  it('learns nothing from an excluded sheet', () => {
    expect(harvestHeaderDecisions([headers()], { sheets: [sheet({ include: false })] })).toEqual([]);
  });

  it('learns nothing from a column left unmapped', () => {
    const mapping = { sheets: [sheet({ columns: [{ index: 1, field: null }] })] };
    expect(harvestHeaderDecisions([headers()], mapping)).toEqual([]);
  });

  it('learns nothing from a header the file itself contradicts', () => {
    // Two columns headed "Cost": one confirmed as original cost, one as NBV.
    const decisions = harvestHeaderDecisions(
      [headers({ headers: ['Cost', 'Cost', 'Description'] })],
      {
        sheets: [
          sheet({
            columns: [
              { index: 0, field: 'originalCost' },
              { index: 1, field: 'netBookValue' },
              { index: 2, field: 'description' },
            ],
          }),
        ],
      },
    );
    expect(decisions.map((d) => d.fingerprint)).toEqual(['description']);
  });

  it('is unbothered by the same header agreeing with itself twice', () => {
    const decisions = harvestHeaderDecisions([headers({ headers: ['Cost', 'COST'] })], {
      sheets: [
        sheet({
          columns: [
            { index: 0, field: 'originalCost' },
            { index: 1, field: 'originalCost' },
          ],
        }),
      ],
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.field).toBe('originalCost');
  });

  it('skips a sheet the mapping names and the file does not have', () => {
    expect(harvestHeaderDecisions([], { sheets: [sheet()] })).toEqual([]);
  });
});

describe('headersFromWorkbook', () => {
  const workbook = {
    sheets: [
      {
        name: 'Register',
        matrix: [
          ['Fixed Asset Register — 2026'],
          ['Asset Description', 'Acq. Cost'],
          ['Forklift', 42000],
        ],
        rowCount: 3,
        colCount: 2,
      },
    ],
  };

  it('reads the row the confirmed mapping named, not the first one', () => {
    expect(headersFromWorkbook(workbook, { sheets: [sheet({ headerRow: 1 })] })).toEqual([
      { sheetName: 'Register', headers: ['Asset Description', 'Acq. Cost'] },
    ]);
  });

  it('returns blanks for a headerless sheet rather than reading row 0', () => {
    expect(headersFromWorkbook(workbook, { sheets: [sheet({ headerRow: null })] })).toEqual([
      { sheetName: 'Register', headers: [null, null] },
    ]);
  });
});

describe('headersFromSummaries', () => {
  const summary: SheetSummary = {
    name: 'Register',
    rowCount: 3,
    colCount: 2,
    preview: [
      ['Fixed Asset Register — 2026', null],
      ['Asset Description', 'Acq. Cost'],
      ['Forklift', '42000'],
    ],
    detectedHeaderRow: 1,
  };

  it('falls back to the parser’s guess when nothing is mapped yet', () => {
    expect(headersFromSummaries([summary])).toEqual([
      { sheetName: 'Register', headers: ['Asset Description', 'Acq. Cost'] },
    ]);
  });

  it('prefers the mapping’s own header row', () => {
    expect(headersFromSummaries([summary], { sheets: [sheet({ headerRow: 2 })] })).toEqual([
      { sheetName: 'Register', headers: ['Forklift', '42000'] },
    ]);
  });
});

describe('headerHints', () => {
  it('names the column the remembered header sits in on this file', () => {
    const hints = headerHints([headers({ headers: ['Acq. Cost', 'Description'] })], [record()]);
    expect(hints).toEqual([
      {
        sheetName: 'Register',
        index: 0,
        header: 'Acq. Cost',
        field: 'originalCost',
        confirmations: 9,
        conflicted: false,
        conflictingField: null,
      },
    ]);
  });

  it('hints on a conflicted row too — the grid is where that is worth seeing', () => {
    const hints = headerHints(
      [headers()],
      [record({ conflicted: true, conflictingField: 'netBookValue' })],
    );
    expect(hints).toHaveLength(1);
    expect(hints[0]!.conflicted).toBe(true);
  });

  it('says nothing about a header nobody has settled', () => {
    expect(headerHints([headers({ headers: ['Widget Code'] })], [record()])).toEqual([]);
  });
});

describe('headerFingerprints', () => {
  it('is the distinct lookup key set', () => {
    expect(
      headerFingerprints([
        headers({ headers: ['Cost', 'COST', null, '7'] }),
        headers({ sheetName: 'Sheet2', headers: ['Description'] }),
      ]),
    ).toEqual(['cost', 'description']);
  });
});

describe('memoryDisagreements', () => {
  const hints = headerHints([headers()], [record()]);

  it('is silent when the proposal agrees', () => {
    expect(memoryDisagreements({ sheets: [sheet()] }, hints)).toEqual([]);
  });

  it('flags a proposal that points a settled header somewhere else', () => {
    const mapping = {
      sheets: [
        sheet({
          columns: [
            { index: 0, field: 'description' },
            { index: 1, field: 'netBookValue' },
          ],
        }),
      ],
    };
    expect(memoryDisagreements(mapping, hints).map((h) => h.index)).toEqual([1]);
  });

  it('flags a settled header the proposal left unmapped', () => {
    const mapping = {
      sheets: [
        sheet({
          columns: [
            { index: 0, field: 'description' },
            { index: 1, field: null },
          ],
        }),
      ],
    };
    expect(memoryDisagreements(mapping, hints)).toHaveLength(1);
  });

  it('says nothing about an excluded sheet', () => {
    const mapping = {
      sheets: [
        sheet({
          include: false,
          columns: [
            { index: 0, field: 'description' },
            { index: 1, field: 'netBookValue' },
          ],
        }),
      ],
    };
    expect(memoryDisagreements(mapping, hints)).toEqual([]);
  });

  it('does not assert a header reviewers have settled two ways', () => {
    const conflicted = headerHints(
      [headers()],
      [record({ conflicted: true, conflictingField: 'netBookValue' })],
    );
    const mapping = {
      sheets: [
        sheet({
          columns: [
            { index: 0, field: 'description' },
            { index: 1, field: 'netBookValue' },
          ],
        }),
      ],
    };
    expect(memoryDisagreements(mapping, conflicted)).toEqual([]);
  });
});
