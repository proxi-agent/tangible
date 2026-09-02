import { business, site, totalCost } from '../business.js';
import type { CorpusAsset, CorpusEntry } from '../types.js';
import { spreadsheet, type Cell, type Sheet } from '../write.js';
import { grouped, slashDate } from './format.js';

/**
 * A workbook a person built, one tab per building.
 *
 * No system produced this. The bookkeeper made a tab when the second location
 * opened, copied the first tab's headings roughly, and has been typing into
 * both ever since — so the two sheets hold the same six facts in two different
 * orders, and the third tab is a summary that restates every number on the
 * other two.
 *
 * It is the sharpest test of the thing a mapping actually is. A mapping is not
 * one set of columns for a file; it is a decision per sheet, about whether the
 * sheet is in at all and about what each of its columns means. Read this
 * workbook with one column order and half the register becomes costs filed as
 * dates. Include the summary tab and the whole register is counted twice.
 */
export function bookkeeperEntry(): CorpusEntry {
  const one = business('ironwood');
  const houston = one.assets.filter((asset) => asset.siteId === 'hou');
  const katy = one.assets.filter((asset) => asset.siteId === 'katy');

  const houstonSheet: Sheet = {
    name: 'Houston',
    matrix: [
      ['Ironwood Fabrication Group, LP — Equipment List — Houston Plant'],
      [`${site(one, 'hou').street}, ${site(one, 'hou').city}, TX ${site(one, 'hou').zip}`],
      [],
      ['Tag', 'Description', 'Purchased', 'Cost', 'Yrs', 'Notes'],
      ...houston.map((asset) => [
        asset.tag,
        asset.description,
        slashDate(asset.acquired),
        grouped(asset.cost),
        asset.life,
        note(asset),
      ]),
      ['', 'TOTAL', '', grouped(totalCost(houston)), '', ''],
    ],
  };

  const katySheet: Sheet = {
    name: 'Katy',
    matrix: [
      ['Katy Warehouse — equipment'],
      [],
      ['Description', 'Cost', 'Purchased', 'Tag', 'Notes', 'Yrs'],
      ...katy.map((asset) => [
        asset.description,
        grouped(asset.cost),
        slashDate(asset.acquired),
        asset.tag,
        note(asset),
        asset.life,
      ]),
      ['TOTAL', grouped(totalCost(katy)), '', '', '', ''],
    ],
  };

  const summary: Sheet = {
    name: 'Summary',
    matrix: [
      ['Location', 'Assets', 'Cost'],
      ['Houston Plant', houston.length, grouped(totalCost(houston))],
      ['Katy Warehouse', katy.length, grouped(totalCost(katy))],
      ['Total', one.assets.length, grouped(totalCost(one.assets))],
    ],
  };

  return {
    id: 'ironwood-bookkeeper',
    filename: 'Equipment list (updated 1-6-27).xlsx',
    kind: 'register',
    format: 'xlsx',
    businessId: one.id,
    source: 'Excel — maintained by hand',
    jurisdictions: ['TX — Harris', 'TX — Fort Bend'],
    premise:
      'A hand-kept workbook with one tab per location, the same columns in two different orders, and a summary tab that restates both.',
    traps: [
      'The two asset sheets order their columns differently, so one mapping cannot serve both.',
      'The header row sits at row 3 on one sheet and row 2 on the other.',
      'The summary tab holds the same money again — including it doubles the register.',
      'Situs is the tab name, not a column, and the two tabs are in two different appraisal districts.',
      'The Notes column carries disposals in prose: "sold 3/2026", "traded in".',
    ],
    expectation: {
      autopilot: 'clears',
      because:
        'Both asset sheets foot to their own printed totals under their own column orders, and the summary sheet is excluded — which is a decision the mapping records, not a guess made row by row.',
    },
    mapping: {
      sheets: [
        {
          sheetName: 'Houston',
          include: true,
          headerRow: 3,
          categoryFromBands: false,
          columns: [
            { index: 0, field: 'assetTag' },
            { index: 1, field: 'description' },
            { index: 2, field: 'acquisitionDate' },
            { index: 3, field: 'originalCost' },
            { index: 4, field: 'usefulLife' },
            { index: 5, field: 'disposalIndicator' },
          ],
        },
        {
          sheetName: 'Katy',
          include: true,
          headerRow: 2,
          categoryFromBands: false,
          columns: [
            { index: 0, field: 'description' },
            { index: 1, field: 'originalCost' },
            { index: 2, field: 'acquisitionDate' },
            { index: 3, field: 'assetTag' },
            { index: 4, field: 'disposalIndicator' },
            { index: 5, field: 'usefulLife' },
          ],
        },
        {
          sheetName: 'Summary',
          include: false,
          headerRow: 0,
          categoryFromBands: false,
          columns: [],
        },
      ],
    },
    truth: {
      assetCount: one.assets.length,
      totalCost: totalCost(one.assets),
      includedSheets: ['Houston', 'Katy'],
    },
    build: () => spreadsheet([houstonSheet, katySheet, summary], 'xlsx'),
  };
}

/** What a person writes in a notes column, which is never a status code. */
function note(asset: CorpusAsset): Cell {
  if (asset.disposedOn !== null) return `sold ${slashDate(asset.disposedOn)}`;
  if (asset.kind === 'leasehold') return 'landlord improvement';
  return '';
}
