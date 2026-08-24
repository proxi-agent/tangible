import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { assembleMotionDraftFacts, motionDraftBlocker } from '@tangible/filing';
import { aiUnavailableReason, draftCorrectionMotion, isAiConfigured } from '@tangible/ai';
import type {
  CorrectionMotionDraft,
  DraftMotionRequest,
  MotionDraftFacts,
  MotionDraftRecord,
  OpenYear,
} from '@tangible/types';
import { engagementOpenYears } from '@/lib/open-years';
import { HttpError, notFound } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The motion draft pipeline: check by code, draft by model, store both, and
 * let a person sign, file, and record the filing.
 *
 * The year is re-derived through `engagementOpenYears` at draft time rather
 * than trusted from the client, so the draft argues from the same outlook the
 * board shows — bars included. Two of the facts are the person's own (the
 * claimed correct value and the ground of the error) because they are
 * assertions the record cannot supply; they are the same two fields
 * `recordMotion` stores once the motion actually goes in.
 */

type DraftRow = typeof schema.motionDrafts.$inferSelect;

function dto(row: DraftRow): MotionDraftRecord {
  return {
    id: row.id,
    engagementId: row.engagementId,
    yearKey: row.yearKey,
    facts: row.facts as MotionDraftFacts,
    draft: row.draft as CorrectionMotionDraft,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The open-years row for one key — closed years included, so a bar can explain itself. */
async function fetchYear(engagementId: string, yearKey: string): Promise<OpenYear> {
  const years = await engagementOpenYears(engagementId);
  const year = [...years.open, ...years.closed].find((entry) => entry.key === yearKey);
  if (!year) notFound('No year with that key on this client.');
  return year;
}

/** The newest drafted motion for the year, or null when none has been drafted. */
export async function latestMotionDraft(
  engagementId: string,
  yearKey: string,
): Promise<MotionDraftRecord | null> {
  await fetchEngagement(engagementId);
  const rows = await requireDb()
    .select()
    .from(schema.motionDrafts)
    .where(
      and(
        eq(schema.motionDrafts.engagementId, engagementId),
        eq(schema.motionDrafts.yearKey, yearKey),
      ),
    )
    .orderBy(desc(schema.motionDrafts.createdAt))
    .limit(1);
  return rows[0] ? dto(rows[0]) : null;
}

/** Check, assemble, draft, and store a new motion. Redrafting is a new row. */
export async function draftMotion(
  engagementId: string,
  request: DraftMotionRequest,
): Promise<MotionDraftRecord> {
  const { client } = await fetchEngagement(engagementId);
  const year = await fetchYear(engagementId, request.yearKey);

  const blocked = motionDraftBlocker(year, request.route, request.claimedValue);
  if (blocked) throw new HttpError(409, blocked);
  if (!isAiConfigured()) {
    throw new HttpError(503, `Motion drafting is off. ${aiUnavailableReason()}`);
  }

  const facts = assembleMotionDraftFacts(
    client.name,
    year,
    request.route,
    request.claimedValue,
    request.ground,
  );

  let drafted;
  try {
    drafted = await draftCorrectionMotion(facts);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `The motion draft failed: ${message}`);
  }

  const [inserted] = await requireDb()
    .insert(schema.motionDrafts)
    .values({
      engagementId,
      yearKey: request.yearKey,
      facts,
      draft: drafted.parsed,
      model: drafted.model,
    })
    .returning();
  return dto(inserted!);
}
