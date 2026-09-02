import 'server-only';
import { randomUUID } from 'node:crypto';
import {
  aiUnavailableReason,
  composeAssistantAnswer,
  isAiConfigured,
  researchAssistantQuestion,
  type AgentToolInvocation,
  type AgentToolOutcome,
  type AgentTurn,
} from '@tangible/ai';
import {
  precedentKindLabel,
  renderKnowledge,
  renderPrecedent,
  searchKnowledge,
  searchPrecedent,
  tallyPrecedent,
} from '@tangible/knowledge';
import type {
  AssistantAnswer,
  AssistantAskRequest,
  AssistantCitation,
  AssistantToolCall,
  AssistantTurn,
} from '@tangible/types';
import { HttpError } from '@/lib/http';
import { precedentCorpus } from '@/lib/precedent';
import { agentTools, findTool } from './registry';
import { knowledgeCitation, precedentCitation } from './types';
import { recentTurns, recordTurn, resolveConversation } from './store';

/**
 * One turn, end to end: research, compose, validate, store.
 *
 * The order is the point. Code decides what the model may see — the tools are
 * the only way in, and each one validates its own arguments before it runs.
 * The model gathers, then writes. Code then checks every citation against what
 * the tools actually returned and drops the ones nothing backs, the same rule
 * the engagement ask applies to its references. Only then is anything stored.
 *
 * Nothing here writes to the workspace. The assistant reads the record and
 * answers about it; every change to a client's file is still made by a person
 * on the screen that owns it.
 */

/** How much of one tool's data is rendered into the compose prompt. */
const RESULT_CHARS = 6_000;

/** How much of a tool result the stored turn keeps, for the answer's audit. */
const STORED_RESULT_CHARS = 20_000;

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (truncated)`;
}

function stringify(data: unknown): string {
  if (data === null || data === undefined) return 'null';
  return JSON.stringify(data, null, 1);
}

/**
 * What of a tool's result the turn keeps.
 *
 * A result too large to store is replaced by a note rather than by a truncated
 * copy of itself: half a JSON object on an audit row looks like data and is
 * not. The summary beside it survives either way, and it is what the answer was
 * actually built from.
 */
function storable(data: unknown): unknown {
  const json = stringify(data);
  if (json.length <= STORED_RESULT_CHARS) return data;
  return { omitted: true, bytes: json.length, note: 'Result too large to store on the turn.' };
}

/**
 * A turn's history as the model reads it.
 *
 * Only the prose is carried forward, never the earlier turns' tool results. A
 * follow-up that needs a figure looks it up again — cheaper than re-sending
 * every earlier lookup, and it means an answer is never built on a row that has
 * changed since the turn that fetched it.
 */
function asHistory(turns: readonly AssistantTurn[]): AgentTurn[] {
  return turns.flatMap((turn): AgentTurn[] => [
    { role: 'user', content: turn.question },
    { role: 'assistant', content: turn.answer.answer },
  ]);
}

interface Executed {
  calls: AssistantToolCall[];
  citations: Map<string, AssistantCitation>;
  clientIds: Set<string>;
}

/**
 * Run what the model asked for.
 *
 * Arguments are re-validated against the tool's own schema even though the
 * provider was given that schema: OpenAI's function tools are declared
 * non-strict here (a Zod-derived schema with nullable unions is wider than
 * strict mode accepts), so this is the only place the shape is actually
 * enforced. A validation failure comes back to the model as an error it can
 * correct rather than as a thrown turn.
 */
function makeExecutor(state: Executed) {
  return async (invocations: readonly AgentToolInvocation[]): Promise<AgentToolOutcome[]> =>
    Promise.all(
      invocations.map(async (invocation): Promise<AgentToolOutcome> => {
        const started = Date.now();
        const tool = findTool(invocation.name);
        if (!tool) {
          state.calls.push({
            id: invocation.id,
            tool: invocation.name,
            args: invocation.args,
            ok: false,
            summary: `No tool named ${invocation.name}.`,
            data: null,
            error: 'unknown tool',
            citations: [],
            ms: 0,
          });
          return {
            id: invocation.id,
            content: `There is no tool named ${invocation.name}.`,
            isError: true,
          };
        }

        try {
          const args = tool.args.parse(invocation.args);
          const result = await tool.run(args);
          const citations = result.citations ?? [];
          for (const citation of citations) state.citations.set(citation.ref, citation);
          for (const clientId of result.clientIds ?? []) state.clientIds.add(clientId);

          state.calls.push({
            id: invocation.id,
            tool: tool.name,
            args: invocation.args,
            ok: true,
            summary: result.summary,
            data: storable(result.data),
            error: null,
            citations,
            ms: Date.now() - started,
          });

          return {
            id: invocation.id,
            content: `${result.summary}\n${clamp(stringify(result.data), RESULT_CHARS)}`,
          };
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          state.calls.push({
            id: invocation.id,
            tool: tool.name,
            args: invocation.args,
            ok: false,
            summary: `${tool.name} failed.`,
            data: null,
            error: message,
            citations: [],
            ms: Date.now() - started,
          });
          // Returned rather than thrown: a county with no data loaded and a
          // client id that does not exist are both answers, and the model can
          // say so if it is told.
          return { id: invocation.id, content: `${tool.name} failed: ${message}`, isError: true };
        }
      }),
    );
}

/** The evidence block the composing call reads. Nothing else reaches it. */
function renderEvidence(state: Executed): string {
  if (state.calls.length === 0) return '';
  const blocks = state.calls.map((call) => {
    const head = `[${call.tool}] ${JSON.stringify(call.args)}`;
    if (!call.ok) return `${head}\nFAILED: ${call.error}`;
    return `${head}\n${call.summary}\n${clamp(stringify(call.data), RESULT_CHARS)}`;
  });

  const citations = [...state.citations.values()].map(
    (citation) => `- ${citation.kind} | ${citation.ref} | ${citation.label}`,
  );

  return [
    blocks.join('\n\n---\n\n'),
    citations.length
      ? `Citations available (use kind, ref and label exactly as written):\n${citations.join('\n')}`
      : 'Citations available: none. Answer without citations.',
  ].join('\n\n===\n\n');
}

/**
 * Drop citations nothing backs.
 *
 * Same rule as the engagement ask: a reference the record cannot support does
 * not become a broken link, it becomes a line in limits. A reader who can see
 * that the answer cited something the lookups never returned knows how much to
 * trust the rest of it.
 */
function validate(answer: AssistantAnswer, state: Executed): AssistantAnswer {
  const citations: AssistantCitation[] = [];
  const seen = new Set<string>();
  let dropped = 0;

  for (const citation of answer.citations) {
    const known = state.citations.get(citation.ref);
    if (!known) {
      dropped += 1;
      continue;
    }
    if (seen.has(known.ref)) continue;
    seen.add(known.ref);
    // The label and href come from the tool, not from the model — the model
    // chooses what to cite, the record decides what it is called.
    citations.push(known);
  }

  if (dropped === 0) return { ...answer, citations };
  return {
    ...answer,
    citations,
    limits: [
      ...answer.limits,
      dropped === 1
        ? 'One citation in the draft pointed at something the lookups did not return, and was dropped.'
        : `${dropped} citations in the draft pointed at something the lookups did not return, and were dropped.`,
    ],
  };
}

/**
 * What the assistant says when there is no model configured.
 *
 * Deliberately not an error page. Both retrievers are lexical and neither needs
 * a provider, so a statutory question still gets the article that answers it
 * and a question the firm has argued before still gets the brief it argued in
 * — each in its own words rather than a summary of them — and every other
 * question gets told plainly why it cannot be answered here.
 *
 * The two corpora are printed under separate headings and never interleaved.
 * That separation is load-bearing everywhere the assistant touches precedent,
 * and it matters more here than anywhere else: there is no model in this path
 * to carry the caution, so the prose has to. One section is what a state
 * requires; the other is what this firm once wrote, which may have been wrong
 * and may have lost.
 *
 * The corpus search here is unfiltered by state, and it has to be: there is no
 * engagement in this path and nothing to infer a state from. So a question
 * about a deadline can come back with Texas and Florida side by side. Each
 * article prints the state it states the law of, and where two states answered
 * at once the limits say so — a reader given April 1 and April 15 with no
 * label would reasonably take the first one.
 */
async function fallbackAnswer(question: string): Promise<{
  answer: AssistantAnswer;
  calls: AssistantToolCall[];
  clientIds: string[];
}> {
  const hits = searchKnowledge(question, { limit: 3 });
  const reason = aiUnavailableReason();
  const prior = await fallbackPrecedent(question);

  const calls: AssistantToolCall[] = [
    {
      id: randomUUID(),
      tool: 'search_knowledge',
      args: { query: question, topics: null, jurisdiction: null, limit: 3 },
      ok: true,
      summary: `Knowledge: ${hits.length} article(s) matched.`,
      data: hits.map((hit) => ({ id: hit.article.id, title: hit.article.title })),
      error: null,
      citations: hits.map((hit) => knowledgeCitation(hit.article.id, hit.article.title)),
      ms: 0,
    },
    ...(prior === null ? [] : [prior.call]),
  ];

  const citations = [
    ...hits.map((hit) => knowledgeCitation(hit.article.id, hit.article.title)),
    ...(prior?.call.citations ?? []),
  ];
  const clientIds = prior?.clientIds ?? [];
  const states = new Set(hits.flatMap((hit) => hit.article.jurisdiction ?? []));

  if (hits.length === 0 && prior === null) {
    return {
      calls,
      clientIds,
      answer: {
        answer: `The assistant cannot look anything up right now: ${reason} Nothing in the knowledge corpus matches this question either, and the firm has written nothing on file about it, so there is nothing to fall back on. The workspace and market screens still work — the record is all there, only the assistant is off.`,
        citations: [],
        limits: ['No model is configured, so no lookups against the record were run.'],
        followUps: [],
      },
    };
  }

  const sections = [`The assistant cannot look anything up right now: ${reason}`];
  if (hits.length > 0) {
    sections.push(
      `**What the knowledge corpus requires**, in its own words rather than summarized.\n\n${renderKnowledge(hits)}`,
    );
  }
  if (prior !== null) sections.push(prior.section);

  return {
    calls,
    clientIds,
    answer: {
      answer: sections.join('\n\n'),
      citations,
      limits: [
        'No model is configured, so nothing in the client record or the county data was read — this is the two corpora only.',
        ...(states.size > 1
          ? [
              'The corpus was searched across every state, because nothing in this question said which one applies. More than one state answered below, and their rules differ — read the state named on each article before relying on a date.',
            ]
          : []),
        ...(prior === null
          ? []
          : [
              'The prior work below is history, not authority. It is what the firm argued, not what the law requires, and the outcome beside each one is the only thing that says whether it worked.',
            ]),
      ],
      followUps: [],
    },
  };
}

/**
 * The same fallback, asked of the firm's own prior work.
 *
 * Wrapped in a try because this is the path that runs when the deployment is
 * half-configured. A missing DATABASE_URL raises a 503 out of `requireDb`, and
 * turning a degraded answer into an error page would be a worse failure than
 * the one it is reporting. No prior work is a fine answer here; a stack trace
 * instead of the statute is not.
 */
async function fallbackPrecedent(
  question: string,
): Promise<{ call: AssistantToolCall; section: string; clientIds: string[] } | null> {
  let documents;
  try {
    documents = (await precedentCorpus()).documents;
  } catch {
    return null;
  }

  const hits = searchPrecedent(documents, question, { limit: 2 });
  if (hits.length === 0) return null;

  const tally = tallyPrecedent(hits);
  return {
    clientIds: [...new Set(hits.map((hit) => hit.document.clientId))],
    call: {
      id: randomUUID(),
      tool: 'search_precedent',
      args: { query: question, kinds: null, district: null, limit: 2 },
      ok: true,
      summary: `Precedent: ${hits.length} of ${documents.length} documents match — ${tally.favorable} went the firm's way, ${tally.unfavorable} did not, ${tally.unresolved} were never answered.`,
      data: hits.map((hit) => ({
        id: hit.document.id,
        title: hit.document.title,
        outcome: hit.document.outcome,
      })),
      error: null,
      citations: hits.map((hit) =>
        precedentCitation(
          hit.document.id,
          `${precedentKindLabel(hit.document.kind)}: ${hit.document.title}`,
          hit.document.href,
        ),
      ),
      ms: 0,
    },
    section: `**What this firm has argued before.** History, not authority — read the outcome on each one.\n\n${renderPrecedent(hits)}`,
  };
}

export interface AssistantTurnResult {
  conversationId: string;
  turn: AssistantTurn;
}

export async function runAssistantTurn(request: AssistantAskRequest): Promise<AssistantTurnResult> {
  const conversation = await resolveConversation(request.conversationId, request.question);
  const scope = request.scope ?? null;

  if (!isAiConfigured()) {
    const { answer, calls, clientIds } = await fallbackAnswer(request.question);
    const turn = await recordTurn({
      conversationId: conversation.id,
      question: request.question,
      scope,
      toolCalls: calls,
      answer,
      source: 'fallback',
      model: null,
      // Not empty any more. A fallback answer can quote a brief, and a
      // conversation holding one client's words has to be reachable by that
      // client's deletion sweep like any other.
      clientIds,
    });
    return { conversationId: conversation.id, turn };
  }

  const history = asHistory(await recentTurns(conversation.id));
  const state: Executed = { calls: [], citations: new Map(), clientIds: new Set() };

  let research;
  try {
    research = await researchAssistantQuestion({
      question: request.question,
      history,
      scope,
      tools: agentTools(),
      execute: makeExecutor(state),
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `The lookups failed: ${message}`);
  }

  let composed;
  try {
    composed = await composeAssistantAnswer({
      question: request.question,
      history,
      scope,
      evidence: renderEvidence(state),
      incomplete: research.stop === 'max-steps',
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `The answer failed: ${message}`);
  }

  const turn = await recordTurn({
    conversationId: conversation.id,
    question: request.question,
    scope,
    toolCalls: state.calls,
    answer: validate(composed.parsed, state),
    source: 'model',
    model: composed.model,
    clientIds: [...state.clientIds],
  });

  return { conversationId: conversation.id, turn };
}
