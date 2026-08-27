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
import { renderKnowledge, searchKnowledge } from '@tangible/knowledge';
import type {
  AssistantAnswer,
  AssistantAskRequest,
  AssistantCitation,
  AssistantToolCall,
  AssistantTurn,
} from '@tangible/types';
import { HttpError } from '@/lib/route';
import { agentTools, findTool } from './registry';
import { knowledgeCitation } from './types';
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
 * Deliberately not an error page. The corpus is searchable without a provider,
 * so a statutory question still gets the article that answers it — with the
 * article's own words rather than a summary of them — and every other question
 * gets told plainly why it cannot be answered here.
 */
function fallbackAnswer(question: string): { answer: AssistantAnswer; calls: AssistantToolCall[] } {
  const hits = searchKnowledge(question, { limit: 3 });
  const reason = aiUnavailableReason();

  const calls: AssistantToolCall[] = [
    {
      id: randomUUID(),
      tool: 'search_knowledge',
      args: { query: question, topics: null, limit: 3 },
      ok: true,
      summary: `Knowledge: ${hits.length} article(s) matched.`,
      data: hits.map((hit) => ({ id: hit.article.id, title: hit.article.title })),
      error: null,
      citations: hits.map((hit) => knowledgeCitation(hit.article.id, hit.article.title)),
      ms: 0,
    },
  ];

  if (hits.length === 0) {
    return {
      calls,
      answer: {
        answer: `The assistant cannot look anything up right now: ${reason} Nothing in the knowledge corpus matches this question either, so there is nothing to fall back on. The workspace and market screens still work — the record is all there, only the assistant is off.`,
        citations: [],
        limits: ['No model is configured, so no lookups against the record were run.'],
        followUps: [],
      },
    };
  }

  return {
    calls,
    answer: {
      answer: `The assistant cannot look anything up right now: ${reason} What the knowledge corpus holds on this is below, in its own words rather than summarized.\n\n${renderKnowledge(hits)}`,
      citations: hits.map((hit) => knowledgeCitation(hit.article.id, hit.article.title)),
      limits: [
        'No model is configured, so nothing in the client record or the county data was read — this is the corpus only.',
      ],
      followUps: [],
    },
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
    const { answer, calls } = fallbackAnswer(request.question);
    const turn = await recordTurn({
      conversationId: conversation.id,
      question: request.question,
      scope,
      toolCalls: calls,
      answer,
      source: 'fallback',
      model: null,
      clientIds: [],
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
