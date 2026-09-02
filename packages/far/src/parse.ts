import * as XLSX from 'xlsx';
import type { SheetSummary } from '@tangible/types';
import { decodeText } from './text.js';
import { isoDate } from './values.js';

/**
 * Reading the workbook is separated from deciding what it means. This module
 * produces the raw cell matrix and a bounded summary; the mapping (AI-proposed,
 * human-confirmed) decides which cells are assets. Nothing here interprets.
 */

export interface ParsedSheet {
  name: string;
  /** Row-major cells. Dates arrive as Date objects, numbers as numbers. */
  matrix: unknown[][];
  rowCount: number;
  colCount: number;
}

export interface ParsedWorkbook {
  sheets: ParsedSheet[];
}

/** Preview bounds — enough rows to see a title block, headers, bands and data. */
const PREVIEW_ROWS = 25;
const PREVIEW_COLS = 40;
const PREVIEW_CELL_CHARS = 80;

/**
 * A ceiling on cells materialized per sheet. Excel stamps a sheet's stored range
 * as far as any formatting reaches, so a hand-built register can advertise
 * A1:XFD1048576 while holding two hundred real rows. The true extent is
 * recomputed below; this is the backstop for a file that genuinely is enormous,
 * where refusing beats an out-of-memory crash that says nothing.
 */
const MAX_CELLS = 4_000_000;

const ZIP_MAGIC = [0x50, 0x4b]; // "PK" — xlsx / xlsm
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0]; // legacy .xls

function startsWith(data: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => data[i] === byte);
}

/**
 * Delimited text takes a different read path than a spreadsheet, and it matters.
 * SheetJS runs a fuzzy date parse and numeric coercion over CSV fields, which
 * turns a Sage useful life of "10/06" into a 2001 date and an asset tag of
 * "00123" into 123 — identifiers and lives silently rewritten. Reading text
 * cells as text leaves every interpretation to `values.ts`, which refuses what
 * it cannot read instead of inventing it. Spreadsheets keep `cellDates` because
 * there a date cell is typed as a date rather than guessed at.
 *
 * A spreadsheet carries its own encoding inside the container; delimited text
 * carries nothing but bytes, so {@link decodeText} has to work out what they
 * are before any of the above can happen.
 */
export function parseWorkbook(data: Uint8Array): ParsedWorkbook {
  const binary = startsWith(data, ZIP_MAGIC) || startsWith(data, OLE2_MAGIC);

  const workbook = binary
    ? XLSX.read(data, { type: 'array', cellDates: true })
    : XLSX.read(decodeText(data).text, { type: 'string', raw: true });

  const sheets: ParsedSheet[] = workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return { name, matrix: [], rowCount: 0, colCount: 0 };

    clampToUsedRange(sheet, name);

    // blankrows keeps empty rows in place so row indexes match what the person
    // sees in Excel — lineage back to "Sheet1 row 214" must not drift.
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const colCount = matrix.reduce((max, row) => Math.max(max, row.length), 0);
    return { name, matrix, rowCount: matrix.length, colCount };
  });

  return { sheets };
}

/**
 * Replace the sheet's advertised range with the extent of the cells it actually
 * holds. Without this, `sheet_to_json` faithfully materializes every cell of a
 * declared range — a sheet formatted out to column XFD costs hundreds of
 * megabytes and minutes before any asset is read.
 */
export function clampToUsedRange(sheet: XLSX.WorkSheet, sheetName: string): void {
  let maxRow = -1;
  let maxCol = -1;

  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const cell = sheet[key] as XLSX.CellObject | undefined;
    // A cell object with no value carries formatting only; it is not content.
    if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  }

  if (maxRow < 0 || maxCol < 0) {
    delete sheet['!ref'];
    return;
  }

  const cells = (maxRow + 1) * (maxCol + 1);
  if (cells > MAX_CELLS) {
    throw new Error(
      `Sheet "${sheetName}" holds ${maxRow + 1} rows × ${maxCol + 1} columns of data, ` +
        `beyond what this reader will load at once. Split the register or remove unused columns.`,
    );
  }

  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: maxCol } });
}

/** A cell as a human (or the mapping model) should read it. */
export function formatCell(value: unknown, maxChars = PREVIEW_CELL_CHARS): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isoDate(value);
  // Newlines inside a cell would break the tab-separated preview the model
  // reads, splicing one cell across two apparent rows.
  const s = String(value)
    .replace(/\s*[\r\n]+\s*/g, ' ⏎ ')
    .trim();
  if (s === '') return null;
  return s.length > maxChars ? `${s.slice(0, maxChars)}…` : s;
}

export function summarizeWorkbook(workbook: ParsedWorkbook): SheetSummary[] {
  return workbook.sheets.map((sheet) => ({
    name: sheet.name,
    rowCount: sheet.rowCount,
    colCount: sheet.colCount,
    preview: sheet.matrix
      .slice(0, PREVIEW_ROWS)
      .map((row) => row.slice(0, PREVIEW_COLS).map((cell) => formatCell(cell))),
    detectedHeaderRow: detectHeaderRow(sheet.matrix),
  }));
}

/** Looks like a number rather than a label — "1,234.50", "(42)", "18%". */
function numericLooking(value: unknown): boolean {
  if (typeof value === 'number' || value instanceof Date) return true;
  if (typeof value !== 'string') return false;
  const s = value.trim();
  return s !== '' && /^[\d\s.,$%()+-]+$/.test(s);
}

/**
 * Guess which row holds the column headers: all text, several distinct short
 * labels, and — decisively — no numeric cells. A row carrying a cost or an
 * acquisition date is data, however many words sit beside it, and that single
 * rule is what keeps a wide first asset row from outscoring a sparse header.
 *
 * This is a starting point for the mapping, not a decision: the proposal and the
 * reviewer may both override it, and returning null (no plausible header) is a
 * valid answer for a headerless dump. Only rows the preview shows are
 * considered, so anything detected is also something a person can see.
 */
export function detectHeaderRow(matrix: unknown[][]): number | null {
  const limit = Math.min(matrix.length, PREVIEW_ROWS);
  let best: number | null = null;
  let bestScore = 0;

  for (let i = 0; i < limit; i++) {
    const row = matrix[i] ?? [];
    const filled = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '');
    if (filled.length < 3) continue;
    if (filled.some(numericLooking)) continue;

    const texty = filled.filter(
      (c) => typeof c === 'string' && c.trim().length > 0 && c.trim().length <= 40,
    );
    if (texty.length < Math.max(3, filled.length * 0.6)) continue;

    const distinct = new Set(texty.map((c) => String(c).trim().toLowerCase())).size;
    const score = texty.length + distinct;
    // Strictly greater keeps the earliest of equally good candidates, which is
    // the header rather than a repeat of it further down.
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }

  return best;
}
