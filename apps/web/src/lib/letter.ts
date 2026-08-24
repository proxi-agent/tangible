import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { assembleLetterFacts, letterBlocker } from '@tangible/filing';
import { aiUnavailableReason, draftResultLetter, isAiConfigured } from '@tangible/ai';
import type { LetterFacts, ResultLetter, ResultLetterRecord } from '@tangible/types';
import { engagementResult } from '@/lib/result';
import { HttpError } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The result letter pipeline: the scoreboard's own computation, assembled by
 * code, told by model, stored frozen — and sent by a person or not at all.
 */

type LetterRow = typeof schema.resultLetters.$inferSelect;

function dto(row: LetterRow): ResultLetterRecord {
  return {
    id: row.id,
    engagementId: row.engagementId,
    facts: row.facts as LetterFacts,
    letter: row.letter as ResultLetter,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The newest drafted letter for an engagement, or null when none has been. */
export async function latestResultLetter(
  engagementId: string,
): Promise<ResultLetterRecord | null> {
  await fetchEngagement(engagementId);
  const rows = await requireDb()
    .select()
    .from(schema.resultLetters)
    .where(eq(schema.resultLetters.engagementId, engagementId))
    .orderBy(desc(schema.resultLetters.createdAt))
    .limit(1);
  return rows[0] ? dto(rows[0]) : null;
}

/** Assemble, draft, and store a new letter. Redrafting is a new row, not an edit. */
export async function draftLetter(engagementId: string): Promise<ResultLetterRecord> {
  const { client } = await fetchEngagement(engagementId);
  // The scoreboard's own computation, so the letter can never disagree with
  // the card it sits beside about what a site's year came to.
  const result = await engagementResult(engagementId);

  const blocked = letterBlocker(result);
  if (blocked) throw new HttpError(409, blocked);
  if (!isAiConfigured()) {
    throw new HttpError(503, `Letter drafting is off. ${aiUnavailableReason()}`);
  }

  const facts = assembleLetterFacts(client.name, result);

  let drafted;
  try {
    drafted = await draftResultLetter(facts);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `The letter draft failed: ${message}`);
  }

  const [inserted] = await requireDb()
    .insert(schema.resultLetters)
    .values({ engagementId, facts, letter: drafted.parsed, model: drafted.model })
    .returning();
  return dto(inserted!);
}
