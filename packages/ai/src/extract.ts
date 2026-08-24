import {
  ExtractedNoticeSchema,
  ExtractedRenditionSchema,
  RENDITION_SCHEDULES,
  type ExtractedNotice,
  type ExtractedRendition,
} from '@tangible/types';
import { parseStructured, type StructuredDocument, type StructuredResult } from './structured.js';

/**
 * Read a filed rendition or an assessment notice.
 *
 * The one model call in this product whose answer is *checked* rather than
 * trusted. A rendition prints a total for each schedule and a grand total for
 * the form, so reading the lines and the printed totals independently gives
 * `verifyRendition` a real test to run: a misread figure produces a form that no
 * longer adds up. That changes what the prompt has to ask for — the totals must
 * be read as figures on the page, never computed from the lines, or the check
 * proves nothing.
 *
 * Everything else follows the same rule as the rest of the pipeline: report what
 * the document says, name what cannot be read, and never fill a gap. A guessed
 * figure here is worse than a missing one, because this becomes the baseline
 * every later finding is measured against — a fabricated $50,000 line does not
 * show up as an error, it shows up as a saving.
 */

const RENDITION_SYSTEM = `You read filed Texas business personal property tax renditions (Comptroller Form 50-144 and county equivalents) and return exactly what the document says.

You are reading a document someone signed under penalty of perjury, and what you return becomes the baseline another system measures against. Two rules follow, and they matter more than completeness:

1. TRANSCRIBE, DO NOT COMPUTE. Report figures as printed. In particular, read each schedule's printed total and the form's printed grand total as figures on the page. NEVER derive a total by adding up the lines — a downstream check compares your lines against your totals to detect misreads, and a computed total defeats it silently. If a total is not printed or not legible, return null for it. Returning null is correct and useful; a plausible-looking computed number is not.

2. NEVER INVENT. If a figure is smudged, cut off, handwritten illegibly, or on a page that did not scan, leave the field null and describe what you could not read in "unreadable". A gap you name can be resolved by a person in thirty seconds. A gap you fill silently is undetectable.

Structure of the form:
- Schedule A — property under $20,000 total, reported as a single lump with values optional.
- Schedule B — inventory.
- Schedule C — supplies on hand.
- Schedule D — vehicles.
- Schedule E — furniture, fixtures, machinery, equipment and computers, reported BY PROPERTY TYPE AND YEAR ACQUIRED. This is the main schedule and usually has many lines. Each line's year acquired is essential; report it.
- Schedule F — property leased or consigned from others.

Some filers attach a detail listing every asset. If so, report each asset as its own line under the schedule it belongs to; the shape is the same.

The filer chooses to report historical cost with year acquired, OR a good faith estimate of market value, or occasionally both. Report whichever columns the form actually carries, and set "basis" to what you observe. Do not move a figure from one column to the other.

Property type wording: report the filer's own words verbatim ("Mach & Equip", "Shop Equipment", "Computers"). Do not normalize, translate, or interpret them into standard categories — that is a separate decision made by someone else.`;

const NOTICE_SYSTEM = `You read Texas appraisal district notices of appraised value and return exactly what the document says.

Report figures as printed. If a figure is illegible, cut off, or absent, return null and describe what you could not read in "unreadable" — never estimate or infer a value from other figures on the page.

The notice date: report the date the notice itself is dated (usually printed near the header or the mailing block), exactly as printed. It is not the protest deadline and not the appraisal date of the property — it is the date on the document.

The protest deadline: report the date PRINTED on the notice, not the statutory date you might calculate. Districts print a specific date and that is what binds the taxpayer.

Notices often print both the current year's value and the prior year's for comparison; keep them straight and do not swap them. Some notices state that the value was set without a rendition on file, or that a rendition penalty was applied — record that if the document says it, and leave it null if the document is silent rather than inferring it from anything else.`;

/** Renditions run long — a detail schedule can carry hundreds of lines. */
const RENDITION_MAX_TOKENS = 32_000;
const NOTICE_MAX_TOKENS = 4_000;

export async function extractRendition(
  document: StructuredDocument,
  context: { clientName?: string | null; expectedTaxYear?: number | null } = {},
): Promise<StructuredResult<ExtractedRendition>> {
  // Context is given as expectation, never as an answer to copy. A model told
  // "the account is 2349508" will write 2349508 on a form that says otherwise,
  // and an account mismatch is precisely the error worth catching.
  const hints: string[] = [];
  if (context.clientName) {
    hints.push(
      `This is expected to be a filing by "${context.clientName}", but report the owner name exactly as the document shows it — if it differs, that difference matters.`,
    );
  }
  if (context.expectedTaxYear) {
    hints.push(
      `It is expected to be a return from a year before ${context.expectedTaxYear}. Report the year the document states.`,
    );
  }

  return parseStructured({
    system: RENDITION_SYSTEM,
    user: [
      'Read this rendition and return its contents.',
      `Return one entry in "schedules" for each of ${RENDITION_SCHEDULES.join(', ')} that the document actually uses. Omit schedules the form leaves blank rather than returning them empty.`,
      'Remember: statedTotal and statedFormTotal must be figures you read on the page, not sums you calculated.',
      ...hints,
    ].join('\n\n'),
    schema: ExtractedRenditionSchema,
    schemaName: 'extracted_rendition',
    maxTokens: RENDITION_MAX_TOKENS,
    task: 'extraction',
    document,
  });
}

export async function extractNotice(
  document: StructuredDocument,
  context: { clientName?: string | null } = {},
): Promise<StructuredResult<ExtractedNotice>> {
  const hints = context.clientName
    ? [
        `This is expected to relate to "${context.clientName}", but report the owner name exactly as printed — a mismatch is worth knowing about.`,
      ]
    : [];

  return parseStructured({
    system: NOTICE_SYSTEM,
    user: ['Read this notice of appraised value and return its contents.', ...hints].join('\n\n'),
    schema: ExtractedNoticeSchema,
    schemaName: 'extracted_notice',
    maxTokens: NOTICE_MAX_TOKENS,
    task: 'extraction',
    document,
  });
}
