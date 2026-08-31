import 'server-only';
import { desc, eq, sql } from 'drizzle-orm';
import type {
  AssistantAnswer,
  AssistantConversation,
  AssistantConversationDetail,
  AssistantScope,
  AssistantToolCall,
  AssistantTurn,
} from '@tangible/types';
import { notFound } from '@/lib/http';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Conversations and the turns under them.
 *
 * A turn is written once and never edited. What the tools returned is frozen
 * onto the row beside the answer they produced, for the same reason every other
 * generated artefact in this repo freezes its inputs: an answer read next month
 * has to be checkable against the record as it stood when it was given, not
 * against a record that has moved since.
 *
 * `clientIds` is the one column that is not part of the answer. It records
 * which clients a turn touched so that deleting a client can find these rows —
 * a turn can hold register figures that Tax Code 22.27 makes confidential, and
 * no foreign-key cascade reaches a table hanging off a conversation.
 */

type ConversationRow = typeof schema.assistantConversations.$inferSelect;
type TurnRow = typeof schema.assistantTurns.$inferSelect;

/** Longest a derived title runs before it is cut at a word boundary. */
const TITLE_MAX = 70;

/** How much of a conversation the model is shown. Older turns fall off. */
export const HISTORY_LIMIT = 8;

export function titleFor(question: string): string {
  const clean = question.trim().replace(/\s+/g, ' ');
  if (clean.length <= TITLE_MAX) return clean;
  const cut = clean.slice(0, TITLE_MAX);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function turnDto(row: TurnRow): AssistantTurn {
  return {
    id: row.id,
    conversationId: row.conversationId,
    question: row.question,
    scope: (row.scope as AssistantScope | null) ?? null,
    toolCalls: row.toolCalls as AssistantToolCall[],
    answer: row.answer as AssistantAnswer,
    source: row.source as AssistantTurn['source'],
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

function conversationDto(row: ConversationRow, turnCount: number): AssistantConversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    turnCount,
  };
}

export async function listConversations(limit = 30): Promise<AssistantConversation[]> {
  const rows = await requireDb()
    .select({
      conversation: schema.assistantConversations,
      turnCount: sql<number>`count(${schema.assistantTurns.id})::int`,
    })
    .from(schema.assistantConversations)
    .leftJoin(
      schema.assistantTurns,
      eq(schema.assistantTurns.conversationId, schema.assistantConversations.id),
    )
    .groupBy(schema.assistantConversations.id)
    .orderBy(desc(schema.assistantConversations.updatedAt))
    .limit(limit);

  return rows.map((row) => conversationDto(row.conversation, row.turnCount));
}

export async function getConversation(id: string): Promise<AssistantConversationDetail> {
  const db = requireDb();
  const [row] = await db
    .select()
    .from(schema.assistantConversations)
    .where(eq(schema.assistantConversations.id, id));
  if (!row) notFound(`Unknown conversation: ${id}`);

  const turns = await db
    .select()
    .from(schema.assistantTurns)
    .where(eq(schema.assistantTurns.conversationId, id))
    .orderBy(schema.assistantTurns.createdAt);

  return { ...conversationDto(row, turns.length), turns: turns.map(turnDto) };
}

/**
 * The conversation this turn belongs to, created if the caller did not name one.
 *
 * The title is taken from the question that opened the conversation and never
 * changes afterwards. A title that drifted to match the latest question would
 * rename a thread in the sidebar the reader is using to find it again.
 */
export async function resolveConversation(
  conversationId: string | null | undefined,
  question: string,
): Promise<ConversationRow> {
  const db = requireDb();
  if (conversationId) {
    const [row] = await db
      .select()
      .from(schema.assistantConversations)
      .where(eq(schema.assistantConversations.id, conversationId));
    return row ?? notFound(`Unknown conversation: ${conversationId}`);
  }
  const [row] = await db
    .insert(schema.assistantConversations)
    .values({ title: titleFor(question) })
    .returning();
  return row!;
}

/** The turns the model is shown, oldest first. */
export async function recentTurns(conversationId: string): Promise<AssistantTurn[]> {
  const rows = await requireDb()
    .select()
    .from(schema.assistantTurns)
    .where(eq(schema.assistantTurns.conversationId, conversationId))
    .orderBy(desc(schema.assistantTurns.createdAt))
    .limit(HISTORY_LIMIT);
  return rows.reverse().map(turnDto);
}

export interface RecordTurnInput {
  conversationId: string;
  question: string;
  scope: AssistantScope | null;
  toolCalls: AssistantToolCall[];
  answer: AssistantAnswer;
  source: AssistantTurn['source'];
  model: string | null;
  clientIds: string[];
}

export async function recordTurn(input: RecordTurnInput): Promise<AssistantTurn> {
  const db = requireDb();
  const [row] = await db
    .insert(schema.assistantTurns)
    .values({
      conversationId: input.conversationId,
      question: input.question,
      scope: input.scope,
      toolCalls: input.toolCalls,
      answer: input.answer,
      source: input.source,
      model: input.model,
      clientIds: [...new Set(input.clientIds)],
    })
    .returning();

  // The sidebar orders by activity, so the conversation is touched here rather
  // than left at its creation time.
  await db
    .update(schema.assistantConversations)
    .set({ updatedAt: new Date() })
    .where(eq(schema.assistantConversations.id, input.conversationId));

  return turnDto(row!);
}

export async function deleteConversation(id: string): Promise<void> {
  await requireDb()
    .delete(schema.assistantConversations)
    .where(eq(schema.assistantConversations.id, id));
}

/**
 * Remove every turn that touched one client, and any conversation left empty.
 *
 * Called by the client-deletion sweep. A conversation that also discussed other
 * clients keeps its remaining turns; one that was only ever about this client
 * has nothing left to hold and goes with them.
 */
export async function purgeClientTurns(clientId: string): Promise<number> {
  const db = requireDb();
  const deleted = await db
    .delete(schema.assistantTurns)
    .where(sql`${schema.assistantTurns.clientIds} @> ARRAY[${clientId}]::uuid[]`)
    .returning({ conversationId: schema.assistantTurns.conversationId });

  for (const conversationId of new Set(deleted.map((row) => row.conversationId))) {
    const [remaining] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.assistantTurns)
      .where(eq(schema.assistantTurns.conversationId, conversationId));
    if ((remaining?.n ?? 0) === 0) await deleteConversation(conversationId);
  }

  return deleted.length;
}
