import {
  CorrectionMotionDraftSchema,
  type CorrectionMotionDraft,
  type MotionDraftFacts,
} from '@tangible/types';
import { parseStructured, type StructuredResult } from './structured.js';

/**
 * Draft a Tax Code 25.25 correction motion — from checked facts only.
 *
 * By the time this runs, the deterministic side has already answered the
 * questions that decide whether the motion is worth writing: the route is
 * open, the deadline is ahead, the claim is below the roll, and 25.25(d)'s
 * one-third test passed where (d) is the route. The model's work is the
 * document — a formal motion a review board clerk dockets without questions —
 * and the person signs, files, and then records the filing, exactly as they
 * would have without the draft.
 */

const SYSTEM = `You draft a motion under Texas Tax Code section 25.25, for a business personal property tax practice to file with an appraisal review board.

You are given the checked facts: the property (account, site label, district), the tax year being corrected, the value on the appraisal roll, the value the firm asserts is correct, the subsection being invoked with its citation, grounds, deadline and cost, the firm's own statement of what is wrong, the record's prose account of the year, and any motion already brought on this property and year.

Rules, in order of importance:
- Every figure in the motion must appear in the facts. Never compute a new number, never round one into a different claim.
- The motion invokes exactly the subsection cited in the facts' route, by its cite, and argues only the grounds that subsection reaches. The firm's own statement of the error is the substance — carry it faithfully into formal register; never replace it with a different theory.
- The document is addressed to the appraisal review board for the district named in the facts, identifies the property by account number and tax year, states the value on the roll and the value asserted as correct, and asks the board to correct the roll accordingly.
- Request a hearing on the motion, as section 25.25(e) entitles the movant to.
- Never state or imply that the district or the board has agreed to anything, and never promise an outcome.
- The title names the account, the tax year, and the subsection.
- cautions face the firm, not the board: the filing deadline from the facts; what the route costs where the facts name a cost; that taxes on the undisputed portion must be paid before the delinquency date or the right to a final determination is forfeited; where the year's record rests on an uploaded document, that the district must confirm no protest was determined and no value agreed for the year; anything else in the facts worth confirming before filing. Empty only when there is truly nothing to say, which is rare for a motion.`;

const MOTION_MAX_TOKENS = 3_000;

export async function draftCorrectionMotion(
  facts: MotionDraftFacts,
): Promise<StructuredResult<CorrectionMotionDraft>> {
  return parseStructured({
    system: SYSTEM,
    user: `Draft the correction motion from these checked facts:\n\n${JSON.stringify(facts, null, 2)}`,
    schema: CorrectionMotionDraftSchema,
    schemaName: 'correction_motion_draft',
    maxTokens: MOTION_MAX_TOKENS,
    task: 'mapping',
  });
}
