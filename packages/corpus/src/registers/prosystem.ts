import { business, site, totalCost } from '../business.js';
import type { CorpusAsset, CorpusEntry } from '../types.js';
import { spreadsheet, type Cell } from '../write.js';
import { grouped, shortDate } from './format.js';

/**
 * A tax package's depreciation detail, printed by class.
 *
 * This is the layout the firm's own software produces, so it is the layout a
 * client whose accountant already does their depreciation will send. Category
 * is not a column: it is a banner row above each block, closed by a subtotal
 * line, and the only way to know a row is a fan-coil unit rather than a chair
 * is to remember which banner you are underneath. Getting that wrong does not
 * corrupt the cost — it silently files the asset on the wrong schedule, at the
 * wrong life, for the wrong value.
 *
 * The header is two rows deep because the report writer wrapped it, which makes
 * the top row look like headers and the second row like more headers. Only one
 * of them has a cell over every mapped column.
 */
export function prosystemEntry(): CorpusEntry {
  const one = business('lonestar');
  const classes = [...new Set(one.assets.map((asset) => asset.category))];

  const rows: Cell[][] = [
    ['Lone Star Dental Partners, PLLC'],
    ['Depreciation Detail Report — Federal'],
    ['For the year ended December 31, 2026            Printed 01/14/2027'],
    ['', '', '', '', 'Date', 'Original', '', '', 'Accumulated'],
    ['Asset ID', 'Description', 'Location', 'Method', 'Acquired', 'Cost', 'Life', 'Conv', 'Depr'],
  ];

  for (const category of classes) {
    const block = one.assets.filter((asset) => asset.category === category);
    rows.push([]);
    rows.push(['', category.toUpperCase()]);
    for (const asset of block) rows.push(line(asset, one));
    rows.push([
      '',
      `Total ${category}`,
      '',
      '',
      '',
      grouped(totalCost(block)),
      '',
      '',
      grouped(block.reduce((sum, asset) => sum + asset.accumulated, 0)),
    ]);
  }
  rows.push([]);
  rows.push(['', 'Grand Total — All Classes', '', '', '', grouped(totalCost(one.assets))]);

  return {
    id: 'lonestar-prosystem',
    filename: 'LSDP Depreciation Detail 12.31.2026.xlsx',
    kind: 'register',
    format: 'xlsx',
    businessId: one.id,
    source: 'CCH ProSystem fx Fixed Assets — depreciation detail, exported to Excel',
    jurisdictions: ['TX — Harris', 'TX — Fort Bend', 'TX — Collin', 'TX — Travis'],
    premise:
      "A tax preparer's own depreciation detail: classes as banner rows, a subtotal closing each one, and a two-row wrapped header.",
    traps: [
      'Class is a banner row, not a column — a reader that ignores it files dental chairs as furniture.',
      'Every class closes with a subtotal line that carries a cost and must not become an asset.',
      'The header wraps across two rows; only the lower one covers every mapped column.',
      'Four offices in four appraisal districts share one file, so this is four returns, not one.',
      'Dates are m/d/yy, which is unambiguous for month and day and a guess for the century.',
    ],
    expectation: {
      autopilot: 'clears',
      because:
        'Bands, subtotals and a printed grand total are exactly what the checks are built to survive: the mapped costs foot, and the class of every row is decided by the banner above it.',
    },
    mapping: {
      sheets: [
        {
          sheetName: 'Detail',
          include: true,
          headerRow: 4,
          categoryFromBands: true,
          columns: [
            { index: 0, field: 'assetTag' },
            { index: 1, field: 'description' },
            { index: 2, field: 'location' },
            { index: 3, field: 'depreciationMethod' },
            { index: 4, field: 'acquisitionDate' },
            { index: 5, field: 'originalCost' },
            { index: 6, field: 'usefulLife' },
            { index: 8, field: 'accumulatedDepreciation' },
          ],
        },
      ],
    },
    truth: {
      assetCount: one.assets.length,
      totalCost: totalCost(one.assets),
      includedSheets: ['Detail'],
    },
    build: () => spreadsheet([{ name: 'Detail', matrix: rows }], 'xlsx'),
  };
}

function line(asset: CorpusAsset, one: ReturnType<typeof business>): Cell[] {
  return [
    asset.tag,
    asset.description,
    site(one, asset.siteId).label,
    'MACRS 200DB',
    shortDate(asset.acquired),
    grouped(asset.cost),
    asset.life,
    'HY',
    grouped(asset.accumulated),
  ];
}
