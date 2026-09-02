import { acquisitionYear, business, totalCost } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { spreadsheet, type Cell } from '../write.js';
import { grouped } from './format.js';

/**
 * Not a register at all — a pivot table of it.
 *
 * Somebody was asked for "the fixed assets" and sent what they had open: cost
 * by class down the side, year acquired across the top, one number in every
 * cell. It is a perfectly good summary and it is worth exactly nothing here,
 * because there is no asset on it. Nothing can be classified, nothing can be
 * placed at a site, nothing can be found to have been disposed of, and no
 * finding can name the thing it is about.
 *
 * It is in the corpus because it is the failure the safety bar has to catch by
 * structure rather than by suspicion. Every number on this sheet is correct.
 * The cost total foots. A mapping proposal can even be produced for it — years
 * are a plausible acquisition column and the class column is plausibly a
 * description — and the only thing standing between that mapping and a return
 * built out of eleven rows is a rule that says a register without a description
 * is not a register.
 */
export function dentalPivotEntry(): CorpusEntry {
  const one = business('lonestar');
  const classes = [...new Set(one.assets.map((asset) => asset.category))];
  const years = [...new Set(one.assets.map(acquisitionYear))].sort((a, b) => a - b);

  const rows: Cell[][] = [
    ['Sum of Cost', ...years.map(String), 'Grand Total'],
    ...classes.map((category) => {
      const block = one.assets.filter((asset) => asset.category === category);
      return [
        category,
        ...years.map((year) => {
          const cell = block.filter((asset) => acquisitionYear(asset) === year);
          return cell.length === 0 ? '' : grouped(totalCost(cell));
        }),
        grouped(totalCost(block)),
      ];
    }),
    [
      'Grand Total',
      ...years.map((year) =>
        grouped(totalCost(one.assets.filter((asset) => acquisitionYear(asset) === year))),
      ),
      grouped(totalCost(one.assets)),
    ],
  ];

  return {
    id: 'lonestar-pivot',
    filename: 'fixed assets by year.xlsx',
    kind: 'register',
    format: 'xlsx',
    businessId: one.id,
    source: 'Excel — a pivot table off the depreciation detail',
    jurisdictions: ['TX — Harris', 'TX — Fort Bend', 'TX — Collin', 'TX — Travis'],
    premise:
      'A summary sent in place of a register: cost by class and year, with no row that is an asset.',
    traps: [
      'Years run across the columns, so the file is wide where a register is long.',
      'Every figure on it is right, which is why nothing about the numbers gives it away.',
      'The class column looks enough like a description to be mapped as one.',
    ],
    expectation: {
      autopilot: 'holds',
      because:
        'There is no description column to map, and a register with no description is not something a return can be built from.',
    },
    mapping: null,
    truth: null,
    build: () => spreadsheet([{ name: 'Sheet1', matrix: rows }], 'xlsx'),
  };
}
