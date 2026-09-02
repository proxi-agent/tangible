import { acquisitionYear, business, site, totalCost } from '../business.js';
import type { CorpusAsset, CorpusEntry } from '../types.js';
import { grouped } from '../registers/format.js';
import { paper, type Pen } from './page.js';

/** The year the return covers: property owned on January 1, 2026. */
const TAX_YEAR = 2026;
const COL = { year: 300, count: 380, cost: 520 };

/**
 * Last year's rendition, as the client filed it themselves.
 *
 * A prior return is the single most useful document a client can send, and the
 * least reliable. It is what the district has on file, so it is the baseline
 * every carry-forward comparison is drawn against — and it was prepared by
 * somebody in a hurry with a deadline, so what it says is not what the register
 * says.
 *
 * Three disagreements are printed into this one, all of them the kind that
 * survive for years because nobody re-reads a filed return:
 *
 * The Katy warehouse is not on it. One account, one location, and the second
 * site — real, leased, full of racking and a forklift — has never been rendered
 * at all. That is not a saving; it is exposure, and it is exactly what a
 * comparison against a register covering both sites is for.
 *
 * Schedule E is filed in one lump against "Various" rather than by year
 * acquired. The form asks for the year, the district's schedule *is* a function
 * of the year, and a lump filed as Various gets valued at whatever the district
 * assumes — which is never the taxpayer's best case.
 *
 * The printed total does not equal the lines above it. Two digits are
 * transposed. The extraction rule is to transcribe what is printed and never to
 * compute a total that is already on the page, which is what makes the
 * disagreement visible instead of silently corrected — a return whose total is
 * wrong by $9,000 is a fact about the filing, not a typo to be helpfully fixed.
 */
export function priorRenditionEntry(): CorpusEntry {
  const one = business('ironwood');
  const where = site(one, 'hou');
  const rendered = one.assets.filter(
    (asset) => asset.siteId === 'hou' && acquisitionYear(asset) < TAX_YEAR,
  );
  const vehicles = rendered.filter((asset) => asset.kind === 'vehicle');
  const scheduleE = rendered.filter((asset) => asset.kind !== 'vehicle');
  const supplies = 18500;

  /** The lines as they add up, and the number actually typed on the form. */
  const honest = totalCost(scheduleE) + totalCost(vehicles) + supplies;
  const printed = honest + 9000;

  return {
    id: 'ironwood-prior-rendition',
    filename: '2026 rendition as filed (signed).pdf',
    kind: 'rendition',
    format: 'pdf',
    businessId: one.id,
    source: 'Form 50-144 for tax year 2026, self-prepared and filed by the client',
    jurisdictions: ['TX — Harris'],
    premise:
      "The prior year's Texas rendition as the client filed it: one location, Schedule E filed against Various, and a total that does not foot.",
    traps: [
      'The Katy warehouse is absent — the client has two locations and has ever only rendered one.',
      'Schedule E is a single line against "Various" instead of a cost by year acquired.',
      'The printed grand total is $9,000 more than its own lines add to.',
      'It is a scan of a signed form, so every figure is printed rather than tagged.',
      'The figures are as of January 1, 2026, so everything bought since is missing by design, not by error.',
    ],
    expectation: {
      autopilot: 'holds',
      because:
        'A prior return is read and proposed, never applied. What it disagrees with the register about is the finding, and a finding is somebody’s to confirm.',
    },
    mapping: null,
    truth: null,
    build: async () => {
      const pen = await paper();
      heading(pen, where.account ?? '', printed);
      pen.line('SCHEDULE E — FURNITURE, FIXTURES, MACHINERY, EQUIPMENT AND COMPUTERS', {
        bold: true,
      });
      pen.line('Historical cost when new and year acquired.', { grey: true, size: 8.5 });
      pen.gap(0.5);
      pen.at(COL.year - 40, 'YEAR ACQ.', { bold: true, size: 8 });
      pen.right(COL.count, 'QTY', { bold: true, size: 8 });
      pen.right(COL.cost, 'HISTORICAL COST', { bold: true, size: 8 });
      pen.rule();
      pen.at(54, 'Machinery, equipment and computers', { mono: true });
      pen.at(COL.year - 40, 'Various', { mono: true });
      pen.right(COL.count, String(scheduleE.length), { mono: true });
      pen.right(COL.cost, grouped(totalCost(scheduleE)), { mono: true });
      pen.line();
      pen.rule();
      pen.at(54, 'Total Schedule E', { bold: true });
      pen.right(COL.cost, grouped(totalCost(scheduleE)), { bold: true });
      pen.line();
      pen.gap(1.5);

      pen.line('SCHEDULE D — VEHICLES, TRAILERS AND SPECIAL EQUIPMENT', { bold: true });
      pen.gap(0.5);
      for (const vehicle of vehicles) pen.line(...vehicleLine(vehicle));
      pen.rule();
      pen.at(54, 'Total Schedule D', { bold: true });
      pen.right(COL.cost, grouped(totalCost(vehicles)), { bold: true });
      pen.line();
      pen.gap(1.5);

      pen.line('SCHEDULE C — SUPPLIES', { bold: true });
      pen.at(54, 'Shop and office consumables on hand January 1', { mono: true });
      pen.right(COL.cost, grouped(supplies), { mono: true });
      pen.line();
      pen.gap(1.5);

      pen.rule();
      pen.at(54, 'TOTAL HISTORICAL COST — ALL SCHEDULES', { bold: true, size: 10 });
      pen.right(COL.cost, grouped(printed), { bold: true, size: 10 });
      pen.line();
      pen.gap(2);
      signature(pen);
      return pen.save();
    },
  };
}

function vehicleLine(vehicle: CorpusAsset): [string, { mono: true }] {
  return [
    `${acquisitionYear(vehicle)}   ${vehicle.description}`.padEnd(60) +
      grouped(vehicle.cost).padStart(14),
    { mono: true },
  ];
}

function heading(pen: Pen, account: string, printed: number): void {
  pen.line('CONFIDENTIAL', { bold: true, size: 8, grey: true });
  pen.line('GENERAL REAL ESTATE RENDITION OF TAXABLE PROPERTY', {
    bold: true,
    size: 8,
    grey: true,
  });
  pen.line('BUSINESS PERSONAL PROPERTY RENDITION OF TAXABLE PROPERTY', { bold: true, size: 13 });
  pen.line('Form 50-144    Harris County Appraisal District    Tax Year 2026', { size: 8.5 });
  pen.gap(1);
  pen.rule();
  pen.line('Owner: IRONWOOD FABRICATION GROUP, LP', { mono: true });
  pen.line('Property address: 4410 Bingle Rd, Houston, TX 77092', { mono: true });
  pen.line(`Appraisal district account number: ${account}`, { mono: true });
  pen.line('Property is: [X] owned by me   [ ] held by me but owned by another', { mono: true });
  pen.line(
    'Basis of rendition: [X] historical cost and year acquired   [ ] good faith estimate of market value',
    { mono: true, size: 8.5 },
  );
  pen.line(`Total historical cost reported: $${grouped(printed)}`, { mono: true });
  pen.rule();
  pen.gap(0.5);
}

function signature(pen: Pen): void {
  pen.line(
    'I swear that the information provided on this form is true and correct to the best of my knowledge and belief.',
    { size: 8.5 },
  );
  pen.gap(1.5);
  pen.line('_______________________________________          ______________________', {
    grey: true,
  });
  pen.line('D. Whitfield, Controller                          03/28/2026', { mono: true });
  pen.gap(1);
  pen.line(
    'Filed by the property owner. No notarization required (Tax Code 22.24(c)) — the rendition is filed on',
    { size: 8, grey: true },
  );
  pen.line('cost and year acquired rather than on a good faith estimate of market value.', {
    size: 8,
    grey: true,
  });
}
