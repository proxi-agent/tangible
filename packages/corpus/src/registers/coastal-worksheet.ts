import { business, site, totalCost } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { spreadsheet, type Cell, type Sheet } from '../write.js';
import { grouped, year } from './format.js';

/**
 * The worksheet a Florida preparer keeps behind the return.
 *
 * Its sections are the return's sections, not the client's classes, because it
 * was built by copying the DR-405 down a spreadsheet: office equipment,
 * machinery, leasehold improvements, then the two parts of the form that are
 * not the taxpayer's own depreciable property at all.
 *
 * Those two are the reason it is here. Equipment leased or loaned *from* others
 * — the beverage company's coolers, the coffee machines — is reported by the
 * lessee with the lessor named, and valued by the lessor; carrying its cost into
 * the taxpayer's own total files somebody else's property twice. Inventory held
 * for sale is exempt in Florida outright, and the two physical-count lines here
 * carry more cost than the other eighty-five rows together. Both are correct on
 * the worksheet and catastrophic on the return, and neither is a mapping error.
 *
 * Situs is the section header on a sheet that mixes two counties, so the one
 * worksheet is two returns — Hillsborough and Miami-Dade — with different
 * account numbers and, in a bad year, different filing dates.
 */
export function coastalWorksheetEntry(): CorpusEntry {
  const one = business('coastal');
  const sections = [
    'Refrigeration',
    'Warehouse Equipment',
    'Office & Computer',
    'Delivery Fleet',
    'Leased from Others',
    'Inventory',
  ];

  const matrix: Cell[][] = [
    ['COASTAL PROVISIONS CO.'],
    ['TANGIBLE PERSONAL PROPERTY — WORKSHEET FOR DR-405'],
    ['Tax year 2027 (as of January 1)'],
    [],
    [
      'Item',
      'Description',
      'County',
      'Acct / Folio',
      'Year Acq.',
      'Original Installed Cost',
      'Lessor (if not owned)',
    ],
  ];

  for (const section of sections) {
    const block = one.assets.filter((asset) => asset.category === section);
    matrix.push([]);
    matrix.push(['', section.toUpperCase()]);
    for (const asset of block) {
      const where = site(one, asset.siteId);
      matrix.push([
        asset.tag,
        asset.description,
        where.county,
        where.account,
        year(asset.acquired),
        grouped(asset.cost),
        asset.vendor ?? '',
      ]);
    }
    matrix.push(['', `Total ${section}`, '', '', '', grouped(totalCost(block)), '']);
  }
  matrix.push([]);
  matrix.push(['', 'TOTAL — ALL SECTIONS', '', '', '', grouped(totalCost(one.assets)), '']);

  const sheet: Sheet = { name: 'TPP Worksheet', matrix };

  return {
    id: 'coastal-worksheet',
    filename: 'Coastal TPP worksheet 2027.xlsx',
    kind: 'register',
    format: 'xlsx',
    businessId: one.id,
    source: 'A preparer’s worksheet, laid out to follow the DR-405',
    jurisdictions: ['FL — Hillsborough', 'FL — Miami-Dade'],
    premise:
      "The worksheet behind last year's Florida return: the form's own sections, including the two that are not the taxpayer's property.",
    traps: [
      'Leased-from-others equipment carries a cost that belongs to the lessor, not to Coastal.',
      'Two inventory lines carry $1.76M, and Florida exempts inventory held for sale outright.',
      'Two counties share the sheet, with a different account number in the column beside each row.',
      'The sections are the return’s vocabulary, so a category taken from them describes the form and not the asset.',
      'Only a year is given, never a date — which is what the return asks for and less than a schedule wants.',
    ],
    expectation: {
      autopilot: 'clears',
      because:
        'Nothing about the columns is ambiguous and the totals foot section by section. What is wrong with this file is what is on it, not how it reads — and that is a finding, not a mapping.',
    },
    mapping: {
      sheets: [
        {
          sheetName: 'TPP Worksheet',
          include: true,
          headerRow: 4,
          categoryFromBands: true,
          columns: [
            { index: 0, field: 'assetTag' },
            { index: 1, field: 'description' },
            { index: 2, field: 'location' },
            { index: 4, field: 'acquisitionYear' },
            { index: 5, field: 'originalCost' },
            { index: 6, field: 'vendor' },
          ],
        },
      ],
    },
    truth: {
      assetCount: one.assets.length,
      totalCost: totalCost(one.assets),
      includedSheets: ['TPP Worksheet'],
    },
    build: () => spreadsheet([sheet], 'xlsx'),
  };
}
