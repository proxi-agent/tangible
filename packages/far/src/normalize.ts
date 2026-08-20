import type { CanonicalAssetField, FarMapping } from '@tangible/types';
import { formatCell, type ParsedWorkbook } from './parse.js';
import { dateValue, numberValue, textValue, yearValue } from './values.js';

/**
 * Apply a confirmed mapping to a parsed workbook and produce canonical asset
 * rows. Deterministic on purpose: the AI proposes the mapping and a human
 * confirms it, but the rows themselves are made by plain code, so re-running a
 * mapping always yields the same assets and every skip has a stated reason.
 */

/** An asset before it gains ids — what the caller inserts. */
export interface AssetDraft {
  sourceSheet: string;
  sourceRow: number;
  assetTag: string | null;
  description: string | null;
  category: string | null;
  glAccount: string | null;
  acquisitionDate: string | null;
  acquisitionYear: number | null;
  inServiceDate: string | null;
  originalCost: number | null;
  accumulatedDepreciation: number | null;
  netBookValue: number | null;
  quantity: number | null;
  serialNumber: string | null;
  entity: string | null;
  location: string | null;
  department: string | null;
  vendor: string | null;
  usefulLife: string | null;
  depreciationMethod: string | null;
  disposalDate: string | null;
  disposalIndicator: string | null;
  isDisposed: boolean;
  warnings: string[];
  raw: (string | null)[];
}

export interface SkippedRow {
  sheet: string;
  /** 0-based sheet row; -1 for sheet-level problems. */
  row: number;
  reason: string;
}

export interface NormalizeOutput {
  assets: AssetDraft[];
  skipped: SkippedRow[];
}

/**
 * Subtotal labels, in the shapes registers write them — "Total", "Subtotal —
 * M&E", "Machinery & Equipment Total". Deliberately narrow at both ends: a
 * description like "Total Station Leica TS16" (a real surveying instrument) or a
 * vendor named "Total Energies" must not delete an asset from the register, so
 * a label only counts when the word stands alone or terminates the phrase.
 */
const TOTAL_LABELS = [
  /^\s*(grand\s+|sub[\s-]?)?totals?\s*[:—–-]*\s*$/i,
  /^\s*(grand\s+|sub[\s-]?)?totals?\s*[:—–-]\s*\S/i,
  /\S\s+(sub)?totals?\s*[:.]?\s*$/i,
];

function isTotalLabel(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return TOTAL_LABELS.some((pattern) => pattern.test(value));
}

const DISPOSED =
  /\b(disposed?|disposal|sold|retired?|scrapp?ed|traded(\s+in)?|transferred\s+out|written\s+off|write[\s-]?off)\b/i;

const RAW_COLS = 60;

export function applyMapping(workbook: ParsedWorkbook, mapping: FarMapping): NormalizeOutput {
  const assets: AssetDraft[] = [];
  const skipped: SkippedRow[] = [];

  for (const sheetMapping of mapping.sheets) {
    if (!sheetMapping.include) continue;

    const sheet = workbook.sheets.find((s) => s.name === sheetMapping.sheetName);
    if (!sheet) {
      skipped.push({
        sheet: sheetMapping.sheetName,
        row: -1,
        reason: 'sheet named in the mapping is not in the workbook',
      });
      continue;
    }

    // First mapping of a field wins; a duplicate is surfaced, never silently merged.
    const fieldColumn = new Map<CanonicalAssetField, number>();
    for (const column of sheetMapping.columns) {
      if (!column.field) continue;
      if (fieldColumn.has(column.field)) {
        skipped.push({
          sheet: sheet.name,
          row: -1,
          reason: `column ${column.index} also mapped to ${column.field}; using column ${fieldColumn.get(column.field)}`,
        });
      } else {
        fieldColumn.set(column.field, column.index);
      }
    }
    if (fieldColumn.size === 0) {
      skipped.push({ sheet: sheet.name, row: -1, reason: 'no columns mapped' });
      continue;
    }

    const start = sheetMapping.headerRow === null ? 0 : sheetMapping.headerRow + 1;

    // Rows above the header are never read. Saying so keeps a mis-set header row
    // from quietly costing assets — the count is the tell.
    if (sheetMapping.headerRow !== null && sheetMapping.headerRow > 0) {
      const above = sheet.matrix
        .slice(0, sheetMapping.headerRow)
        .filter((row) =>
          row.some((c) => c !== null && c !== undefined && String(c).trim() !== ''),
        ).length;
      if (above > 0) {
        skipped.push({
          sheet: sheet.name,
          row: -1,
          reason: `${above} non-empty ${above === 1 ? 'row' : 'rows'} above the header row were not read`,
        });
      }
    }

    // Section labels sit at the left margin, at or before the first mapped
    // column. Anchoring on that is what separates a band from a sparse asset
    // row whose only value happens to be a description.
    const leftmostMapped = Math.min(...fieldColumn.values());
    let bandCategory: string | null = null;

    for (let r = start; r < sheet.matrix.length; r++) {
      const row = sheet.matrix[r] ?? [];
      const cell = (field: CanonicalAssetField): unknown => {
        const index = fieldColumn.get(field);
        return index === undefined ? undefined : row[index];
      };

      // The whole row matters, not only the mapped part of it: a subtotal label
      // parked in an unmapped column would otherwise pass as an asset carrying
      // the subtotal's amount, double-counting the section it closes.
      const filledAll = row
        .map((value, index) => ({ index, value }))
        .filter(
          ({ value }) => value !== null && value !== undefined && String(value).trim() !== '',
        );
      if (filledAll.length === 0) continue; // blank row — not worth recording

      const acquisition = dateValue(cell('acquisitionDate'));
      const inService = dateValue(cell('inServiceDate'));
      const acquisitionYear =
        yearValue(cell('acquisitionYear')) ?? acquisition.year ?? inService.year;
      const assetTag = textValue(cell('assetTag'));

      // Subtotal and total rows are arithmetic about assets, not assets. A row
      // that also carries an acquisition date or a tag of its own is an asset
      // whose text merely reads like a total.
      const looksLikeAsset =
        acquisitionYear !== null || (assetTag !== null && !isTotalLabel(assetTag));
      if (!looksLikeAsset && filledAll.some(({ value }) => isTotalLabel(value))) {
        skipped.push({ sheet: sheet.name, row: r, reason: 'subtotal/total row' });
        continue;
      }

      // A band label: the only value in the entire row, sitting at the left
      // margin. Anything further right is a row of data missing most of its
      // cells, and is kept as an asset with warnings rather than silently
      // renaming the category of everything below it.
      const only = filledAll.length === 1 ? filledAll[0] : undefined;
      if (
        sheetMapping.categoryFromBands &&
        only !== undefined &&
        typeof only.value === 'string' &&
        only.index <= leftmostMapped
      ) {
        bandCategory = only.value.trim();
        skipped.push({
          sheet: sheet.name,
          row: r,
          reason: `section header — rows below take category "${bandCategory}"`,
        });
        continue;
      }

      const warnings: string[] = [];
      const disposal = dateValue(cell('disposalDate'));
      const originalCost = numberValue(cell('originalCost'));
      const accumulatedDepreciation = numberValue(cell('accumulatedDepreciation'));
      const netBookValue = numberValue(cell('netBookValue'));

      const description = textValue(cell('description'));
      const disposalIndicator = textValue(cell('disposalIndicator'));
      const isDisposed =
        disposal.date !== null || (disposalIndicator !== null && DISPOSED.test(disposalIndicator));

      if (description === null) warnings.push('no description');
      if (originalCost === null && netBookValue === null) warnings.push('no cost value');
      else if (originalCost === null) warnings.push('net book value only — original cost missing');
      if (originalCost !== null && originalCost < 0)
        warnings.push('negative cost — credit or adjustment row?');
      if (acquisitionYear === null) warnings.push('no acquisition date or year');
      // A date-shaped cell the parsers refused is worth saying out loud; the
      // alternative is a silently empty date column.
      if (
        cell('acquisitionDate') !== undefined &&
        acquisition.date === null &&
        acquisition.year === null
      ) {
        const raw = textValue(cell('acquisitionDate'));
        if (raw !== null) warnings.push(`acquisition date not understood: "${raw}"`);
      }

      assets.push({
        sourceSheet: sheet.name,
        sourceRow: r,
        assetTag,
        description,
        category: textValue(cell('category')) ?? bandCategory,
        glAccount: textValue(cell('glAccount')),
        acquisitionDate: acquisition.date,
        acquisitionYear,
        inServiceDate: inService.date,
        originalCost,
        accumulatedDepreciation,
        netBookValue,
        quantity: numberValue(cell('quantity')),
        serialNumber: textValue(cell('serialNumber')),
        entity: textValue(cell('entity')),
        location: textValue(cell('location')),
        department: textValue(cell('department')),
        vendor: textValue(cell('vendor')),
        usefulLife: textValue(cell('usefulLife')),
        depreciationMethod: textValue(cell('depreciationMethod')),
        disposalDate: disposal.date,
        disposalIndicator,
        isDisposed,
        warnings,
        raw: row.slice(0, RAW_COLS).map((value) => formatCell(value, 200)),
      });
    }
  }

  return { assets, skipped };
}
