import type Anthropic from '@anthropic-ai/sdk';
import type OpenAI from 'openai';
import { z } from 'zod';
import { activeProvider, defaultModel, getAnthropic, getOpenAI, type AiTask } from './client.js';

/**
 * A bounded tool-calling loop, whichever provider is configured.
 *
 * Every other model call in this package is one shot: prompt in, structured
 * answer out. That works because the caller already knows what the model needs
 * to see — the register, the notice, the digest. The assistant does not. A
 * question can be about one client's blocked returns, about a county's roll,
 * about what Tax Code 22.30 gives you, or about all three at once, and no
 * fixed prompt holds all of that.
 *
 * So the model is given tools instead of facts and asked to fetch what it
 * needs. This file is only the loop: it hands the provider a tool list, runs
 * whatever calls come back, feeds the results in, and repeats until the model
 * stops asking or the step budget runs out. It never decides what a tool does
 * and never touches a database — the executor the caller passes in does that,
 * and that is where read-only is enforced.
 *
 * Two bounds are non-negotiable. Steps, because a model that keeps calling
 * tools in a loop would otherwise run until the route's `maxDuration` kills it
 * and the reader gets a blank 504. And a hard cap on the text of each tool
 * result, because a tool that returns a thousand register rows will blow the
 * context window on a single call and the failure will look like a model
 * problem rather than a paging one.
 *
 * The loop returns what it gathered rather than a finished answer. Composing
 * prose is a separate, schema-enforced call — see `assistant.ts` — which keeps
 * this file provider-shaped and that one product-shaped.
 */

export interface AgentTool {
  name: string;
  /** Model-visible. This is the whole of what the model knows about the tool. */
  description: string;
  /** Arguments. Converted to JSON Schema here so registries stay in Zod. */
  parameters: z.ZodType;
}

export interface AgentToolInvocation {
  /** Provider-assigned call id. Must come back on the matching outcome. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface AgentToolOutcome {
  id: string;
  /** What the model sees. Already rendered — the loop does not format results. */
  content: string;
  /** True when the tool failed; the model is told so rather than given silence. */
  isError?: boolean;
}

export type AgentToolExecutor = (
  calls: readonly AgentToolInvocation[],
) => Promise<AgentToolOutcome[]>;

export interface AgentTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolLoopRequest {
  system: string;
  /** Prior turns, oldest first. The current question is the last user turn. */
  messages: readonly AgentTurn[];
  tools: readonly AgentTool[];
  task: AiTask;
  maxTokens: number;
  /** How many times the model may go back for more. */
  maxSteps?: number;
  execute: AgentToolExecutor;
}

export type ToolLoopStop =
  /** The model stopped asking for tools — the ordinary ending. */
  | 'answered'
  /** The step budget ran out with the model still working. */
  | 'max-steps';

export interface ToolLoopResult {
  /** The model's closing text. Often empty when it stopped at the budget. */
  text: string;
  /** Every call it made, in order, with the arguments it chose. */
  invocations: AgentToolInvocation[];
  steps: number;
  stop: ToolLoopStop;
  model: string;
}

const DEFAULT_MAX_STEPS = 6;

/**
 * Per-result ceiling on what goes back to the model.
 *
 * Sized to hold a page of register rows or a county summary comfortably while
 * making it impossible for one careless tool to eat the window. Tools are
 * expected to page and summarize themselves; this is the backstop, and when it
 * fires it says so in the text so the model asks a narrower question rather
 * than reasoning off a sentence that stops mid-number.
 */
const MAX_RESULT_CHARS = 24_000;

function clamp(content: string): string {
  if (content.length <= MAX_RESULT_CHARS) return content;
  return `${content.slice(0, MAX_RESULT_CHARS)}\n\n[truncated — this result was too large to return in full. Narrow the arguments and ask again.]`;
}

function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' }) as Record<
    string,
    unknown
  >;
}

/**
 * Arguments arrive as a JSON string from both providers and are not guaranteed
 * to parse. A malformed call is not fatal — it becomes an invocation with empty
 * arguments, the executor rejects it against its schema, and the model is told
 * what was wrong. That is a far better outcome than throwing the whole turn
 * away over one bad brace.
 */
function parseArgs(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export async function runToolLoop(request: ToolLoopRequest): Promise<ToolLoopResult> {
  const provider = activeProvider();
  if (!provider) {
    // Callers check `isAiConfigured()` and take the deterministic path; getting
    // here is a bug, not a deployment state.
    throw new Error('No AI provider is configured.');
  }
  const model = defaultModel(provider, request.task);
  const maxSteps = request.maxSteps ?? DEFAULT_MAX_STEPS;

  return provider === 'anthropic'
    ? runAnthropicLoop(request, model, maxSteps)
    : runOpenAiLoop(request, model, maxSteps);
}

async function runAnthropicLoop(
  request: ToolLoopRequest,
  model: string,
  maxSteps: number,
): Promise<ToolLoopResult> {
  const client = getAnthropic();
  const tools: Anthropic.Tool[] = request.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: toJsonSchema(tool.parameters) as Anthropic.Tool.InputSchema,
  }));

  const messages: Anthropic.MessageParam[] = request.messages.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const invocations: AgentToolInvocation[] = [];
  let text = '';

  for (let step = 1; step <= maxSteps; step += 1) {
    const response = await client.messages.create({
      model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages,
      tools,
    });

    text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    const calls = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );

    if (calls.length === 0) {
      return { text, invocations, steps: step, stop: 'answered', model };
    }

    const round: AgentToolInvocation[] = calls.map((call) => ({
      id: call.id,
      name: call.name,
      args:
        call.input && typeof call.input === 'object' && !Array.isArray(call.input)
          ? (call.input as Record<string, unknown>)
          : {},
    }));
    invocations.push(...round);

    const outcomes = await request.execute(round);
    const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: round.map((call): Anthropic.ToolResultBlockParam => {
        const outcome = byId.get(call.id);
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          // An executor that returns nothing for a call would otherwise stall
          // the conversation: Anthropic requires a result block per tool_use.
          content: clamp(outcome?.content ?? 'The tool returned no result.'),
          is_error: outcome?.isError ?? !outcome,
        };
      }),
    });
  }

  return { text, invocations, steps: maxSteps, stop: 'max-steps', model };
}

async function runOpenAiLoop(
  request: ToolLoopRequest,
  model: string,
  maxSteps: number,
): Promise<ToolLoopResult> {
  const client = getOpenAI();
  const tools: OpenAI.Responses.Tool[] = request.tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description,
    parameters: toJsonSchema(tool.parameters),
    // Strict mode requires a JSON Schema dialect narrower than what Zod emits
    // for nullable and union arguments. The executor validates every call
    // against the same Zod schema anyway, so strictness here would buy nothing
    // and cost the ability to describe an optional filter.
    strict: false,
  }));

  const input: OpenAI.Responses.ResponseInput = request.messages.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const invocations: AgentToolInvocation[] = [];
  let text = '';

  for (let step = 1; step <= maxSteps; step += 1) {
    const response = await client.responses.create({
      model,
      instructions: request.system,
      input,
      tools,
      max_output_tokens: request.maxTokens,
      // Stateless. Passing the whole transcript back each step costs tokens but
      // keeps the loop replayable and leaves nothing on the provider's side.
      store: false,
    });

    text = response.output_text?.trim() ?? '';

    const calls = response.output.filter(
      (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call',
    );

    if (calls.length === 0) {
      return { text, invocations, steps: step, stop: 'answered', model };
    }

    const round: AgentToolInvocation[] = calls.map((call) => ({
      id: call.call_id,
      name: call.name,
      args: parseArgs(call.arguments),
    }));
    invocations.push(...round);

    const outcomes = await request.execute(round);
    const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));

    // Reasoning items come back in `output` too, and dropping them breaks the
    // next request on a reasoning model. Push the output through whole.
    //
    // The cast is the SDK's: its output-item and input-item unions differ on
    // one custom-tool variant this loop never produces, so they do not assign
    // even though every item the API returns is a valid item to send back.
    input.push(...(response.output as unknown as OpenAI.Responses.ResponseInputItem[]));
    for (const call of round) {
      const outcome = byId.get(call.id);
      input.push({
        type: 'function_call_output',
        call_id: call.id,
        output: clamp(outcome?.content ?? 'The tool returned no result.'),
      });
    }
  }

  return { text, invocations, steps: maxSteps, stop: 'max-steps', model };
}
