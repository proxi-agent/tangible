import { AssistantAnswerSchema, type AssistantAnswer, type AssistantScope } from '@tangible/types';
import {
  runToolLoop,
  type AgentTool,
  type AgentToolExecutor,
  type AgentTurn,
  type ToolLoopResult,
} from './agent.js';
import { parseStructured, type StructuredResult } from './structured.js';

/**
 * The assistant's two calls.
 *
 * First it researches: a bounded tool loop where the model asks for what it
 * needs from the firm's record, the county warehouse, and the statutory
 * corpus. Then it composes: one schema-enforced call that turns what came back
 * into an answer with citations and limits.
 *
 * Splitting them is the point. A single loop that also had to produce the
 * final JSON would give up schema enforcement — neither provider will enforce
 * an output schema on a turn that is also allowed to call tools — and the
 * answer's shape is the part that must not vary. This way the research is free
 * to be messy and the answer is not, and the composing call sees only what the
 * tools actually returned, so it cannot quietly answer from what the model
 * happens to know about Texas property tax.
 */

const RESEARCH_SYSTEM = `You are the research half of an assistant inside Tangible, a workspace for a Texas business personal property tax practice. Your reader is a preparer at the firm, not their client.

Your job in this phase is to gather facts, not to write an answer. Use the tools to find what the question needs, then stop. Something else turns what you gathered into prose.

How to work:
- Call tools. Do not answer from memory. Anything you assert later has to come back from a tool on this turn, including statutory rules — search_knowledge is how you get those, and an unsearched statute cite is a fabrication.
- Start broad, then narrow. Find the client or the account first, then read what hangs off it. Ids from one tool are the arguments for the next.
- You can call several tools at once when they do not depend on each other. Do that rather than spending a step on each.
- The page the preparer is on is given to you. A question that says "this client" or "these returns" means that page's client or engagement; if there is no page context and the question is ambiguous, look up what you can and let the answer say what was ambiguous.
- Three kinds of source and they are not interchangeable. The workspace is the firm's own record — clients, registers, findings, filings, notices, protests. The market is the county's public appraisal roll, which never contains rendition contents. Knowledge is the statutory and product corpus. When a question touches value on both sides, get both: what the district assessed and what the client's own record says are different numbers.
- search_precedent is the firm's prior work — briefs it filed, motions it brought, notes preparers left — with what became of each. It is history, not authority: it is where you learn how an argument was worded and whether it worked, never where you learn what the law is. Search it whenever the question is about arguing, wording, drafting, or what happened last time, and search it alongside search_knowledge rather than instead of it.
- If a tool returns nothing, that is a finding. Do not re-run it with the same arguments hoping for a different result, and do not substitute a guess.
- Stop as soon as you have enough. Extra calls cost the preparer time.

When you are done gathering, reply with a short note on what you found and what you could not. Do not write the final answer.`;

const COMPOSE_SYSTEM = `You write the assistant's answer inside Tangible, a workspace for a Texas business personal property tax practice. Your reader is a preparer at the firm, not their client — statutory references and terms of art are fine, and preferred over paraphrase.

You are given the preparer's question and the exact results of the lookups that were run for it. Those results are everything you know.

Rules, in order of importance:
- Answer only from the tool results. You may count, sum, and difference over the rows they contain — say what you counted when you do. Never use a figure that is not in them, never estimate, and never fill a gap from general knowledge of Texas property tax. A confident wrong number here becomes a client's filing.
- If the results do not answer the question, say so plainly and name what would — a document, a client answer, a county that has no data loaded, a screen that is still empty. "The record does not hold this" is a good answer and a much better one than a plausible guess.
- Keep the three sources distinct. Say when a value is the district's assessed figure from the public roll and when it is the client's own corrected position; they are different quantities and comparing them is only useful if the reader knows which is which. When a statement rests on a knowledge article that has no statutory authority, it describes how Tangible works, not what Texas requires — say it that way.
- Anything from search_precedent is the firm's own prior work, not law. Never state a rule, a deadline, or a Tax Code requirement on the strength of a brief, a motion, or a preparer's note — those come from search_knowledge alone. When you report what the firm argued, report what came of it in the same breath, including the times it did not work; a precedent quoted without its outcome reads as a recommendation. Say when a document was never answered, which is not the same as having lost.
- Statutory claims must name their statute, and only ones that appeared in the results. Do not cite a section you were not given.
- Figures about a client's register, filings, or findings are confidential under Tax Code 22.27. Answer them for the preparer; never write them into anything phrased as being for an outside reader.
- citations: every result your answer leans on. Use the kind, ref and label exactly as the tool results list them under "Citations available". A citation whose ref does not appear there is dropped by code and counted against the answer, so do not invent one, and do not cite what you did not use.
- limits face the firm: what the lookups could not settle and what would settle it. Empty when the results answered outright. A truncated or capped result belongs here.
- followUps: up to three questions this same assistant could answer next, each a complete question a preparer would actually type. Empty is fine.
- answer is plain prose in short paragraphs. No markdown, no headings, no bullet syntax, no tables. Lead with the answer, then what supports it.`;

/** Enough for a real research pass; short enough that a stuck loop still ends. */
const RESEARCH_MAX_STEPS = 6;
const RESEARCH_MAX_TOKENS = 4_000;
const COMPOSE_MAX_TOKENS = 2_500;

/**
 * How the preparer's location is described to the model.
 *
 * Rendered rather than passed as JSON because it is context, not data: the
 * model should read it the way a colleague reads "I'm on the findings screen
 * for Acme", and a JSON blob invites it to be cited.
 */
export function renderScope(scope: AssistantScope | null): string {
  if (!scope) return 'The preparer did not say what page they are on.';
  const parts = [`The preparer is on ${scope.label ?? scope.path} (${scope.path}).`];
  if (scope.clientId) parts.push(`Client id in scope: ${scope.clientId}.`);
  if (scope.engagementId) parts.push(`Engagement id in scope: ${scope.engagementId}.`);
  if (scope.state || scope.county) {
    parts.push(
      `Market selectors: ${[scope.county, scope.state].filter(Boolean).join(', ') || 'none'}${
        scope.taxYear ? `, tax year ${scope.taxYear}` : ''
      }.`,
    );
  } else if (scope.taxYear) {
    parts.push(`Tax year in scope: ${scope.taxYear}.`);
  }
  return parts.join(' ');
}

export interface AssistantResearchRequest {
  question: string;
  /** Prior turns of this conversation, oldest first, already flattened to text. */
  history: readonly AgentTurn[];
  scope: AssistantScope | null;
  tools: readonly AgentTool[];
  execute: AgentToolExecutor;
  maxSteps?: number;
}

export async function researchAssistantQuestion(
  request: AssistantResearchRequest,
): Promise<ToolLoopResult> {
  return runToolLoop({
    system: `${RESEARCH_SYSTEM}\n\n${renderScope(request.scope)}`,
    messages: [...request.history, { role: 'user', content: request.question }],
    tools: request.tools,
    task: 'mapping',
    maxTokens: RESEARCH_MAX_TOKENS,
    maxSteps: request.maxSteps ?? RESEARCH_MAX_STEPS,
    execute: request.execute,
  });
}

export interface AssistantComposeRequest {
  question: string;
  history: readonly AgentTurn[];
  scope: AssistantScope | null;
  /** The tool results, rendered by the caller — it owns the transcript. */
  evidence: string;
  /** True when the loop hit its step budget, so the answer can say so. */
  incomplete: boolean;
}

export async function composeAssistantAnswer(
  request: AssistantComposeRequest,
): Promise<StructuredResult<AssistantAnswer>> {
  const conversation = request.history.length
    ? `Earlier in this conversation:\n${request.history
        .map((turn) => `${turn.role === 'user' ? 'Preparer' : 'Assistant'}: ${turn.content}`)
        .join('\n\n')}\n\n`
    : '';

  const truncated = request.incomplete
    ? '\n\nThe lookups stopped at their step budget before the research was finished. Say so in limits.'
    : '';

  return parseStructured({
    system: `${COMPOSE_SYSTEM}\n\n${renderScope(request.scope)}`,
    user: `${conversation}Question from the preparer:\n${request.question}\n\nWhat the lookups returned:\n${request.evidence || 'No lookups were run.'}${truncated}`,
    schema: AssistantAnswerSchema,
    schemaName: 'assistant_answer',
    maxTokens: COMPOSE_MAX_TOKENS,
    task: 'mapping',
  });
}
