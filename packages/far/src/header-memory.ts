import type {
  CanonicalAssetField,
  FarMapping,
  MappingMemoryHint,
  SheetSummary,
} from '@tangible/types';
import { formatCell, type ParsedWorkbook } from './parse.js';

/**
 * What a confirmed mapping teaches, and what a header the firm has seen before
 * is worth on the next file.
 *
 * The mapping loop had no memory at all. A model read the preview, proposed,
 * verified itself against the rows, and a person confirmed — and then every
 * word of that was thrown away, so the fortieth QuickBooks export arrived as
 * unfamiliar as the first. Reviewers were re-answering "Acq. Cost is original
 * cost" a dozen times a season, which is exactly the work
 * `classification_memory` already refuses to make anybody do twice.
 *
 * The unit of memory is the **header text**, not the column position and not
 * the sheet. Positions move between exports of the same report; the words in
 * the header row are what stay put, and they are what a reviewer is actually
 * deciding about when they point a column at a field.
 *
 * Everything here is pure, so the rules that decide what gets remembered are
 * testable without a database — the same split as {@link planAskSync}.
 */

/**
 * Fold a header into its memory key.
 *
 * Conservative in the same direction as the classification fingerprint, and
 * for the same reason: a key that is too loose points one file's decision at a
 * different column somewhere else, silently, with a cost column attached; a key
 * that is too tight costs one model call. So this drops case, accents,
 * punctuation, and bare numbers — "Cost (2024)", "COST 2023" and "cost" are one
 * header — and stops there.
 *
 * What it deliberately does *not* do is expand abbreviations. "Acq Cost" and
 * "Acquisition Cost" stay two keys. Folding them would be right almost always,
 * and the almost is a guess about words we do not have to guess about.
 */
export function headerFingerprint(header: string | null | undefined): string | null {
  if (!header) return null;

  const tokens = header
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token !== '' && !/^\d+$/.test(token));

  const key = tokens.join(' ');
  // A single letter is a spreadsheet column stub ("A", "B"), not a header.
  return key.length >= 2 ? key : null;
}

/** One sheet's header row, as text, by column index. */
export interface SheetHeaders {
  sheetName: string;
  /** Column index → header cell; null where the cell is blank. */
  headers: (string | null)[];
}

/** A header the firm has settled, as `mapping_memory` stores it. */
export interface HeaderMemoryRecord {
  fingerprint: string;
  sampleHeader: string;
  field: CanonicalAssetField;
  confirmations: number;
  conflicted: boolean;
  conflictingField: CanonicalAssetField | null;
}

/** A header decision worth remembering, harvested from a confirmed mapping. */
export interface HeaderDecision {
  fingerprint: string;
  sampleHeader: string;
  field: CanonicalAssetField;
}

const headerRowFor = (mapping: FarMapping | null | undefined, sheetName: string) =>
  mapping?.sheets.find((sheet) => sheet.sheetName === sheetName)?.headerRow ?? null;

/**
 * The header row of every sheet, read from the file itself.
 *
 * Used on confirm, where the whole workbook is in hand — so a header past the
 * preview's fortieth column is still learned from.
 */
export function headersFromWorkbook(
  workbook: ParsedWorkbook,
  mapping: FarMapping,
): SheetHeaders[] {
  return workbook.sheets.map((sheet) => {
    const row = headerRowFor(mapping, sheet.name);
    const cells = row === null ? [] : (sheet.matrix[row] ?? []);
    return {
      sheetName: sheet.name,
      headers: Array.from({ length: sheet.colCount }, (_, index) => formatCell(cells[index])),
    };
  });
}

/**
 * The header row of every sheet, read from the stored preview.
 *
 * Used before anything is confirmed, where the preview is all there is. The
 * mapping's own header row wins when there is one; otherwise the parser's
 * guess stands, because a hint on the wrong row is visibly wrong to a reviewer
 * and no hint at all is just the old behaviour.
 */
export function headersFromSummaries(
  summaries: SheetSummary[],
  mapping?: FarMapping | null,
): SheetHeaders[] {
  return summaries.map((summary) => {
    const row = headerRowFor(mapping, summary.name) ?? summary.detectedHeaderRow;
    const cells = row === null ? [] : (summary.preview[row] ?? []);
    return { sheetName: summary.name, headers: [...cells] };
  });
}

/**
 * What a confirmed mapping is entitled to teach.
 *
 * Three restrictions, each one a case where remembering would be worse than
 * forgetting:
 *
 *   - **Only included sheets.** Nobody decided the columns of a rollforward
 *     they excluded; the fields left null there are untouched defaults, not
 *     judgements.
 *   - **Only mapped columns.** A confirmed `null` cannot be told apart from a
 *     column the reviewer never looked at, and the grid starts every column at
 *     null. Learning those would fill memory with junk headers and — worse —
 *     manufacture conflicts against headers that map perfectly well elsewhere.
 *   - **Nothing a file contradicts itself about.** A register with two columns
 *     headed "Cost", one confirmed as original cost and one as net book value,
 *     has told us the header does not decide the field. Remembering either
 *     answer would be picking a side of an argument the file just lost.
 */
export function harvestHeaderDecisions(
  sheets: SheetHeaders[],
  mapping: FarMapping,
): HeaderDecision[] {
  const found = new Map<string, { sampleHeader: string; field: CanonicalAssetField } | null>();

  for (const sheet of mapping.sheets) {
    if (!sheet.include) continue;
    const headers = sheets.find((s) => s.sheetName === sheet.sheetName)?.headers;
    if (!headers) continue;

    for (const column of sheet.columns) {
      if (column.field === null) continue;
      const header = headers[column.index] ?? null;
      const fingerprint = headerFingerprint(header);
      if (fingerprint === null || header === null) continue;

      const prior = found.get(fingerprint);
      if (prior === undefined) {
        found.set(fingerprint, { sampleHeader: header, field: column.field });
      } else if (prior !== null && prior.field !== column.field) {
        // Self-contradiction within one file. Poison the key for this harvest.
        found.set(fingerprint, null);
      }
    }
  }

  return [...found.entries()]
    .filter((entry): entry is [string, { sampleHeader: string; field: CanonicalAssetField }] =>
      entry[1] !== null,
    )
    .map(([fingerprint, decision]) => ({ fingerprint, ...decision }));
}

/**
 * What the firm already knows about the headers in front of it.
 *
 * A hint is an observation, never an action: it says "people here have pointed
 * this header at original cost nine times", and the model, the reviewer, and
 * the fill button each decide separately what to do with that. Conflicted rows
 * are hints too — a header two reviewers have settled differently is precisely
 * the one worth flagging on the screen, and the callers are the ones that know
 * whether to assert it (the prompt does not) or show it (the grid does).
 */
export function headerHints(
  sheets: SheetHeaders[],
  memory: readonly HeaderMemoryRecord[],
): MappingMemoryHint[] {
  const byFingerprint = new Map(memory.map((record) => [record.fingerprint, record]));
  const hints: MappingMemoryHint[] = [];

  for (const sheet of sheets) {
    sheet.headers.forEach((header, index) => {
      const fingerprint = headerFingerprint(header);
      if (fingerprint === null || header === null) return;
      const record = byFingerprint.get(fingerprint);
      if (!record) return;
      hints.push({
        sheetName: sheet.sheetName,
        index,
        header,
        field: record.field,
        confirmations: record.confirmations,
        conflicted: record.conflicted,
        conflictingField: record.conflictingField,
      });
    });
  }

  return hints;
}

/** Every distinct fingerprint in these header rows — the memory lookup key set. */
export function headerFingerprints(sheets: SheetHeaders[]): string[] {
  const keys = new Set<string>();
  for (const sheet of sheets) {
    for (const header of sheet.headers) {
      const fingerprint = headerFingerprint(header);
      if (fingerprint !== null) keys.add(fingerprint);
    }
  }
  return [...keys];
}

/**
 * Where a proposal contradicts a header the firm has settled.
 *
 * Only unconflicted memory speaks here, and only about columns the proposal
 * actually mapped somewhere else or left empty on a sheet it kept. The output
 * is for a reviewer to read, not for anything to apply — the model saw the
 * rows and memory saw a string, and on the occasions those disagree the model
 * is often right. The point is that a person gets told, rather than the
 * disagreement being invisible.
 */
export function memoryDisagreements(
  mapping: FarMapping,
  hints: readonly MappingMemoryHint[],
): MappingMemoryHint[] {
  const included = new Map(
    mapping.sheets.filter((sheet) => sheet.include).map((sheet) => [sheet.sheetName, sheet]),
  );

  return hints.filter((hint) => {
    if (hint.conflicted) return false;
    const sheet = included.get(hint.sheetName);
    if (!sheet) return false;
    const column = sheet.columns.find((c) => c.index === hint.index);
    // A column the mapping does not mention at all is not a disagreement — the
    // grid lists every column, so this is only reachable for a partial mapping.
    if (!column) return false;
    return column.field !== hint.field;
  });
}
