import { acquisitionYear, business, site, totalCost } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { grouped } from '../registers/format.js';
import { paper } from './page.js';

/** The Florida return is filed as of January 1; 2026 covers what was owned then. */
const TAX_YEAR = 2026;

/**
 * Florida's return, filed for one of two counties.
 *
 * The DR-405 asks a different question from the Texas form and the difference
 * is the whole reason this is in the set. It wants original installed cost by
 * year acquired, and it wants three things Texas either does not ask for or
 * asks for elsewhere: property the taxpayer holds but does not own, listed with
 * the lessor's name and address; inventory, which is excluded outright rather
 * than valued at nothing; and a $25,000 exemption that is claimed per return
 * rather than per taxpayer.
 *
 * That last one is why the Miami-Dade half of this client is not on this page.
 * Two counties are two returns, two accounts, and two exemptions — and a
 * taxpayer with a $25,000 exemption they never claimed in the second county has
 * been paying tax on the first $25,000 there for as long as the branch has been
 * open. The document shows only the county it was filed in, which is exactly
 * how the omission stays invisible: nothing on the page it is missing from says
 * anything is missing.
 */
export function dr405Entry(): CorpusEntry {
  const one = business('coastal');
  const where = site(one, 'tampa');
  const owned = one.assets.filter(
    (asset) =>
      asset.siteId === 'tampa' &&
      asset.kind !== 'leased' &&
      asset.kind !== 'inventory' &&
      acquisitionYear(asset) < TAX_YEAR,
  );
  const leased = one.assets.filter((asset) => asset.siteId === 'tampa' && asset.kind === 'leased');
  const years = [...new Set(owned.map(acquisitionYear))].sort((a, b) => b - a);
  const total = totalCost(owned);

  return {
    id: 'coastal-dr405',
    filename: 'DR-405 Hillsborough 2026 FILED.pdf',
    kind: 'rendition',
    format: 'pdf',
    businessId: one.id,
    source: 'Florida Form DR-405, tangible personal property tax return for 2026',
    jurisdictions: ['FL — Hillsborough'],
    premise:
      "Last year's Florida return for the Tampa distribution center — one of the client's two counties.",
    traps: [
      'The $25,000 exemption is claimed per return, and the client’s second county return does not exist.',
      'Inventory is excluded rather than valued at zero, so its absence from the page is correct and looks like an omission.',
      'Leased equipment is listed with the lessor named and no value — reported, not rendered.',
      'Cost is asked for by year acquired, so a register that carries only a total cannot answer this form.',
      'The Miami-Dade account appears nowhere on it, which is how a missing second return stays missing.',
    ],
    expectation: {
      autopilot: 'holds',
      because:
        'It is a prior return: read, compared against this year’s register, and turned into a proposal somebody confirms.',
    },
    mapping: null,
    truth: null,
    build: async () => {
      const pen = await paper();
      pen.line('DR-405, R. 01/18   Rule 12D-16.002, F.A.C.', { size: 8, grey: true });
      pen.line('TANGIBLE PERSONAL PROPERTY TAX RETURN', { bold: true, size: 13 });
      pen.line('HILLSBOROUGH COUNTY PROPERTY APPRAISER   —   Return year 2026', { size: 9 });
      pen.gap(1);
      pen.rule();
      pen.line('Taxpayer:            COASTAL PROVISIONS CO.', { mono: true });
      pen.line(`Account number:      ${where.account}`, { mono: true });
      pen.line(`Physical location:   ${where.street}, ${where.city}, FL ${where.zip}`, {
        mono: true,
      });
      pen.line('Business type:       WHOLESALE FOOD DISTRIBUTION      FEIN: 59-XXXXXXX', {
        mono: true,
      });
      pen.line('Return due April 1, 2026. Filed 03/26/2026.', { mono: true });
      pen.rule();
      pen.gap(1);

      pen.line('ORIGINAL INSTALLED COST BY YEAR ACQUIRED', { bold: true });
      pen.line('Include freight, installation and sales tax. Do not include inventory held for', {
        size: 8.5,
        grey: true,
      });
      pen.line('sale, which is exempt under s. 192.001(11)(d), F.S.', { size: 8.5, grey: true });
      pen.gap(0.5);
      pen.at(64, 'YEAR', { bold: true, size: 8 });
      pen.right(300, 'ITEMS', { bold: true, size: 8 });
      pen.right(470, 'ORIGINAL COST', { bold: true, size: 8 });
      pen.rule();
      for (const year of years) {
        const block = owned.filter((asset) => acquisitionYear(asset) === year);
        pen.at(64, String(year), { mono: true });
        pen.right(300, String(block.length), { mono: true });
        pen.right(470, grouped(totalCost(block)), { mono: true });
        pen.line();
      }
      pen.rule();
      pen.at(64, 'TOTAL', { bold: true });
      pen.right(470, grouped(total), { bold: true });
      pen.line();
      pen.gap(1.5);

      pen.line('PROPERTY LEASED, LOANED OR RENTED FROM OTHERS', { bold: true });
      pen.line(
        'Report here. Do not include in the totals above — the lessor renders this property.',
        {
          size: 8.5,
          grey: true,
        },
      );
      pen.gap(0.5);
      for (const asset of leased) {
        pen.line(`${asset.description.padEnd(46)}${asset.vendor ?? ''}`, { mono: true, size: 8.5 });
      }
      pen.gap(1.5);

      pen.line('EXEMPTION', { bold: true });
      pen.line('$25,000 exemption claimed on this return (s. 196.183, F.S.)   [X] yes   [ ] no', {
        mono: true,
      });
      pen.line(`Taxable value after exemption:  ${grouped(Math.max(0, total - 25000))}`, {
        mono: true,
      });
      pen.gap(2);
      pen.line(
        'Under penalties of perjury, I declare that I have read this return and the facts stated in it are true.',
        { size: 8.5 },
      );
      pen.gap(1.5);
      pen.line('_______________________________________          ______________________', {
        grey: true,
      });
      pen.line('R. Alvarez, Vice President — Finance              03/26/2026', { mono: true });
      return pen.save();
    },
  };
}
