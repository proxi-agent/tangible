import { business, site } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { spreadsheet, type Cell } from '../write.js';
import { grouped, slashDate } from './format.js';

/**
 * Net book value, and nothing else.
 *
 * The fleet system prints what the fleet manager cares about — what the truck
 * is worth now — and drops what it does not need to carry. There is no original
 * cost anywhere on the file.
 *
 * That is fatal, and quietly so. Texas renders on historical cost by year
 * acquired: the district's own schedule takes cost and applies the depreciation
 * percentage. Handing it net book value files each asset as though it had been
 * bought this year for its depreciated value, which is both wrong and, on a
 * fleet of seven-year-old tractors, wrong in the direction the district likes.
 * The column is even named "Value", which is the exact word both quantities
 * answer to — this is the header the mapping-memory conflict machinery was
 * built for.
 *
 * The file is a real BIFF8 .xls, because a system old enough to print only NBV
 * is old enough to write the 1997 format.
 */
export function halcyonNbvEntry(): CorpusEntry {
  const one = business('halcyon');
  const fleet = one.assets.filter((asset) => asset.kind === 'vehicle');

  const rows: Cell[][] = [
    ['HALCYON LOGISTICS LLC — EQUIPMENT VALUATION LISTING'],
    ['As of 12/31/2026'],
    [],
    ['Unit #', 'Year/Make/Model', 'Domicile', 'In Service', 'Value', 'Status'],
    ...fleet.map((asset) => [
      asset.tag,
      asset.description,
      site(one, asset.siteId).label,
      slashDate(asset.acquired),
      grouped(Math.max(0, asset.cost - asset.accumulated)),
      asset.disposedOn === null ? 'ACTIVE' : 'SOLD',
    ]),
  ];

  return {
    id: 'halcyon-nbv',
    filename: 'EQUIP_VAL.xls',
    kind: 'register',
    format: 'xls',
    businessId: one.id,
    source: 'A fleet maintenance system — equipment valuation listing',
    jurisdictions: ['AL — Mobile', 'FL — Escambia', 'TX — Harris'],
    premise:
      'The fleet listing, in the 1997 Excel format, carrying current value where a return needs original cost.',
    traps: [
      'There is no original cost column at all — only depreciated value.',
      'The column is called "Value", which is what a cost column is often called too.',
      'The bytes are BIFF8, not a zip, so anything that sniffs for "PK" decides this is not a spreadsheet.',
      'Only the vehicles are on it; the shop and office assets are in another system entirely.',
    ],
    expectation: {
      autopilot: 'holds',
      because:
        'No column on the sheet is an original cost, and filing net book value as cost is the error that a mapping confirmed by nobody would make.',
    },
    mapping: null,
    truth: null,
    build: () => spreadsheet([{ name: 'EQUIP', matrix: rows }], 'xls'),
  };
}
