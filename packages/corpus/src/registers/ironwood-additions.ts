import { acquiredIn, slashDate, usd } from './format.js';
import { business, totalCost } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { delimited, type Cell } from '../write.js';

/**
 * Additions land with the vendor's name on them, and vendors have accents.
 *
 * Assigned by position rather than by tag on purpose: the register's tags are
 * generated, and a lookup keyed on them would silently match nothing the day
 * they change — which is how a trap quietly stops being a trap.
 */
const VENDORS: readonly string[] = [
  'Müller Präzision GmbH',
  'Société Générale Outillage',
  'Nyström & Co.',
  'Müller Präzision GmbH',
];

/**
 * The additions listing, exported from a Windows desktop package.
 *
 * Two things about this file are worth having in the corpus, and only one of
 * them is a bug in anything.
 *
 * The encoding is the bug. This is CP-1252 — one byte per character, the way
 * every desktop accounting package on Windows has written text for thirty years
 * — and the parser decodes delimited text as UTF-8 and only as UTF-8. So
 * "Müller" arrives as garbage. The costs and the dates are ASCII and survive
 * intact, which is what makes it dangerous rather than obvious: the file parses,
 * foots, and maps, and the only damage is to the words a preparer reads when
 * deciding what an asset *is*.
 *
 * The scope is not a bug, it is the client. This is what somebody sends when
 * they are asked for "this year's additions" — eleven rows out of eighty-seven,
 * with no indication on the file itself that the other seventy-six exist. No
 * check can catch that from inside the file, and the mapping is not wrong. It is
 * the reason a register arriving alone is a question about the prior year, and
 * why the carry-forward comparison exists.
 */
export function ironwoodAdditionsEntry(): CorpusEntry {
  const one = business('ironwood');
  const additions = acquiredIn(one.assets, 2025);

  const rows: Cell[][] = [
    ['Ironwood Fabrication Group, LP'],
    ['Fixed Asset Additions — 01/01/2025 through 12/31/2026'],
    [],
    ['Asset No.', 'Description', 'Vendor', 'G/L Class', 'Date In Service', 'Cost', 'Life (Yrs)'],
    ...additions.map((asset, index) => [
      asset.tag,
      asset.description,
      VENDORS[index] ?? 'Gulf Coast Industrial Supply',
      asset.category,
      slashDate(asset.acquired),
      usd(asset.cost),
      asset.life,
    ]),
    [],
    ['', 'Total additions', '', '', '', usd(totalCost(additions)), ''],
  ];

  return {
    id: 'ironwood-additions',
    filename: 'IW additions 1-1-25 thru 12-31-26.csv',
    kind: 'register',
    format: 'csv',
    businessId: one.id,
    source: 'Sage 50 (US) — Fixed Assets, Additions report',
    jurisdictions: ['TX — Harris', 'TX — Fort Bend'],
    premise:
      "What a client sends when the request was 'this year's additions': a partial listing, exported from a Windows desktop package in CP-1252.",
    traps: [
      'The bytes are CP-1252, not UTF-8, and the parser assumes UTF-8 — every accented vendor name arrives mojibaked while every number survives.',
      'Three title lines sit above the header row, so the header is row 3, not row 0.',
      'The file is 11 of the 87 assets and says so nowhere a machine can read.',
      'Costs carry a dollar sign and thousands separators; the total line is text in the description column.',
      'The filename has spaces and no extension convention worth relying on.',
    ],
    expectation: {
      autopilot: 'clears',
      because:
        'Every column means what it says and the mapped costs foot to the printed total. That the file is a fraction of the register is true and undetectable from inside it — which is the point of it being here.',
    },
    mapping: {
      sheets: [
        {
          sheetName: 'Sheet1',
          include: true,
          headerRow: 3,
          categoryFromBands: false,
          columns: [
            { index: 0, field: 'assetTag' },
            { index: 1, field: 'description' },
            { index: 2, field: 'vendor' },
            { index: 3, field: 'category' },
            { index: 4, field: 'acquisitionDate' },
            { index: 5, field: 'originalCost' },
            { index: 6, field: 'usefulLife' },
          ],
        },
      ],
    },
    truth: {
      assetCount: additions.length,
      totalCost: totalCost(additions),
      includedSheets: ['Sheet1'],
    },
    build: () => delimited(rows, { delimiter: ',', newline: '\r\n', encoding: 'windows-1252' }),
  };
}
