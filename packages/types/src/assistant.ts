import { z } from 'zod';

/**
 * The assistant: one conversation, many turns, answered from whatever the
 * record actually holds.
 *
 * This is a different shape from ask-the-graph and deliberately so. That one
 * assembles a fixed digest of a single engagement and asks the model one
 * question about it. This one spans the whole product — every client, the
 * public appraisal roll, and the statutory corpus — which is far too much to
 * put in a prompt. So instead of a digest the model gets tools, and it asks
 * for what it needs.
 *
 * The discipline that survives the change is the one that matters: code
 * decides what the model may see, code executes every lookup, and the answer
 * is stored next to the exact tool results that produced it. A turn read back
 * months later is a statement about what the record said at the time, not a
 * re-run that might now say something else.
 *
 * Everything reachable here is read-only. There is no tool on this surface
 * that writes a row, records a filing, or sends anything — the assistant
 * explains and points, and a person still does the work.
 */

/** Where the reader was standing when they asked. */
export const AssistantScopeSchema = z.object({
  /** The app route, e.g. `/clients/abc/engagements/def/findings`. */
  path: z.string(),
  /** A short human label for the page, shown on the turn and given to the model. */
  label: z.string().nullable(),
  clientId: z.string().nullable(),
  engagementId: z.string().nullable(),
  /** Market selectors, where the page has them. */
  state: z.string().nullable(),
  county: z.string().nullable(),
  taxYear: z.number().int().nullable(),
});

export type AssistantScope = z.infer<typeof AssistantScopeSchema>;

export const ASSISTANT_SOURCE_KINDS = [
  /** The firm's own record: clients, engagements, registers, filings, notices. */
  'workspace',
  /** The public appraisal roll warehouse. */
  'market',
  /** The curated statutory and product corpus. */
  'knowledge',
] as const;

export const AssistantSourceKindSchema = z.enum(ASSISTANT_SOURCE_KINDS);
export type AssistantSourceKind = (typeof ASSISTANT_SOURCE_KINDS)[number];

/**
 * One place an answer's claim can be checked.
 *
 * `ref` is the stable identity — an app route for workspace and market, an
 * article id for knowledge — and it is what validation matches on. `href` is
 * what the UI links to, and is null for a knowledge article, which has no
 * screen of its own. A citation the tool results cannot back is dropped
 * before the turn is stored, the same way ask-the-graph drops an unbackable
 * reference.
 */
export const AssistantCitationSchema = z.object({
  kind: AssistantSourceKindSchema,
  ref: z.string(),
  label: z.string(),
  href: z.string().nullable(),
});

export type AssistantCitation = z.infer<typeof AssistantCitationSchema>;

/**
 * What one tool call did.
 *
 * `args` and `data` are stored as given — jsonb, frozen. `summary` is the
 * one-line account shown to the reader in the transcript, because a tool call
 * the reader cannot see is a claim they cannot audit. A failed call keeps its
 * row: knowing the assistant tried to read the warehouse and could not is the
 * difference between "no accounts" and "no data loaded".
 */
export const AssistantToolCallSchema = z.object({
  /** Provider-assigned call id, kept so a transcript can be replayed. */
  id: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  ok: z.boolean(),
  summary: z.string(),
  /** Null on failure. */
  data: z.unknown().nullable(),
  /** Null on success. */
  error: z.string().nullable(),
  citations: z.array(AssistantCitationSchema),
  /** Wall-clock milliseconds, for the slow-tool question that always comes. */
  ms: z.number().int().nonnegative(),
});

export type AssistantToolCall = z.infer<typeof AssistantToolCallSchema>;

/**
 * The model's reply.
 *
 * `limits` face the firm and say what the record could not settle and what
 * would settle it — empty when the tools answered outright. `followUps` are
 * offered questions, not instructions; they exist because the single hardest
 * part of a surface like this is knowing what it can be asked.
 */
export const AssistantAnswerSchema = z.object({
  answer: z.string(),
  citations: z.array(AssistantCitationSchema),
  limits: z.array(z.string()),
  followUps: z.array(z.string()),
});

export type AssistantAnswer = z.infer<typeof AssistantAnswerSchema>;

/**
 * How the answer was reached, for the cases where it was not reached well.
 *
 * `model` is the ordinary path. `fallback` means the provider was
 * unavailable or the loop ran out of steps, and what came back was assembled
 * by code from the tool results rather than written — degraded but honest,
 * never silently presented as the same thing.
 */
export const ASSISTANT_ANSWER_SOURCES = ['model', 'fallback'] as const;
export const AssistantAnswerSourceSchema = z.enum(ASSISTANT_ANSWER_SOURCES);
export type AssistantAnswerSource = (typeof ASSISTANT_ANSWER_SOURCES)[number];

export const AssistantTurnSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  question: z.string(),
  scope: AssistantScopeSchema.nullable(),
  toolCalls: z.array(AssistantToolCallSchema),
  answer: AssistantAnswerSchema,
  source: AssistantAnswerSourceSchema,
  model: z.string().nullable(),
  createdAt: z.string(),
});

export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;

export const AssistantConversationSchema = z.object({
  id: z.string(),
  /** Taken from the first question, trimmed. Never model-generated — that is a
   * second API call to name something the reader can already read. */
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  turnCount: z.number().int().nonnegative(),
});

export type AssistantConversation = z.infer<typeof AssistantConversationSchema>;

export const AssistantConversationDetailSchema = AssistantConversationSchema.extend({
  turns: z.array(AssistantTurnSchema),
});

export type AssistantConversationDetail = z.infer<typeof AssistantConversationDetailSchema>;

/**
 * Asking. `conversationId` null starts a new conversation — the caller does
 * not create one first, because a conversation with no turn in it is a row
 * nobody wants.
 */
export const AssistantAskRequestSchema = z.object({
  conversationId: z.string().nullable().optional(),
  question: z.string().trim().min(3).max(1_000),
  scope: AssistantScopeSchema.nullable().optional(),
});

export type AssistantAskRequest = z.infer<typeof AssistantAskRequestSchema>;

export const AssistantAskResponseSchema = z.object({
  conversationId: z.string(),
  turn: AssistantTurnSchema,
});

export type AssistantAskResponse = z.infer<typeof AssistantAskResponseSchema>;

/**
 * A suggested question, with the route it makes sense on.
 *
 * Suggestions are a static table in code rather than anything generated: the
 * point is to show what this surface can be asked, and a list that changes
 * every render teaches nobody anything.
 */
export const AssistantSuggestionSchema = z.object({
  label: z.string(),
  question: z.string(),
});

export type AssistantSuggestion = z.infer<typeof AssistantSuggestionSchema>;
