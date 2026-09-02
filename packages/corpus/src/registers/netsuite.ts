import { business, site, totalCost } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { delimited, type Cell } from '../write.js';
import { plain, slashDate } from './format.js';

/**
 * A saved search, exported by somebody in accounting who ticked every column.
 *
 * The shape web-app exports actually take: a UTF-8 byte order mark so Excel
 * shows the accents, every field quoted whether it needs it or not, CRLF line
 * endings, and internal ids next to the human ones. Two things in here are the
 * reason it is worth having.
 *
 * The first is the location column, which is a hierarchy path rather than a
 * place — `Coastal Provisions Co. : FL : Tampa DC`. Situs decides which
 * district a return goes to, and no rule about the last segment survives
 * contact with a company that renames a subsidiary.
 *
 * The second is the inventory. Two rows carry more cost than the other
 * eighty-five together, and in Florida inventory is exempt outright. A reader
 * that maps this file correctly and stops there has produced a return that
 * overstates the account by more than a million dollars — which is not a
 * mapping error, and is exactly why the mapping is not the last question asked.
 */
export function netsuiteEntry(): CorpusEntry {
  const one = business('coastal');
  const path = (siteId: string): string =>
    `Coastal Provisions Co. : ${site(one, siteId).state} : ${site(one, siteId).label}`;

  const rows: Cell[][] = [
    [
      'Internal ID',
      'Asset ID',
      'Alternate Asset Number',
      'Asset Description',
      'Asset Type',
      'Purchase Date',
      'Original Cost',
      'Current Net Book Value',
      'Depreciation Method',
      'Asset Lifetime',
      'Subsidiary',
      'Location',
      'Status',
    ],
    ...one.assets.map((asset, index) => [
      String(4100 + index),
      asset.tag,
      `NS-${String(index + 1).padStart(4, '0')}`,
      describe(asset.description, index),
      asset.category,
      slashDate(asset.acquired),
      plain(asset.cost),
      plain(Math.max(0, asset.cost - asset.accumulated)),
      'Straight-line',
      asset.life * 12,
      'Coastal Provisions Co.',
      path(asset.siteId),
      index === 11 || index === 63 ? 'Disposed' : 'Depreciating',
    ]),
  ];

  return {
    id: 'coastal-netsuite',
    filename: 'FAM_Asset_Register_2026-12-31.csv',
    kind: 'register',
    format: 'csv',
    businessId: one.id,
    source: 'NetSuite — Fixed Assets saved search',
    jurisdictions: ['FL — Hillsborough', 'FL — Miami-Dade'],
    premise:
      'The register as a web app exports it: BOM, CRLF, everything quoted, and a location column that is a hierarchy path rather than an address.',
    traps: [
      'Location is a hierarchy path — "Coastal Provisions Co. : FL : Tampa DC" — so the site has to be read out of the middle of a string.',
      'One description carries a comma inside its quotes and another carries a line break, so a naive split by comma or by line loses rows.',
      'Two inventory rows carry more cost than every other asset together, and Florida exempts inventory outright.',
      'The status column, not the cost column, is what says an asset is gone.',
    ],
    expectation: {
      autopilot: 'clears',
      because:
        'Nothing about the columns is ambiguous. What this file needs a person for comes after the mapping, not during it.',
    },
    mapping: {
      sheets: [
        {
          sheetName: 'Sheet1',
          include: true,
          headerRow: 0,
          categoryFromBands: false,
          columns: [
            { index: 1, field: 'assetTag' },
            { index: 3, field: 'description' },
            { index: 4, field: 'category' },
            { index: 5, field: 'acquisitionDate' },
            { index: 6, field: 'originalCost' },
            { index: 7, field: 'netBookValue' },
            { index: 8, field: 'depreciationMethod' },
            { index: 11, field: 'location' },
            { index: 12, field: 'disposalIndicator' },
          ],
        },
      ],
    },
    truth: {
      assetCount: one.assets.length,
      totalCost: totalCost(one.assets),
      includedSheets: ['Sheet1'],
    },
    build: () =>
      delimited(rows, {
        delimiter: ',',
        newline: '\r\n',
        encoding: 'utf-8',
        bom: true,
        quoteAll: true,
      }),
  };
}

/** Two descriptions carry what a CSV reader is worst at: a comma, and a newline. */
function describe(description: string, index: number): string {
  if (index === 4) return `${description}, 240V single phase`;
  if (index === 30) return `${description}\n(replaces WH-01021, scrapped)`;
  return description;
}
