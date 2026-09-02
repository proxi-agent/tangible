import { describe, expect, it } from 'vitest';
import { applyMapping, parseWorkbook, verifyMapping } from '@tangible/far';
import { business, totalCost } from './business.js';
import { CORPUS, corpusEntry } from './catalog.js';

/**
 * The corpus grading itself.
 *
 * Every entry states, before it is rendered, how many assets are on it and what
 * they cost — taken from the business definition the file was printed from,
 * never from the file. So this suite is not "does the parser agree with
 * itself"; it is "does the parser recover the facts the client actually has",
 * which is the only question a register file exists to answer.
 *
 * Where an entry declares no truth it is because the file is deliberately
 * unrecoverable — a paginated printout with headers inside the data, a summary
 * with no asset on it — and inventing a number to assert would be asserting the
 * mess rather than the facts.
 */

const registers = CORPUS.filter((entry) => entry.kind === 'register');

describe('the corpus renders', () => {
  for (const entry of CORPUS) {
    it(`builds ${entry.filename}`, async () => {
      const bytes = await entry.build();
      expect(bytes.byteLength).toBeGreaterThan(64);
      // Well under the platform's 4 MB request ceiling, or it cannot be uploaded.
      expect(bytes.byteLength).toBeLessThan(4 * 1024 * 1024);
    });
  }
});

describe('every register parses back to the facts it was printed from', () => {
  for (const entry of registers) {
    const { mapping, truth } = entry;
    if (mapping === null || truth === null) continue;

    it(`${entry.id} recovers ${truth.assetCount} assets`, async () => {
      const workbook = parseWorkbook(await entry.build());
      const output = applyMapping(workbook, mapping);
      expect(output.assets).toHaveLength(truth.assetCount);
    });

    if (truth.totalCost !== null) {
      it(`${entry.id} recovers its cost to the cent`, async () => {
        const workbook = parseWorkbook(await entry.build());
        const output = applyMapping(workbook, mapping);
        const sum = output.assets.reduce((total, asset) => total + (asset.originalCost ?? 0), 0);
        expect(Math.round(sum * 100) / 100).toBe(truth.totalCost);
      });
    }

    it(`${entry.id} maps the sheets it says it does`, async () => {
      const workbook = parseWorkbook(await entry.build());
      const included = mapping.sheets.filter((sheet) => sheet.include).map((s) => s.sheetName);
      expect(included).toEqual([...truth.includedSheets]);
      for (const name of included) {
        expect(workbook.sheets.map((sheet) => sheet.name)).toContain(name);
      }
    });
  }
});

/**
 * The deterministic checks, run over the whole set.
 *
 * This is the assertion the corpus was built to make. Every entry declares
 * whether the mapping a competent reviewer would confirm survives verification
 * — and the two files whose entries say `holds` are files where it must not,
 * because a mapping that verifies on a paginated printout with unreadable dates
 * is a mapping that has stopped measuring anything.
 */
describe('verification agrees with what each entry expects', () => {
  for (const entry of registers) {
    const { mapping } = entry;
    if (mapping === null) continue;

    it(`${entry.id} verifies ${entry.expectation.autopilot === 'clears' ? 'clean' : 'with a failure'}`, async () => {
      const workbook = parseWorkbook(await entry.build());
      const result = verifyMapping(workbook, mapping);
      const failures = result.checks.filter((check) => !check.ok).map((check) => check.check);
      if (entry.expectation.autopilot === 'clears') {
        expect(failures).toEqual([]);
      } else {
        expect(failures.length).toBeGreaterThan(0);
      }
    });
  }
});

/**
 * The finding the corpus was built to produce, and then the fix for it.
 *
 * Delimited text used to be decoded as UTF-8 and only as UTF-8, so a CP-1252
 * export — which is what every Windows desktop accounting package writes — lost
 * every character above 0x7F. The numbers are ASCII and survived, which is what
 * made it quiet: the file parsed, footed, mapped and imported, and the only
 * damage was to the words a preparer reads when deciding what an asset is.
 *
 * `decodeText` now works the encoding out from the bytes. This asserts the
 * whole shape of that: the accents come through, nothing is a replacement
 * character, and the costs still foot — because the costs were never what was
 * at risk, and a fix that moved them would be a worse bug than the one it
 * replaced.
 */
describe('the CP-1252 export', () => {
  it('keeps its accented vendor names, and its costs', async () => {
    const entry = corpusEntry('ironwood-additions');
    const workbook = parseWorkbook(await entry.build());
    const output = applyMapping(workbook, entry.mapping!);
    const vendors = output.assets.map((asset) => asset.vendor ?? '');

    expect(vendors.some((vendor) => vendor.includes('M\u00fcller Pr\u00e4zision'))).toBe(true);
    expect(vendors.some((vendor) => vendor.includes('Soci\u00e9t\u00e9 G\u00e9n\u00e9rale'))).toBe(
      true,
    );
    expect(vendors.some((vendor) => vendor.includes('Nystr\u00f6m'))).toBe(true);
    expect(vendors.some((vendor) => vendor.includes('\ufffd'))).toBe(false);

    const sum = output.assets.reduce((total, asset) => total + (asset.originalCost ?? 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(entry.truth!.totalCost);
  });
});

/**
 * The finding the date fix uncovered by getting out of its way, and then the
 * fix for that.
 *
 * A printed schedule repeats its page header every twenty rows, and those lines
 * were always being read as assets. What hid them was the other defect: every
 * date on the file was unreadable, so every row warned, the warning rate failed,
 * and the file was held for a reason that had nothing to do with page
 * furniture. Reading "14-Mar-2020" removed the noise and left nine rows out of
 * eighty-nine that were not assets — and, because page headers carry no cost,
 * a file that footed to the cent while being wrong about its own row count.
 *
 * Both are fixed, and this asserts the pair of them together on the file that
 * carries both: the dates read on every row, and the row count is the row count.
 * The costs are asserted too, though they were never at risk either time — they
 * are what makes this shape of bug survivable, and therefore what makes it
 * invisible to every check that measures money.
 */
describe('the printed schedule', () => {
  it('reads eighty assets from a hundred-and-thirteen-line report', async () => {
    const entry = corpusEntry('halcyon-assetkeeper');
    const workbook = parseWorkbook(await entry.build());
    const output = applyMapping(workbook, entry.mapping!);
    const one = business('halcyon');

    expect(output.assets).toHaveLength(one.assets.length);

    const sum = output.assets.reduce((total, asset) => total + (asset.originalCost ?? 0), 0);
    expect(Math.round(sum * 100) / 100).toBe(totalCost(one.assets));

    // The nine repeats are skipped by name rather than lost silently.
    const furniture = output.skipped.filter((row) => row.reason.includes('page header'));
    expect(furniture).toHaveLength(9);

    // Every spelled-out date read, and nothing was left to warn about.
    expect(output.assets.filter((asset) => asset.acquisitionDate !== null)).toHaveLength(
      one.assets.length,
    );
    expect(output.assets.flatMap((asset) => asset.warnings)).toEqual([]);
  });
});
