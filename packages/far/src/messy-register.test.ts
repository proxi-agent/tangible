import { describe, expect, it } from 'vitest';
import {
  MESSY_REGISTER_FACTS,
  MESSY_REGISTER_MAPPING,
  MESSY_REGISTER_SHEETS,
  messyRegisterMatrix,
  messyRegisterWorkbook,
} from './fixtures/messy-register.js';
import { applyMapping } from './normalize.js';
import { verifyMapping } from './verify.js';

/**
 * The register rehearsal.
 *
 * Every other test in this package hands `applyMapping` a shape chosen to
 * exercise one rule. This one hands it a whole register — title block, bands,
 * subtotals, a grand total, three hundred rows and a page footer — and asks the
 * only question a client's file will ask: did the assets come out right, and is
 * everything that did not come out accounted for?
 */

const run = () => applyMapping(messyRegisterWorkbook(), MESSY_REGISTER_MAPPING);

const expectedAssetCount = MESSY_REGISTER_FACTS.assetsPerBand.reduce((a, b) => a + b, 0);

describe('a register with the mess a real one has', () => {
  it('reads only the sheet the mapping includes', () => {
    const out = run();
    const sheets = new Set(out.assets.map((a) => a.sourceSheet));
    expect([...sheets]).toEqual([MESSY_REGISTER_SHEETS.detail]);
  });

  it('says how many rows sat above the header', () => {
    const out = run();
    expect(out.skipped).toContainEqual({
      sheet: MESSY_REGISTER_SHEETS.detail,
      row: -1,
      reason: `${MESSY_REGISTER_FACTS.titleBlockRows} non-empty rows above the header row were not read`,
    });
  });

  it('takes every asset row and nothing else', () => {
    const out = run();
    expect(out.assets).toHaveLength(expectedAssetCount);
  });

  it('recognises the band headers and hands their category down', () => {
    const out = run();
    const bands = out.skipped.filter((s) => s.reason.startsWith('section header'));
    expect(bands).toHaveLength(MESSY_REGISTER_FACTS.bands.length);

    // Every asset knows which band it sat under, and the first band's rows are
    // not carrying the last band's name.
    const categories = new Set(out.assets.map((a) => a.category));
    const alphabetical = (a: string, b: string) => a.localeCompare(b);
    expect([...categories].sort(alphabetical)).toEqual(
      [...MESSY_REGISTER_FACTS.bands].sort(alphabetical),
    );
    expect(out.assets[0]?.category).toBe(MESSY_REGISTER_FACTS.bands[0]);
    expect(out.assets.at(-1)?.category).toBe(MESSY_REGISTER_FACTS.bands.at(-1));
  });

  it('skips the subtotals rather than counting them as assets', () => {
    const out = run();
    const totals = out.skipped.filter((s) => s.reason === 'subtotal/total row');
    // One per band, plus the grand total.
    expect(totals).toHaveLength(MESSY_REGISTER_FACTS.bands.length + 1);
  });

  it('foots each band to the subtotal the register printed for it', () => {
    const out = run();

    // The one assertion that catches every cost mistake at once: a misread
    // number, a subtotal counted as an asset, a dropped row and a doubled row
    // all show up as a band that no longer adds up to its own printed total.
    const printed = new Map(
      messyRegisterMatrix()
        .filter((row) => typeof row[1] === 'string' && row[1].startsWith('Total '))
        .map((row) => [
          String(row[1])
            .replace(/^Total /, '')
            .toUpperCase(),
          Number(row[4]),
        ]),
    );
    expect(printed.size).toBe(MESSY_REGISTER_FACTS.bands.length);

    for (const [band, subtotal] of printed) {
      const read = out.assets
        .filter((a) => a.category?.toUpperCase() === band)
        .reduce((sum, a) => sum + (a.originalCost ?? 0), 0);
      expect(Math.round(read * 100) / 100).toBeCloseTo(subtotal, 2);
    }
  });

  it('parses costs however the register typed them', () => {
    const out = run();
    const unparsed = out.assets.filter((a) => a.originalCost === null);
    expect(unparsed).toHaveLength(0);
  });

  it('reads a parenthesised disposal as a credit and says so', () => {
    const out = run();
    const disposed = out.assets.filter((a) => a.isDisposed);
    expect(disposed.length).toBeGreaterThan(0);
    const credit = disposed.find((a) => (a.originalCost ?? 0) < 0);
    expect(credit).toBeDefined();
    expect(credit?.warnings).toContain('negative cost — credit or adjustment row?');
  });

  it('keeps a duplicated asset tag rather than collapsing the rows', () => {
    const out = run();
    const dupes = out.assets.filter((a) => a.assetTag === MESSY_REGISTER_FACTS.duplicateTag);
    expect(dupes).toHaveLength(2);
  });

  it('keeps the rows a register left half-filled, with the gap named', () => {
    const out = run();
    expect(out.assets.some((a) => a.assetTag === null)).toBe(true);
    const nameless = out.assets.filter((a) => a.description === null);
    expect(nameless).toHaveLength(1);
    expect(nameless[0]?.warnings).toContain('no description');
  });

  it('flags the rows whose date the register would not commit to', () => {
    const out = run();
    const undated = out.assets.filter((a) => a.acquisitionYear === null);
    expect(undated.length).toBeGreaterThan(0);
    for (const asset of undated) expect(asset.warnings).toContain('no acquisition date or year');
  });

  it('foots the whole column against the section totals when no grand total is printed', () => {
    const { checks } = verifyMapping(messyRegisterWorkbook(), MESSY_REGISTER_MAPPING);
    const foots = checks.find((c) => c.check === 'foots');
    // The register prints seven section totals and a grand total that says "see
    // attached". Footing the column against the biggest single section would
    // fail every correct mapping of a banded register.
    expect(foots?.ok).toBe(true);
    expect(foots?.detail).toContain('section totals');
  });

  it('leaves nothing skipped without a reason', () => {
    const out = run();
    for (const skip of out.skipped) expect(skip.reason.trim()).not.toBe('');
  });
});
