import { business, site, totalCost } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { grouped } from '../registers/format.js';
import { paper } from './page.js';

/**
 * The district's notice, which is where every clock the firm runs on starts.
 *
 * One envelope sets three deadlines — the protest, the request for the
 * district's evidence, and the informal window the appraiser will actually
 * meet in — and the printed date on the page is the one thing they are all
 * measured from. So the interesting part of this document is not the value. It
 * is the date, and specifically the disagreement built into it.
 *
 * The notice prints "May 15, 2027" as the protest deadline, because that is
 * what the statute says. May 15, 2027 is a Saturday. Section 1.06 moves a
 * deadline that falls on a weekend to the next regular business day, so the
 * real deadline is Monday the 17th — and a firm that reads the printed date and
 * a firm that computes the date do not have the same calendar. Neither is wrong
 * about the paper. Only one of them is right about the deadline.
 *
 * The value is the other half. It carries the prior year beside the proposed
 * year, which is the comparison that decides whether there is anything to
 * protest at all, and it is stated as a market value the district reached from
 * its own schedule rather than from anything the client rendered.
 */
export function noticeEntry(): CorpusEntry {
  const one = business('ironwood');
  const where = site(one, 'hou');
  const cost = totalCost(one.assets.filter((asset) => asset.siteId === 'hou'));
  const prior = Math.round((cost * 0.42) / 10) * 10;
  const proposed = Math.round((cost * 0.55) / 10) * 10;

  return {
    id: 'ironwood-notice',
    filename: 'HCAD notice 2027 - 0421030000018.pdf',
    kind: 'notice',
    format: 'pdf',
    businessId: one.id,
    source: 'Harris CAD — Notice of Appraised Value, tax year 2027',
    jurisdictions: ['TX — Harris'],
    premise:
      'The 2027 notice on the Houston account, printing a protest deadline that falls on a Saturday.',
    traps: [
      'The printed deadline is May 15, 2027 — a Saturday, which section 1.06 moves to Monday the 17th.',
      'The notice date and the deadline are both printed, and the later of the two rules applies.',
      'The value shown is the district’s, reached from its own schedule, not from anything rendered.',
      'The account number appears twice in different formats, once hyphenated and once not.',
      'It is a scan, so the value box is a picture of a table rather than a table.',
    ],
    expectation: {
      autopilot: 'holds',
      because:
        'A notice is extracted and proposed, never recorded on its own — the clocks it starts are confirmed by a person, because a wrong date here is a missed protest.',
    },
    mapping: null,
    truth: null,
    build: async () => {
      const pen = await paper();
      pen.line('HARRIS COUNTY APPRAISAL DISTRICT', { bold: true, size: 12 });
      pen.line('13013 Northwest Freeway, Houston, Texas 77040   (713) 812-5800', {
        size: 8.5,
        grey: true,
      });
      pen.gap(1);
      pen.line('2027 NOTICE OF APPRAISED VALUE', { bold: true, size: 14 });
      pen.line('This is NOT a tax bill.', { size: 9, grey: true });
      pen.gap(1);
      pen.rule();
      pen.line('Date of this notice:  April 15, 2027', { mono: true });
      pen.line(`Account number:       ${where.account}`, { mono: true });
      pen.line('Owner:                IRONWOOD FABRICATION GROUP LP', { mono: true });
      pen.line('Property:             BPP — MACHINE SHOP / FABRICATION', { mono: true });
      pen.line('Location:             4410 BINGLE RD, HOUSTON TX 77092', { mono: true });
      pen.rule();
      pen.gap(1);

      pen.line('VALUE INFORMATION', { bold: true });
      pen.gap(0.5);
      pen.box(54, 470, 62);
      pen.at(64, 'Tax year', { bold: true, size: 8.5 });
      pen.right(360, 'Market value', { bold: true, size: 8.5 });
      pen.right(500, 'Appraised value', { bold: true, size: 8.5 });
      pen.line();
      pen.at(64, '2026 (last year)', { mono: true });
      pen.right(360, grouped(prior), { mono: true });
      pen.right(500, grouped(prior), { mono: true });
      pen.line();
      pen.at(64, '2027 (proposed)', { mono: true });
      pen.right(360, grouped(proposed), { mono: true });
      pen.right(500, grouped(proposed), { mono: true });
      pen.line();
      pen.gap(2.5);

      pen.line('DEADLINE TO FILE A PROTEST', { bold: true });
      pen.line('May 15, 2027', { mono: true, size: 12 });
      pen.line(
        'or 30 days after the date this notice was mailed, whichever is later. A protest filed after the',
        { size: 8.5 },
      );
      pen.line('deadline will not be heard by the Appraisal Review Board.', { size: 8.5 });
      pen.gap(1);
      pen.line('iFile number: 4471-9082-3316   File online at hcad.org/ifile', { mono: true });
      pen.gap(1);
      pen.line(
        'You may request the evidence the district intends to introduce at the hearing (Tax Code 41.461).',
        { size: 8.5, grey: true },
      );
      pen.line('Account 04-2103-0000-018    Appraisal Review Board, P.O. Box 922004, Houston TX', {
        size: 8.5,
        grey: true,
      });
      return pen.save();
    },
  };
}
