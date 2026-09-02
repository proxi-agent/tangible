import { business, site, totalCost } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { delimited, type Cell } from '../write.js';
import { grouped, monthName } from './format.js';

/** Twenty rows to a page, and a new header on every one of them. */
const PAGE = 20;

/**
 * A print file, saved as a spreadsheet.
 *
 * Nobody exported this. Somebody chose "print to file" on a green-screen asset
 * package, and what came out is a paginated report: a three-line header at the
 * top of every page, a form feed between pages, columns held together by tabs
 * and nothing else. Half the rows on it are not rows.
 *
 * The date format is the reason this entry earns its place, and the reason has
 * changed once already. "14-Mar-2020" is how a great many systems print a date,
 * and the parser used to read ISO, m/d/y, FY20 and a bare year — not that. So
 * every date came back empty, every row carried a warning naming the string it
 * could not read, and the warning rate failed. The file was held for a gap in
 * the parser rather than for anything wrong with the client's data.
 *
 * `dateValue` reads a spelled-out month now, and fixing that uncovered the
 * second defect by removing the noise on top of it. The nine page-header lines
 * buried in the data had always been read as assets; every row warning about
 * its date was simply drowning them out. They carried no cost, so the file
 * footed to the cent while holding nine rows that were not assets — right about
 * every dollar and wrong about nine of its rows, which is the version of this
 * mistake that no check measuring money will ever find.
 *
 * `applyMapping` skips them now, on the one piece of evidence that is proof
 * rather than inference: they are lines the mapping itself placed at or above
 * the header row, repeated further down. So this file reads exactly, and what
 * it is in the corpus to prove has changed accordingly — it is no longer an
 * example of something unread, but the case that keeps a printout reading
 * correctly. Its `truth` is asserted like any clean file's, which is the
 * strongest statement available: eighty assets, to the cent, out of a
 * hundred-and-thirteen-line report.
 */
export function assetkeeperEntry(): CorpusEntry {
  const one = business('halcyon');
  const header = [
    ['HALCYON LOGISTICS, LLC', '', '', '', '', 'PAGE #'],
    ['ASSET DEPRECIATION SCHEDULE', '', '', '', '', 'RUN 01/09/2027'],
    ['UNIT', 'DESCRIPTION', 'TERMINAL', 'ACQUIRED', 'COST', 'LIFE', 'ACCUM'],
  ];

  const rows: Cell[][] = [];
  one.assets.forEach((asset, index) => {
    if (index % PAGE === 0) {
      const page = index / PAGE + 1;
      for (const line of header) {
        rows.push(
          line.map((cell) =>
            cell === 'PAGE #' ? `PAGE ${page}` : index === 0 ? cell : `\f${cell}`,
          ),
        );
      }
    }
    rows.push([
      asset.tag.replace(/^[A-Z]+-/, '0'),
      asset.description,
      site(one, asset.siteId).label.toUpperCase(),
      monthName(asset.acquired),
      grouped(asset.cost),
      `${asset.life}/00`,
      grouped(asset.accumulated),
    ]);
  });

  return {
    id: 'halcyon-assetkeeper',
    filename: 'ASSETDEP.TXT',
    kind: 'register',
    format: 'tsv',
    businessId: one.id,
    source: 'A green-screen asset package — print-to-file, tab delimited',
    jurisdictions: ['AL — Mobile', 'FL — Escambia', 'TX — Harris'],
    premise:
      'A paginated printout rather than an export: page headers every twenty rows, form feeds between pages, tabs holding the columns apart.',
    traps: [
      'The three-line page header repeats twelve times inside the data.',
      'Form feed characters lead the first cell of every page after the first.',
      'Dates read "14-Mar-2020" — a spelled-out month, which only a parser that handles the order-free form can read.',
      'The nine page-header lines inside the data are costless, so they foot perfectly while being counted as assets — the damage is to the row count alone.',
      'Unit numbers are zero-led, so a spreadsheet reader that infers types turns 0104 into 104.',
      'Life is written years/months as "7/00" and is neither a number nor a date.',
      'Three terminals across three states are on the one file, and two of the states are not Texas.',
    ],
    expectation: {
      autopilot: 'clears',
      because:
        'Every check passes, and the eighty rows it produces are the eighty assets — the dates read, the page headers are skipped by name, and not one row warns.',
    },
    mapping: {
      sheets: [
        {
          sheetName: 'Sheet1',
          include: true,
          headerRow: 2,
          categoryFromBands: false,
          columns: [
            { index: 0, field: 'assetTag' },
            { index: 1, field: 'description' },
            { index: 2, field: 'location' },
            { index: 3, field: 'acquisitionDate' },
            { index: 4, field: 'originalCost' },
            { index: 5, field: 'usefulLife' },
            { index: 6, field: 'accumulatedDepreciation' },
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
        delimiter: '\t',
        newline: '\n',
        encoding: 'utf-8',
        neverQuote: true,
      }),
  };
}
