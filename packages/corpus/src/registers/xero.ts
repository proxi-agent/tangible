import { business, site, totalCost } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { delimited, type Cell } from '../write.js';

/**
 * The file the whole unattended path exists for.
 *
 * Fourteen assets, one office, one sheet, ISO dates, numeric costs, headers a
 * five-year-old could map. Nothing in it is interesting, and that is the point:
 * a corpus made only of hard files quietly teaches that hard is normal, and a
 * safety bar with no file that clears it is not a bar, it is a wall.
 */
export function xeroEntry(): CorpusEntry {
  const one = business('brightline');
  const rows: Cell[][] = [
    [
      'Asset Number',
      'Asset Name',
      'Purchase Date',
      'Purchase Price',
      'Asset Type',
      'Depreciation Method',
      'Effective Life',
      'Location',
    ],
    ...one.assets.map((asset) => [
      asset.tag,
      asset.description,
      asset.acquired,
      asset.cost,
      asset.category,
      'Straight Line',
      asset.life,
      site(one, asset.siteId).label,
    ]),
  ];

  return {
    id: 'brightline-xero',
    filename: 'Brightline_Fixed_Assets_Export.csv',
    kind: 'register',
    format: 'csv',
    businessId: one.id,
    source: 'Xero — Fixed Assets export',
    jurisdictions: ['TX — Travis'],
    premise:
      'A small company, a clean export, and nothing for a person to decide. The file the autopilot should carry all the way to a report without anyone at the firm touching it.',
    traps: [],
    expectation: {
      autopilot: 'clears',
      because:
        'Every column is named, every cost is numeric, every date is ISO, and one sheet holds every row.',
    },
    mapping: {
      sheets: [
        {
          sheetName: 'Sheet1',
          include: true,
          headerRow: 0,
          categoryFromBands: false,
          columns: [
            { index: 0, field: 'assetTag' },
            { index: 1, field: 'description' },
            { index: 2, field: 'acquisitionDate' },
            { index: 3, field: 'originalCost' },
            { index: 4, field: 'category' },
            { index: 5, field: 'depreciationMethod' },
            { index: 6, field: 'usefulLife' },
            { index: 7, field: 'location' },
          ],
        },
      ],
    },
    truth: {
      assetCount: one.assets.length,
      totalCost: totalCost(one.assets),
      includedSheets: ['Sheet1'],
    },
    build: () => delimited(rows, { delimiter: ',', newline: '\n', encoding: 'utf-8' }),
  };
}
