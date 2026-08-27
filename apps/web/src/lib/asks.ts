import 'server-only';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { planAskSync } from '@tangible/far';
import type { AskRecord, CreateAskRequest, MappingAsk } from '@tangible/types';
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

export function askDto(row: AskRow): AskRecord {
  return {
    id: row.id,
    source: row.source as AskRecord['source'],
    farFileId: row.farFileId,
    engagementId: row.engagementId,
    subject: row.subject,
    question: row.question,
    why: row.why,
    field: row.field as AskRecord['field'],
    sheetName: row.sheetName,
    status: row.status as AskRecord['status'],
    answer: row.answer,
    answeredAt: row.answeredAt ? row.answeredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Oldest first — the order they were raised is the order to work them. */
export async function fileAsks(farFileId: string): Promise<AskRecord[]> {
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

/**
 * Every question outstanding against one season, both kinds.
 *
 * The client wing used to fan this out per file from the browser. That was
 * fine while a file was the only thing that could raise a question; a finding
 * ask hangs off the engagement and has no file to be fetched under, so the
 * union has to be made where both live.
 */
export async function engagementAsks(engagementId: string): Promise<AskRecord[]> {
  const db = requireDb();
  const files = await db
    .select({ id: schema.farFiles.id })
    .from(schema.farFiles)
    .where(eq(schema.farFiles.engagementId, engagementId));
  const fileIds = files.map((file) => file.id);

  const [own, mapping] = await Promise.all([
    db
      .select()
      .from(schema.mappingAsks)
      .where(eq(schema.mappingAsks.engagementId, engagementId))
      .orderBy(asc(schema.mappingAsks.createdAt)),
    fileIds.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(schema.mappingAsks)
          .where(inArray(schema.mappingAsks.farFileId, fileIds))
          .orderBy(asc(schema.mappingAsks.createdAt)),
  ]);

  return [...own, ...mapping]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(askDto);
}

/**
 * Raise — or find — the question one screening finding turns on.
 *
 * Idempotent by (engagement, finding), and deliberately so: the report offers
 * the question wherever the finding appears, and two people opening the same
 * finding must land on the same row rather than each answering their own copy.
 * An existing row is returned untouched, wording included. The question a
 * person answered is the question that stays on the record — if the engine
 * later rewords it, the ledger still shows what was actually put to them.
 */
export async function createFindingAsk(
  engagementId: string,
  body: CreateAskRequest,
): Promise<AskRecord> {
  const db = requireDb();
  const fingerprint = `finding:${body.findingKey}`;

  const [existing] = await db
    .select()
    .from(schema.mappingAsks)
    .where(
      and(
        eq(schema.mappingAsks.engagementId, engagementId),
        eq(schema.mappingAsks.fingerprint, fingerprint),
      ),
    );
  if (existing) return askDto(existing);

  const [created] = await db
    .insert(schema.mappingAsks)
    .values({
      engagementId,
      source: 'finding',
      subject: body.findingKey,
      fingerprint,
      question: body.question,
      why: body.why,
      // Both are mapping vocabulary: a finding ask decides no column on no
      // sheet. Null says that, where an empty string would read as a lost value.
      field: null,
      sheetName: null,
    })
    .onConflictDoNothing()
    .returning();
  if (created) return askDto(created);

  // Lost the race to a concurrent open of the same finding. The unique index
  // is what makes that safe; this is only how the loser reads the winner's row.
  const [raced] = await db
    .select()
    .from(schema.mappingAsks)
    .where(
      and(
        eq(schema.mappingAsks.engagementId, engagementId),
        eq(schema.mappingAsks.fingerprint, fingerprint),
      ),
    );
  if (!raced) throw new Error('The ask could not be created or found after insert.');
  return askDto(raced);
}

/** The answered asks, in the shape the proposal prompt takes. */
export async function answeredAsks(
  farFileId: string,
): Promise<{ question: string; answer: string }[]> {
  const rows = await fileAsks(farFileId);
  return rows
    .filter((row) => row.status === 'answered' && row.answer !== null)
    .map((row) => ({ question: row.question, answer: row.answer! }));
}
