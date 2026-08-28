import { ScheduleDraftSchema, type ScheduleDraft } from '@tangible/types';
import { parseStructured, type StructuredResult } from './structured.js';

/**
 * Read an appraisal district's published valuation guide and draft the rule.
 *
 * The model transcribes and cites. It does not decide anything: it never
 * chooses a life for a category, never fills a cell the document does not
 * contain, and never values a piece of property. Its output is a table and a
 * citation, which the deterministic side then checks against invariants that
 * hold for every published schedule — percent good falls as an asset ages, an
 * index factor rises as the year gets older, a life class covers a continuous
 * run of years — and renders into a source file a person reads and commits.
 *
 * The point of the split is that the failure mode of a model on a numeric table
 * is a plausible number in the right place. Review alone does not catch that;
 * three hundred cells is not something a person checks by eye. Arithmetic and a
 * golden do.
 */

const SYSTEM = `You transcribe a county appraisal district's published business personal property valuation guide into structured data, for a tax firm that will review and commit it.

You are given the text of a published guide. Produce the tables it contains, exactly as printed.

Rules, in order of importance:
- Never invent a figure. If a cell is unreadable, missing from the excerpt, or ambiguous, leave it out and describe precisely what is missing in gaps — which table, which life class, which years. A gap is a normal outcome and blocks nothing but approval; a fabricated cell is the worst thing you can do here.
- Transcribe percent good as the guide prints it: whole numbers 0-100, not fractions.
- Transcribe index factors as printed, to the decimal places printed.
- Life classes are lives in years. Special schedules are the guide's own named ones (personal computers, telecom, solar and so on) — use the guide's own short name.
- SIC profiles are the guide's business-line table: the code, the district's own wording for it, and the lives it assigns.
- citation must name the document, the division that publishes it, the tax year, and the pages the tables appear on, and the statutory authority for the method if the guide states one. It is quoted verbatim in workpapers and in front of an appraisal review board, so it must be checkable.
- effectiveFrom and effectiveTo are the window the guide itself governs — for an annual guide, the tax year it is issued for. Never leave effectiveTo open on an annual guide.
- notes is for what a reviewer should look at: a table that changed shape from a prior year, a footnote that qualifies a column, a category the guide handles unusually.
- Never write code, never restate the arithmetic, and never value an example asset.`;

const DRAFT_MAX_TOKENS = 16_000;

export async function draftSchedule(input: {
  jurisdictionId: string;
  jurisdictionName: string;
  taxYear: number;
  sourceTitle: string;
  sourceUrl: string | null;
  /** The guide's text, extracted from the PDF. */
  guideText: string;
}): Promise<StructuredResult<ScheduleDraft>> {
  return parseStructured({
    system: SYSTEM,
    user: [
      `District: ${input.jurisdictionName} (${input.jurisdictionId})`,
      `Tax year: ${input.taxYear}`,
      `Document: ${input.sourceTitle}${input.sourceUrl ? ` — ${input.sourceUrl}` : ''}`,
      '',
      'Guide text:',
      input.guideText,
    ].join('\n'),
    schema: ScheduleDraftSchema,
    schemaName: 'schedule_draft',
    maxTokens: DRAFT_MAX_TOKENS,
    task: 'mapping',
  });
}
