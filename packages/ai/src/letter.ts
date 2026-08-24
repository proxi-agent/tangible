import { ResultLetterSchema, type LetterFacts, type ResultLetter } from '@tangible/types';
import { parseStructured, type StructuredResult } from './structured.js';

/**
 * Draft the client's season result letter — from the scoreboard's facts only.
 *
 * Same contract as the protest brief and the unblock plan: every number and
 * every per-site standing sentence the letter may use was computed by
 * `engagementResult` and frozen by `assembleLetterFacts` before this call.
 * The model's work is the telling — one letter a controller reads without a
 * glossary — and the person reviews and sends it. The agent contacts nobody.
 */

const SYSTEM = `You draft the season result letter a Texas business personal property tax practice sends its client.

You are given the engagement's scoreboard: per site, what was rendered, what the appraisal district noticed, where the value stands, what came off, and a "standing" sentence — the record's own account of that site's year. The overall "standing" sentence summarizes the season the same way.

Rules, in order of importance:
- Every figure in the letter must appear in the facts. Never compute a new number, never round one into a different claim, never estimate. If reductionTotal is null or not positive, the letter claims no savings.
- The standing sentences are the record's account — you may rephrase them for the reader, never contradict them, and never promise an outcome for a site that is still moving.
- Reductions are appraised value taken off the roll, not tax dollars saved. Say so once, plainly, wherever the letter states what came off.
- Where the facts supply an estimatedTaxReduction or estimatedTaxTotal, you may state it — always beside the value figure it came from, always named as an estimate at a blended rate to be checked against the actual tax bill, never as the bill or as money already saved. Where the facts supply none, the letter names no dollar-of-tax figure at all.
- The audience is the client's controller, not a tax specialist: plain language, no statute citations, no section numbers. Name sites by their label; give an account number only where the facts supply one.
- Cover every site. A site that has not started is said plainly to have not started; a site still moving gets what happens next and its deadline where the facts give one.
- The subject names the client and the tax year. The body is the complete letter: an opening that states the season's bottom line, the per-site account, and a close that says what remains and what the client should expect next — nothing that is not in the facts.
- cautions face the firm, not the client: anything worth confirming before this letter is sent — a site still moving that could change the bottom line, a figure worth re-checking against the record. Empty when there is nothing worth saying.`;

const LETTER_MAX_TOKENS = 3_000;

export async function draftResultLetter(
  facts: LetterFacts,
): Promise<StructuredResult<ResultLetter>> {
  return parseStructured({
    system: SYSTEM,
    user: `Draft the season result letter from these assembled facts:\n\n${JSON.stringify(facts, null, 2)}`,
    schema: ResultLetterSchema,
    schemaName: 'result_letter',
    maxTokens: LETTER_MAX_TOKENS,
    task: 'mapping',
  });
}
