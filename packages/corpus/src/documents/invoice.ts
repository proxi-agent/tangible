import type { CorpusEntry } from '../types.js';
import { grouped } from '../registers/format.js';
import { paper, type Pen } from './page.js';

interface Line {
  label: string;
  amount: number;
  note?: string;
}

/** What the seller charged, in the seller's order and the seller's words. */
const LINES: readonly Line[] = [
  { label: 'AMADA HFE3-1303S PRESS BRAKE, 130 TON X 10FT', amount: 214500 },
  { label: 'AMNC 3i CONTROL PACKAGE', amount: 18750 },
  { label: 'FREIGHT — HOUSTON, TX (FOB ORIGIN)', amount: 4380 },
  { label: 'RIGGING, PLACEMENT AND ANCHORING', amount: 9250 },
  { label: 'INSTALLATION, LEVELING AND RUN-OFF', amount: 6800 },
  { label: 'OPERATOR TRAINING — 2 DAYS ONSITE', amount: 3200, note: 'not a cost of the asset' },
  { label: 'EXTENDED SERVICE PLAN — 36 MONTHS', amount: 7400, note: 'not a cost of the asset' },
  {
    label: 'TRADE-IN ALLOWANCE — 1998 CINCINNATI 90-TON',
    amount: -22000,
    note: 'does not reduce cost',
  },
];

const TAX_RATE = 0.0825;

/**
 * The invoice, which is what a client sends when asked what something cost.
 *
 * It answers a different question from the one the return asks, and it does so
 * in a way that looks like the same question. Original cost when new is what
 * was paid to put the asset in service: the machine, the control package, the
 * freight, the rigging, the installation, and — in Texas — the sales tax, which
 * is part of cost rather than an expense. The training and the service plan are
 * on the same invoice, in the same column, and are neither. The trade-in
 * allowance reduces what the client wrote a cheque for and does not reduce the
 * cost of the press by a dollar.
 *
 * So there are four defensible numbers on this page and only one of them is
 * right. The invoice total is wrong because it is net of a trade-in and
 * includes services. The subtotal is wrong for the same second reason. The
 * cheque amount is the most wrong and the most likely to be the one a client
 * reads out over the phone.
 *
 * This is the pre-capitalization question in its natural habitat: the asset is
 * not on any register yet, and what gets typed into the cost column here is what
 * the district will value for the next ten years.
 */
export function invoiceEntry(): CorpusEntry {
  const subtotal = LINES.reduce((sum, line) => sum + line.amount, 0);
  const taxable = LINES.filter((line) => line.note === undefined).reduce(
    (sum, line) => sum + line.amount,
    0,
  );
  const tax = Math.round(taxable * TAX_RATE * 100) / 100;

  return {
    id: 'ironwood-invoice',
    filename: 'GCMT invoice 88214 - press brake.pdf',
    kind: 'invoice',
    format: 'pdf',
    businessId: 'ironwood',
    source: 'Gulf Coast Machine Tools — invoice for a 2027 capital purchase',
    jurisdictions: ['TX — Harris'],
    premise:
      'A machine tool invoice sent in answer to "what did the press cost?" — with four different totals on it and one correct answer.',
    traps: [
      'Freight, rigging and installation are part of original cost when new; training and the service plan are not.',
      'Texas sales tax is part of the cost of the asset, not an expense — and it is computed on some lines and not others.',
      'The trade-in allowance reduces the amount paid and reduces the new asset’s cost by nothing.',
      'The invoice date is December 22 and the run-off is signed January 6 — the asset was not in service on January 1.',
      'The traded-in press is still on the register, and this page is the only evidence it left.',
    ],
    expectation: {
      autopilot: 'holds',
      because:
        'Nothing on it is a register. It is evidence about one asset, and what it is worth depends on which of its lines belong in cost — which is a judgement, made once, that lasts as long as the asset does.',
    },
    mapping: null,
    truth: null,
    build: async () => {
      const pen = await paper();
      pen.line('GULF COAST MACHINE TOOLS, INC.', { bold: true, size: 13 });
      pen.line('11402 Brittmoore Park Dr, Houston, TX 77041   ·   (713) 466-0100', {
        size: 8.5,
        grey: true,
      });
      pen.gap(1);
      pen.line('INVOICE', { bold: true, size: 12 });
      pen.rule();
      pen.line('Invoice no.   88214', { mono: true });
      pen.line('Invoice date  12/22/2026', { mono: true });
      pen.line('Terms         NET 30                    P.O.  IW-2026-0441', { mono: true });
      pen.line('Sold to       IRONWOOD FABRICATION GROUP, LP', { mono: true });
      pen.line('Ship to       4410 BINGLE RD, HOUSTON, TX 77092', { mono: true });
      pen.rule();
      pen.gap(1);

      pen.at(54, 'DESCRIPTION', { bold: true, size: 8 });
      pen.right(520, 'AMOUNT', { bold: true, size: 8 });
      pen.rule();
      for (const line of LINES) item(pen, line);
      pen.rule();
      total(pen, 'Subtotal', subtotal);
      total(pen, `Sales tax @ ${(TAX_RATE * 100).toFixed(3)}%`, tax);
      pen.rule();
      total(pen, 'INVOICE TOTAL — AMOUNT DUE', subtotal + tax, true);
      pen.gap(2);
      pen.line('Equipment delivered 12/22/2026. Installation and run-off completed 01/06/2027;', {
        size: 8.5,
      });
      pen.line('acceptance signed by D. Whitfield on that date.', { size: 8.5 });
      pen.gap(1);
      pen.line('Trade-in unit removed from site 12/22/2026. Title transferred to seller.', {
        size: 8.5,
        grey: true,
      });
      return pen.save();
    },
  };
}

function item(pen: Pen, line: Line): void {
  pen.at(54, line.label, { mono: true, size: 8.5 });
  pen.right(520, grouped(line.amount), { mono: true, size: 8.5 });
  pen.line();
}

function total(pen: Pen, label: string, amount: number, bold = false): void {
  pen.at(300, label, { bold, size: bold ? 10 : 9.5 });
  pen.right(520, grouped(amount), { bold, size: bold ? 10 : 9.5 });
  pen.line();
}
