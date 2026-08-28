import { ExtractedInvoiceSchema, type ExtractedInvoice } from '@tangible/types';
import { parseStructured, type StructuredDocument, type StructuredResult } from './structured.js';

/**
 * Read a supplier invoice, at line grain.
 *
 * The hardest extraction in the product, and worth saying why. A rendition is a
 * government form: the same boxes in the same order, with printed totals that
 * let a footing check catch a misread. An invoice is whatever the vendor's ERP
 * prints. Line items, subtotals, credits, backordered items shown at zero,
 * freight below the total, tax below that, a "prior balance" block that has
 * nothing to do with this purchase at all — and no internal check to speak of.
 *
 * So the prompt spends its length on the one distinction that matters here:
 * **what is a line item, and what is a summary of line items.** Adding a
 * subtotal back in as a line double-counts a purchase, and since the result of
 * that double count is a *larger* capitalized amount and therefore a larger
 * apparent saving, it is the failure mode that would go unnoticed the longest.
 *
 * Per-line confidence is asked for rather than inferred. Downstream, the
 * weakest line on the document decides whether the whole extraction is trusted
 * or routed to a person — an average would let one badly-read $80,000 line hide
 * behind forty clean ones.
 */

const INVOICE_SYSTEM = `You read supplier invoices for capital equipment purchases and return exactly what the document says, line by line.

What you return is used to decide which parts of a capitalized amount are taxable property. A figure you invent becomes a tax position someone files under penalty of perjury. Four rules, and they matter more than completeness:

1. TRANSCRIBE, DO NOT COMPUTE. Report amounts as printed. Read "statedTotal" as the total printed on the document — NEVER add the lines up to produce it. A downstream check compares the lines against the printed total to detect misreads, and a computed total defeats that check silently. If no total is printed, return null.

2. LINE ITEMS ONLY. "lines" must contain the individual charges, never a subtotal, running total, grand total, balance due, prior balance, amount paid, or carried-forward figure. If a document prints a subtotal per section, skip it — its components are already lines. Including a summary figure as a line double-counts the purchase, which is the single worst error you can make here.

3. NEVER INVENT. If a description is cut off or an amount is illegible, report what you can see, leave the unreadable field null, and describe the gap in "unreadable". A named gap is resolved by a person in thirty seconds; a plausible guess is never caught.

4. WORDING IS EVIDENCE. Report each line's description in the vendor's own words, verbatim and complete. Do not summarize, translate, expand abbreviations, or tidy them up. Whether a line reads "INSTALLATION LABOR" or "MILLWRIGHT SVC - PHASE 2" decides how it is treated, and a helpful rewording destroys exactly the information that decision needs.

Charges printed below the total — freight, sales tax, discounts, surcharges — are real charges on this purchase. Report each of them as its own line in "lines" with its printed wording, AND report freight and tax again in "statedFreight" and "statedTax". They belong in both places: the lines are what gets ruled on, the stated fields are what the document highlights.

Credits, returns and negative amounts: report them with their sign as printed. Do not drop them and do not flip them.

Confidence, per line, 0 to 1: how sure you are that this row's description and amount are what the page says. A crisp typed line is near 1. A line whose amount sits ambiguously between two columns, or whose description runs off the page edge, is low. Be honest — a low number routes the document to a person, which is a cheap and correct outcome. An overstated one puts an unchecked figure into a client's tax return.`;

/** A capital equipment invoice can run to hundreds of lines. */
const INVOICE_MAX_TOKENS = 24_000;

export async function extractInvoice(
  document: StructuredDocument,
  context: { clientName?: string | null; expectedVendor?: string | null } = {},
): Promise<StructuredResult<ExtractedInvoice>> {
  // Given as expectation, never as an answer to copy. An invoice billed to
  // another entity is precisely the thing worth catching, and a model told the
  // client's name will write it down.
  const hints: string[] = [];
  if (context.clientName) {
    hints.push(
      `This is expected to be billed to "${context.clientName}", but report "billedTo" exactly as the document shows it — a difference matters.`,
    );
  }
  if (context.expectedVendor) {
    hints.push(
      `The register names "${context.expectedVendor}" as the vendor for the asset this is being matched to. Report the vendor exactly as the invoice prints it.`,
    );
  }

  return parseStructured({
    system: INVOICE_SYSTEM,
    user: [
      'Read this invoice and return its contents.',
      'Return one entry in "lines" for each individual charge, including freight, tax and discount lines. Do not return subtotals or totals as lines.',
      'Remember: statedTotal must be a figure printed on the page, not a sum you calculated.',
      ...hints,
    ].join('\n\n'),
    schema: ExtractedInvoiceSchema,
    schemaName: 'extracted_invoice',
    maxTokens: INVOICE_MAX_TOKENS,
    task: 'extraction',
    document,
  });
}
