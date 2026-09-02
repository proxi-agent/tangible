/**
 * Turning a client's bytes into text.
 *
 * This is the first interpretation the pipeline makes and the easiest one to
 * make silently wrong. A register exported from a Windows desktop package is
 * CP-1252, not UTF-8, and decoding it as UTF-8 damages exactly the cells a
 * person reads and none of the cells a machine checks: "Müller Präzision" comes
 * out as replacement characters while every cost, date and total survives
 * intact. The file then parses, foots, maps, clears the unattended bar and
 * imports — a description that is now mojibake rides all the way onto a return
 * with nothing anywhere reporting a problem.
 *
 * So the encoding is decided from evidence rather than assumed:
 *
 * - A byte-order mark is proof. UTF-16 in particular cannot be guessed at from
 *   content — half its bytes are NUL — and Excel's own "Unicode Text" export
 *   writes it, so a BOM decides the question outright.
 * - Otherwise UTF-8 is *tried*, strictly. Valid UTF-8 is not an accident: the
 *   multi-byte sequences are self-describing, and a CP-1252 file with any
 *   high byte in it will almost always fail the check. Passing is enough to
 *   accept.
 * - Only when strict UTF-8 rejects the bytes does CP-1252 take over. It maps
 *   every one of the 256 bytes to a character, so it cannot fail in turn —
 *   which is why it must be the fallback and never the first guess.
 *
 * The one case this reads wrong is a *truncated* UTF-8 file, where a sequence
 * cut off mid-character fails the strict pass and the whole file is then read
 * as CP-1252. That trades one replacement character for a page of mojibake, on
 * a file that is already corrupt — and a corrupt upload is worth noticing
 * loudly rather than accommodating quietly.
 */

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

function startsWith(data: Uint8Array, magic: number[]): boolean {
  return magic.every((byte, i) => data[i] === byte);
}

/** What {@link decodeText} concluded, so a caller can say so. */
export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface DecodedText {
  text: string;
  encoding: TextEncodingName;
}

/**
 * Decode delimited text, reporting which encoding was used. The BOM is removed
 * whichever way it arrived — a leading U+FEFF is invisible in a spreadsheet but
 * would otherwise be part of the first header's name.
 */
export function decodeText(data: Uint8Array): DecodedText {
  const encoding = detectEncoding(data);
  const text = new TextDecoder(encoding).decode(data).replace(/^﻿/, '');
  return { text, encoding };
}

function detectEncoding(data: Uint8Array): TextEncodingName {
  if (startsWith(data, UTF16LE_BOM)) return 'utf-16le';
  if (startsWith(data, UTF16BE_BOM)) return 'utf-16be';
  if (startsWith(data, UTF8_BOM)) return 'utf-8';
  return validUtf8(data) ? 'utf-8' : 'windows-1252';
}

/**
 * Does every byte form a well-formed UTF-8 sequence? `fatal` makes the decoder
 * throw on the first malformed one rather than substituting U+FFFD, which is
 * the whole question being asked here.
 */
function validUtf8(data: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return true;
  } catch {
    return false;
  }
}
