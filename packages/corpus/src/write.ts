import * as XLSX from 'xlsx';

/**
 * Turning rows into the bytes a client would actually send.
 *
 * The interesting part is not the spreadsheet writer, it is the delimited one.
 * A CSV is not a format, it is four decisions — separator, line ending, quoting
 * and encoding — and every accounting system makes them differently. A file
 * exported from a Windows desktop is CP-1252 with CRLF; one from a web app is
 * UTF-8 with a byte order mark; one from a mainframe extract is tab-separated
 * with no quoting at all and a description containing a comma. Reading each of
 * them is a separate thing to get right, so writing each of them is a separate
 * thing this has to be able to do.
 */

export type Cell = string | number | Date | null;

export interface Sheet {
  name: string;
  matrix: Cell[][];
}

export type SpreadsheetFormat = 'xlsx' | 'xlsm' | 'xls';

export function spreadsheet(sheets: readonly Sheet[], format: SpreadsheetFormat): Uint8Array {
  const book = XLSX.utils.book_new();
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(
      book,
      XLSX.utils.aoa_to_sheet(sheet.matrix as unknown[][]),
      sheet.name,
    );
  }
  const bookType = format === 'xls' ? 'biff8' : format;
  return new Uint8Array(XLSX.write(book, { type: 'array', bookType }) as ArrayBuffer);
}

export interface DelimitedOptions {
  delimiter: ',' | '\t' | ';' | '|';
  newline: '\n' | '\r\n';
  encoding: 'utf-8' | 'windows-1252';
  /** A UTF-8 byte order mark, which is what Excel needs to read accents right. */
  bom?: boolean;
  /** Quote every field, the way a few exporters do regardless of content. */
  quoteAll?: boolean;
  /** Emit no quotes at all — a mainframe extract, and a real source of bugs. */
  neverQuote?: boolean;
}

export function delimited(
  rows: readonly (readonly Cell[])[],
  options: DelimitedOptions,
): Uint8Array {
  const lines = rows.map((row) => row.map((cell) => field(cell, options)).join(options.delimiter));
  const text = (options.bom === true ? '﻿' : '') + lines.join(options.newline) + options.newline;
  return options.encoding === 'utf-8' ? new TextEncoder().encode(text) : encodeCp1252(text);
}

function field(cell: Cell, options: DelimitedOptions): string {
  const text = cell === null ? '' : cell instanceof Date ? isoDay(cell) : String(cell);
  if (options.neverQuote === true) return text.replaceAll(options.delimiter, ' ');
  const needs =
    options.quoteAll === true ||
    text.includes(options.delimiter) ||
    text.includes('"') ||
    text.includes('\n') ||
    text.includes('\r');
  return needs ? `"${text.replaceAll('"', '""')}"` : text;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The characters a Windows export actually carries above ASCII.
 *
 * CP-1252 is Latin-1 plus a block at 0x80–0x9F holding the punctuation Word
 * inserts on its own — curly quotes, en and em dashes, the euro. Those are
 * exactly the bytes that arrive in a client's file and exactly the ones a
 * UTF-8 reader turns into replacement characters, so they are the point of
 * having this at all rather than writing everything as UTF-8 and pretending.
 */
const CP1252_HIGH: Readonly<Record<string, number>> = {
  '€': 0x80,
  '‚': 0x82,
  ƒ: 0x83,
  '„': 0x84,
  '…': 0x85,
  '†': 0x86,
  '‡': 0x87,
  ˆ: 0x88,
  '‰': 0x89,
  '‹': 0x8b,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '™': 0x99,
  '›': 0x9b,
};

export function encodeCp1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const code = char.codePointAt(0)!;
    if (code <= 0xff && !(code >= 0x80 && code <= 0x9f)) {
      out[i] = code;
      continue;
    }
    // Anything CP-1252 cannot hold becomes a question mark, which is precisely
    // what the exporter that wrote the file would have done.
    out[i] = CP1252_HIGH[char] ?? 0x3f;
  }
  return out;
}
