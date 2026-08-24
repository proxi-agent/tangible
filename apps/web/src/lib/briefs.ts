import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { assembleBriefFacts, briefBlocker } from '@tangible/filing';
import { aiUnavailableReason, draftProtestBrief, isAiConfigured } from '@tangible/ai';
import type {
  AssessmentNotice,
  ProtestBrief,
  ProtestBriefFacts,
  ProtestBriefRecord,
} from '@tangible/types';
import { engagementFilings } from '@/lib/filings';
import { renditionPositions } from '@/lib/findings';
import { engagementNotices } from '@/lib/notices';
import { HttpError, notFound } from '@/lib/route';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The protest brief pipeline: assemble the facts by code, draft by model,
 * store both, and let a person do the filing.
 *
 * The single most important property here is that `assembleBriefFacts` runs
 * before the model call and its output is what gets frozen — the model never
 * saw a table, so a wrong number in a brief is a wrong number in the record it
 * was assembled from, findable by reading the stored `facts` alone.
 */

type BriefRow = typeof schema.protestBriefs.$inferSelect;

function dto(row: BriefRow): ProtestBriefRecord {
  return {
    id: row.id,
    noticeId: row.noticeId,
    engagementId: row.engagementId,
    facts: row.facts as ProtestBriefFacts,
    brief: row.brief as ProtestBrief,
    model: row.model,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The notice, decorated, with authorization done the only way notices have:
 * through the engagement. Everything a brief argues from — protest standing,
 * checks, resolution — is computed by `engagementNotices`, so a single-notice
 * read goes through the same decoration rather than rebuilding half of it.
 */
async function fetchNotice(noticeId: string): Promise<AssessmentNotice> {
  const rows = await requireDb()
    .select({ engagementId: schema.assessmentNotices.engagementId })
    .from(schema.assessmentNotices)
    .where(eq(schema.assessmentNotices.id, noticeId));
  const row = rows[0];
  if (!row) notFound('No notice with that id.');
  const notices = await engagementNotices(row.engagementId);
  const notice = notices.find((entry) => entry.id === noticeId);
  if (!notice) notFound('No notice with that id.');
  return notice;
}

/** The newest drafted brief for a notice, or null when none has been drafted. */
export async function latestBrief(noticeId: string): Promise<ProtestBriefRecord | null> {
  await fetchNotice(noticeId);
  const rows = await requireDb()
    .select()
    .from(schema.protestBriefs)
    .where(eq(schema.protestBriefs.noticeId, noticeId))
    .orderBy(desc(schema.protestBriefs.createdAt))
    .limit(1);
  return rows[0] ? dto(rows[0]) : null;
}

/** Assemble, draft, and store a new brief. Redrafting is a new row, not an edit. */
export async function draftBrief(noticeId: string): Promise<ProtestBriefRecord> {
  const notice = await fetchNotice(noticeId);

  const blocked = briefBlocker(notice);
  if (blocked) throw new HttpError(409, blocked);
  if (!isAiConfigured()) {
    throw new HttpError(503, `Brief drafting is off. ${aiUnavailableReason()}`);
  }

  const [filings, positions] = await Promise.all([
    engagementFilings(notice.engagementId),
    renditionPositions(notice.engagementId),
  ]);
  // The return this notice answered: the standing filed return for the same
  // site and year. A superseded or voided filing does not speak for the firm.
  const filing =
    filings.find(
      (entry) =>
        entry.status === 'filed' &&
        entry.locationId === notice.locationId &&
        entry.taxYear === notice.taxYear,
    ) ?? null;

  const facts = assembleBriefFacts(notice, filing, positions);

  let result;
  try {
    result = await draftProtestBrief(facts);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new HttpError(502, `The brief draft failed: ${message}`);
  }

  const [inserted] = await requireDb()
    .insert(schema.protestBriefs)
    .values({
      noticeId,
      engagementId: notice.engagementId,
      facts,
      brief: result.parsed,
      model: result.model,
    })
    .returning();
  return dto(inserted!);
}
