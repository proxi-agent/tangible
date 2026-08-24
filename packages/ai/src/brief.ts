import {
  ProtestBriefSchema,
  type ProtestBrief,
  type ProtestBriefFacts,
} from '@tangible/types';
import { parseStructured, type StructuredResult } from './structured.js';

/**
 * Draft the protest argument from assembled facts — and only from them.
 *
 * The division of labor is strict: `assembleBriefFacts` in the filing package
 * decided every number before this call happens, and the drafted brief is a
 * proposal a person reads before anything is filed. The model's job is the
 * part models are for — turning a record into an argument a board will
 * follow — and the system prompt spends most of its words on what it must
 * not do: invent a figure, cite a statute at a fact that does not support
 * it, or argue a position the engagement dropped.
 */

const SYSTEM = `You draft the protest brief for a Texas business personal property notice of appraised value, for a tax agent to review before filing under Tax Code Chapter 41.

You are given the assembled facts: what the firm rendered, what the district answered, the finding positions behind the firm's number, and the clocks. Draft from those facts and nothing else.

Rules, in order of importance:
- Never invent or adjust a number. Every figure in the brief must appear in the facts. valueRequested is the filed schedule value when one exists, and null when none does — never an estimate.
- If overAssessment is negative or zero, say plainly that the notice is at or below the rendered value and that a value protest is not supported; the brief may still address a penalty.
- Grounds should map to Tax Code 41.41 where they fit — excessive appraisal (41.41(a)(1)) and unequal appraisal (41.41(a)(2)) are the usual ones for personal property — but claim only what the facts support. A rendition filed on time supports arguing any 22.28 penalty was applied in error; say so under penaltyRequest, not as a value ground.
- Positions with status "pending-client" or null are open questions, not settled arguments: mention them in gaps as evidence to firm up before the hearing, and do not rest a ground on them alone.
- Write for a hearing: concise, factual, no rhetoric. Each ground's support field names the specific facts it rests on.
- gaps lists what is still missing before a hearing — unanswered positions, evidence to gather, a value the notice did not print. An empty list means the record is hearing-ready.`;

const BRIEF_MAX_TOKENS = 3_000;

export async function draftProtestBrief(
  facts: ProtestBriefFacts,
): Promise<StructuredResult<ProtestBrief>> {
  return parseStructured({
    system: SYSTEM,
    user: `Draft the protest brief from these assembled facts:\n\n${JSON.stringify(facts, null, 2)}`,
    schema: ProtestBriefSchema,
    schemaName: 'protest_brief',
    maxTokens: BRIEF_MAX_TOKENS,
    task: 'mapping',
  });
}
