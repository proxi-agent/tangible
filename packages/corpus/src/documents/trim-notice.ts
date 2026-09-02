import { business, site, totalCost } from '../business.js';
import type { CorpusEntry } from '../types.js';
import { grouped } from '../registers/format.js';
import { paper, type Pen } from './page.js';

interface Levy {
  authority: string;
  lastRate: number;
  proposedRate: number;
  hearing: string;
}

const LEVIES: readonly Levy[] = [
  {
    authority: 'HILLSBOROUGH COUNTY BOCC',
    lastRate: 6.2224,
    proposedRate: 6.2224,
    hearing: 'Sep 9, 2027 5:01 PM',
  },
  {
    authority: 'HILLSBOROUGH COUNTY SCHOOL BOARD',
    lastRate: 6.313,
    proposedRate: 6.164,
    hearing: 'Jul 28, 2027 5:05 PM',
  },
  {
    authority: 'CITY OF TAMPA',
    lastRate: 6.2076,
    proposedRate: 6.2076,
    hearing: 'Sep 16, 2027 5:01 PM',
  },
  {
    authority: 'SOUTHWEST FLORIDA WATER MGMT DIST',
    lastRate: 0.1909,
    proposedRate: 0.1818,
    hearing: 'Sep 14, 2027 5:15 PM',
  },
];

/**
 * Florida's notice, which is four notices in one envelope.
 *
 * Texas sends a value and a deadline. Florida sends a value, four taxing
 * authorities each with their own proposed rate and their own public hearing on
 * their own evening, and one deadline that belongs to none of them: the
 * petition to the Value Adjustment Board, due 25 days after this notice was
 * mailed.
 *
 * Every date on the page is a real date and only one of them is the one that
 * matters. The hearings are where a rate is set and are not appealable; the
 * petition window is where a *value* is contested and closes before three of
 * the four hearings have even happened. A reader that takes the latest printed
 * date for the deadline has thrown the appeal away, and a reader that takes the
 * earliest has thrown it away sooner.
 *
 * The deadline is also not printed as a date. It is printed as a rule — 25 days
 * — which is the shape a clock takes when nobody at the district wants to
 * commit to arithmetic.
 */
export function trimNoticeEntry(): CorpusEntry {
  const one = business('coastal');
  const where = site(one, 'tampa');
  const assessed = Math.round(
    totalCost(
      one.assets.filter((asset) => asset.siteId === 'tampa' && asset.kind !== 'inventory'),
    ) * 0.48,
  );

  return {
    id: 'coastal-trim',
    filename: 'TRIM 2027 Hillsborough.pdf',
    kind: 'notice',
    format: 'pdf',
    businessId: one.id,
    source: 'Hillsborough County — Notice of Proposed Property Taxes (TRIM), 2027',
    jurisdictions: ['FL — Hillsborough'],
    premise:
      'The Florida TRIM notice: four taxing authorities, four hearing dates, and one petition deadline stated as a rule rather than a date.',
    traps: [
      'The deadline is "25 days after the mailing of this notice", so the date has to be computed from the mailing date.',
      'Four public hearing dates are printed and none of them is the deadline.',
      'Three of the hearings fall after the petition window has already closed.',
      'Rates are in mills, not percent — 6.2224 mills is 0.62224%, and the factor-of-ten error is invisible in a total.',
      'It says on its face that it is not a bill, which is the sentence clients most often read as one.',
    ],
    expectation: {
      autopilot: 'holds',
      because:
        'The one deadline it sets is arithmetic on a printed mailing date, and a clock computed by a machine and confirmed by nobody is how an appeal gets missed.',
    },
    mapping: null,
    truth: null,
    build: async () => {
      const pen = await paper();
      pen.line('NOTICE OF PROPOSED PROPERTY TAXES', { bold: true, size: 14 });
      pen.line('AND PROPOSED OR ADOPTED NON-AD VALOREM ASSESSMENTS', { bold: true, size: 10 });
      pen.line('DO NOT PAY — THIS IS NOT A BILL', { bold: true, size: 11 });
      pen.gap(1);
      pen.rule();
      pen.line('Hillsborough County Property Appraiser   —   Mailed August 19, 2027', {
        mono: true,
      });
      pen.line('COASTAL PROVISIONS CO.', { mono: true });
      pen.line(`Tangible personal property account ${where.account}`, { mono: true });
      pen.line(`${where.street}, ${where.city}, FL ${where.zip}`, { mono: true });
      pen.line(`Assessed value of tangible personal property:  ${grouped(assessed)}`, {
        mono: true,
      });
      pen.rule();
      pen.gap(1);

      pen.line('TAXING AUTHORITIES', { bold: true });
      pen.gap(0.5);
      pen.at(54, 'AUTHORITY', { bold: true, size: 8 });
      pen.right(360, 'LAST YEAR', { bold: true, size: 8 });
      pen.right(430, 'PROPOSED', { bold: true, size: 8 });
      pen.at(450, 'PUBLIC HEARING', { bold: true, size: 8 });
      pen.rule();
      for (const levy of LEVIES) levies(pen, levy, assessed);
      pen.rule();
      pen.gap(1.5);

      pen.line('IF YOU FEEL THE MARKET VALUE OF YOUR PROPERTY IS INACCURATE', { bold: true });
      pen.line(
        'contact the Property Appraiser at (813) 272-6100. If you and the Property Appraiser cannot agree,',
        { size: 8.5 },
      );
      pen.line(
        'you may file a petition with the Value Adjustment Board. THE PETITION MUST BE FILED WITHIN 25 DAYS',
        { size: 8.5 },
      );
      pen.line(
        'OF THE MAILING OF THIS NOTICE. A $15.00 filing fee is payable to the Clerk of the Circuit Court.',
        { size: 8.5 },
      );
      pen.gap(1);
      pen.line(
        'The public hearings above are where the taxing authorities adopt their rates. They are not appeals,',
        { size: 8, grey: true },
      );
      pen.line('and attending one does not preserve any right to contest your value.', {
        size: 8,
        grey: true,
      });
      return pen.save();
    },
  };
}

function levies(pen: Pen, levy: Levy, assessed: number): void {
  pen.at(54, levy.authority, { mono: true, size: 8.5 });
  pen.right(360, grouped((assessed * levy.lastRate) / 1000), { mono: true, size: 8.5 });
  pen.right(430, grouped((assessed * levy.proposedRate) / 1000), { mono: true, size: 8.5 });
  pen.at(450, levy.hearing, { mono: true, size: 8 });
  pen.line();
}
