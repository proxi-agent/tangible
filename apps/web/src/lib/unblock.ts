import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { assembleUnblockFacts, unblockBlocker } from '@tangible/filing';
import { aiUnavailableReason, draftUnblockPlan, isAiConfigured } from '@tangible/ai';
import type { UnblockFacts, UnblockPlan, UnblockPlanRecord } from '@tangible/types';
import { filingSeason } from '@/lib/season';
import { HttpError } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The unblock plan pipeline: the season board's own blockers, assembled by
 * code, drafted by model, stored frozen — and sent by a person or not at all.
 */

type PlanRow = typeof schema.unblockPlans.$inferSelect;

function dto(row: PlanRow): UnblockPlanRecord {
  return {
    id: row.id,
    engagementId: row.engagementId,
    facts: row.facts as UnblockFacts,
    plan: row.plan as UnblockPlan,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The newest drafted plan for an engagement, or null when none has been. */
export async function latestUnblockPlan(engagementId: string): Promise<UnblockPlanRecord | null> {
  await fetchEngagement(engagementId);
  const rows = await requireDb()
    .select()
    .from(schema.unblockPlans)
    .where(eq(schema.unblockPlans.engagementId, engagementId))
    .orderBy(desc(schema.unblockPlans.createdAt))
    .limit(1);
  return rows[0] ? dto(rows[0]) : null;
}

/** Assemble, draft, and store a new plan. Redrafting is a new row, not an edit. */
export async function draftPlan(engagementId: string): Promise<UnblockPlanRecord> {
  const { client, engagement } = await fetchEngagement(engagementId);
  // The board's own computation, so the plan can never disagree with the
  // screen it sits next to about what is blocked or when it is due.
  const season = await filingSeason(engagementId);

  const blocked = unblockBlocker(season.returns);
  if (blocked) throw new HttpError(409, blocked);
  if (!isAiConfigured()) {
    throw new HttpError(503, `Plan drafting is off. ${aiUnavailableReason()}`);
  }

  const facts = assembleUnblockFacts(client.name, engagement.taxYear, season.returns);

  let result;
  try {
    result = await draftUnblockPlan(facts);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `The plan draft failed: ${message}`);
  }

  const [inserted] = await requireDb()
    .insert(schema.unblockPlans)
    .values({ engagementId, facts, plan: result.parsed, model: result.model })
    .returning();
  return dto(inserted!);
}
