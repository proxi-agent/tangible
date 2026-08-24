import 'server-only';
import { asc, eq } from 'drizzle-orm';
import { planAskSync } from '@tangible/far';
import type { MappingAsk, MappingAskRecord } from '@tangible/types';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The asks ledger for one file.
 *
 * Sync runs after every proposal; answers and dismissals are edits people
 * make. The planning — which incoming ask is new, which is a rewording that
 * inherits its answer — is pure and lives in @tangible/far with its tests;
 * this module is only the rows.
 */

type AskRow = typeof schema.mappingAsks.$inferSelect;

export function askDto(row: AskRow): MappingAskRecord {
  return {
    id: row.id,
    farFileId: row.farFileId,
    question: row.question,
    why: row.why,
    field: row.field as MappingAskRecord['field'],
    sheetName: row.sheetName,
    status: row.status as MappingAskRecord['status'],
    answer: row.answer,
    answeredAt: row.answeredAt ? row.answeredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Oldest first — the order they were raised is the order to work them. */
export async function fileAsks(farFileId: string): Promise<MappingAskRecord[]> {
  const rows = await requireDb()
    .select()
    .from(schema.mappingAsks)
    .where(eq(schema.mappingAsks.farFileId, farFileId))
    .orderBy(asc(schema.mappingAsks.createdAt));
  return rows.map(askDto);
}

/** Bring the ledger up to date with the latest proposal's asks. */
export async function syncAsks(farFileId: string, incoming: MappingAsk[]): Promise<void> {
  const db = requireDb();
  const existing = await db
    .select()
    .from(schema.mappingAsks)
    .where(eq(schema.mappingAsks.farFileId, farFileId))
    .orderBy(asc(schema.mappingAsks.createdAt));

  const plan = planAskSync(
    existing.map((row) => ({
      id: row.id,
      fingerprint: row.fingerprint,
      field: row.field,
      sheetName: row.sheetName,
      status: row.status,
      answer: row.answer,
    })),
    incoming,
  );

  for (const { id, ask, fingerprint } of plan.update) {
    await db
      .update(schema.mappingAsks)
      .set({
        fingerprint,
        question: ask.question,
        why: ask.why,
        sheetName: ask.sheetName,
        updatedAt: new Date(),
      })
      .where(eq(schema.mappingAsks.id, id));
  }
  if (plan.insert.length > 0) {
    await db
      .insert(schema.mappingAsks)
      .values(
        plan.insert.map(({ ask, fingerprint }) => ({
          farFileId,
          fingerprint,
          question: ask.question,
          why: ask.why,
          field: ask.field,
          sheetName: ask.sheetName,
        })),
      )
      .onConflictDoNothing();
  }
}

/** The answered asks, in the shape the proposal prompt takes. */
export async function answeredAsks(farFileId: string): Promise<{ question: string; answer: string }[]> {
  const rows = await fileAsks(farFileId);
  return rows
    .filter((row) => row.status === 'answered' && row.answer !== null)
    .map((row) => ({ question: row.question, answer: row.answer! }));
}
