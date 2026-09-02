import { describe, expect, it } from 'vitest';
import { parseWorkbook } from './parse.js';
import { decodeText } from './text.js';

/**
 * The encoding is the first thing the pipeline decides and the one it used to
 * get silently wrong.
 *
 * What makes this worth its own suite is the failure shape. A misdecoded
 * register does not fail — every digit in it is ASCII, so the costs foot, the
 * totals match, the mapping verifies and the file imports. Only the words are
 * destroyed, and they are destroyed on the way to a return a person signs. So
 * these tests are mostly about the words surviving while the numbers are used
 * to prove nothing else moved.
 */

const bytes = (...values: number[]) => new Uint8Array(values);

/** "Müller Präzision GmbH" as a Windows desktop package writes it. */
const CP1252_VENDOR = bytes(
  0x4d,
  0xfc,
  0x6c,
  0x6c,
  0x65,
  0x72,
  0x20,
  0x50,
  0x72,
  0xe4,
  0x7a,
  0x69,
  0x73,
  0x69,
  0x6f,
  0x6e,
  0x20,
  0x47,
  0x6d,
  0x62,
  0x48,
);

const utf8 = (text: string) => new TextEncoder().encode(text);

function utf16le(text: string, bom = true): Uint8Array {
  const source = bom ? `﻿${text}` : text;
  const out = new Uint8Array(source.length * 2);
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    out[i * 2] = code & 0xff;
    out[i * 2 + 1] = code >> 8;
  }
  return out;
}

describe('decodeText', () => {
  it('reads a CP-1252 export as CP-1252, not as damaged UTF-8', () => {
    const decoded = decodeText(CP1252_VENDOR);
    expect(decoded.encoding).toBe('windows-1252');
    expect(decoded.text).toBe('Müller Präzision GmbH');
    expect(decoded.text).not.toContain('�');
  });

  it('reads UTF-8 as UTF-8 and drops its byte-order mark', () => {
    const decoded = decodeText(bytes(0xef, 0xbb, 0xbf, ...utf8('Tag,Cost')));
    expect(decoded.encoding).toBe('utf-8');
    expect(decoded.text).toBe('Tag,Cost');
  });

  /**
   * The case that decides the order of the two attempts. These bytes are legal
   * in both encodings — CP-1252 would read them as "Ã¼" — so preferring valid
   * UTF-8 is what keeps a correctly-exported file from being mangled in the
   * name of rescuing a badly-exported one.
   */
  it('prefers UTF-8 wherever the bytes are valid UTF-8', () => {
    const decoded = decodeText(utf8('Müller Präzision GmbH'));
    expect(decoded.encoding).toBe('utf-8');
    expect(decoded.text).toBe('Müller Präzision GmbH');
  });

  /** Excel's own "Unicode Text" export, which is UTF-16 and says so. */
  it('reads UTF-16 in both byte orders', () => {
    expect(decodeText(utf16le('Tag\tCost'))).toEqual({ text: 'Tag\tCost', encoding: 'utf-16le' });
    const be = bytes(0xfe, 0xff, 0x00, 0x54, 0x00, 0x61, 0x00, 0x67);
    expect(decodeText(be)).toEqual({ text: 'Tag', encoding: 'utf-16be' });
  });

  it('reads plain ASCII and an empty file as UTF-8', () => {
    expect(decodeText(utf8('Tag,Cost\n1,2\n')).encoding).toBe('utf-8');
    expect(decodeText(bytes())).toEqual({ text: '', encoding: 'utf-8' });
  });
});

describe('parseWorkbook over delimited text', () => {
  /**
   * End to end, because the encoding is only interesting where it reaches a
   * cell. The costs are asserted alongside the descriptions on purpose: they
   * were never the thing at risk, and they are what made the old behaviour so
   * hard to catch.
   */
  it('carries the accents of a CP-1252 register through to the cells', () => {
    const rows = [
      'Tag,Description,Vendor,Cost',
      'M-01,Press brake,Müller Präzision GmbH,"214,500.00"',
      'M-02,Lathe,Société Générale Outillage,"88,750.00"',
      'M-03,Grinder,Nyström & Co.,"12,400.00"',
    ].join('\r\n');

    const cp1252 = new Uint8Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const code = rows.charCodeAt(i);
      // Every character here is either ASCII or Latin-1, where CP-1252 and the
      // code point agree.
      cp1252[i] = code;
    }

    const [sheet] = parseWorkbook(cp1252).sheets;
    const vendors = (sheet?.matrix ?? []).slice(1).map((row) => row[2]);
    expect(vendors).toEqual([
      'Müller Präzision GmbH',
      'Société Générale Outillage',
      'Nyström & Co.',
    ]);
    expect((sheet?.matrix ?? []).slice(1).map((row) => row[3])).toEqual([
      '214,500.00',
      '88,750.00',
      '12,400.00',
    ]);
  });

  it('reads a UTF-16 workbook exported from Excel', () => {
    const text = 'Tag\tDescription\tCost\nM-01\tPress brake\t214500\n';
    const [sheet] = parseWorkbook(utf16le(text)).sheets;
    expect(sheet?.matrix[0]).toEqual(['Tag', 'Description', 'Cost']);
    expect(sheet?.matrix[1]).toEqual(['M-01', 'Press brake', '214500']);
  });
});
