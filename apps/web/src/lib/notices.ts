import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import type { AssessmentNoticeRow } from '@tangible/db';
import {
  checkNotice,
  operativeDeadline,
  protestStanding,
  statutoryDates,
  type FiledReturnFacts,
} from '@tangible/filing';
import type {
  AssessmentNotice,
  AssessmentNoticeFacts,
  RecordNoticeRequest,
  RenditionExtension,
  RenditionFiling,
  UpdateNoticeRequest,
} from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { engagementExtensions } from '@/lib/extensions';
import { engagementFilings } from '@/lib/filings';
import { HttpError, notFound } from '@/lib/route';
import { engagementReturns } from '@/lib/sites';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Storing what the district concluded, and reading it against what we sent.
 *
 * The same discipline as the filings and extensions tables: no row is edited, a
 * corrected notice supersedes the earlier one, and a mistake is a void. The
 * rules about *what a notice is worth* — which of the three clocks it starts,
 * and whether the value it prints matches the district's own schedule — are in
 * `@tangible/filing`, because they are the statute and the arithmetic rather
 * than the storage, and they are only testable there.
 */

/** Every notice recorded on this engagement, newest first. */
export async function engagementNotices(engagementId: string): Promise<AssessmentNotice[]> {
  const rows = await requireDb()
    .select()
    .from(schema.assessmentNotices)
    .where(eq(schema.assessmentNotices.engagementId, engagementId))
    .orderBy(desc(schema.assessmentNotices.noticedOn), desc(schema.assessmentNotices.recordedAt));
  if (rows.length === 0) return [];
  return decorate(engagementId, rows);
}

/**
 * Record a notice that arrived.
 *
 * Nothing here is computed from the caller's figures — the clocks come off the
 * dates and the checks come off the filing already on record — so a notice
 * typed in from the envelope with only its date is a complete row. That is
 * deliberate: the date is what starts the window, and a notice recorded on the
 * day it lands is worth more than a full one recorded after it closed.
 */
export async function recordNotice(
  engagementId: string,
  body: RecordNoticeRequest,
): Promise<AssessmentNotice> {
  const { engagement } = await fetchEngagement(engagementId);
  const { returns } = await engagementReturns(engagementId);
  const target = returns.find((entry) => entry.locationId === body.locationId);
  if (!target) notFound('That site owes no return on this engagement.');

  // A notice cannot be dated before the property was counted. The check is
  // cheap and it catches the common typo — last year's notice keyed against
  // this year's engagement — which would otherwise start a clock that already
  // closed and put a permanent red row on the board.
  if (body.noticedOn < `${engagement.taxYear}-01-01`) {
    throw new HttpError(
      409,
      `That notice is dated before ${engagement.taxYear} began, and this engagement is for ` +
        `${engagement.taxYear}. Record it against the engagement for the year it covers.`,
    );
  }
  if (body.deliveredOn !== null && body.deliveredOn < body.noticedOn) {
    throw new HttpError(409, 'A notice cannot have arrived before it was dated.');
  }

  const actor = await currentActor();
  const db = requireDb();
  const inserted = await db.transaction(async (tx) => {
    // One active notice per site and year. A district that re-issues a
    // corrected notice starts the clock again from the new date, and two
    // active rows would leave the board counting down to whichever one it
    // happened to read first.
    await tx
      .update(schema.assessmentNotices)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(schema.assessmentNotices.locationId, target.locationId),
          eq(schema.assessmentNotices.taxYear, engagement.taxYear),
          eq(schema.assessmentNotices.status, 'active'),
        ),
      );

    const [row] = await tx
      .insert(schema.assessmentNotices)
      .values({
        engagementId,
        locationId: target.locationId,
        locationLabel: target.label,
        accountId: target.accountId ?? null,
        taxYear: engagement.taxYear,
        districtName: body.districtName,
        status: 'active',
        noticedOn: body.noticedOn,
        deliveredOn: body.deliveredOn,
        printedDeadline: body.printedDeadline,
        appraisedValue: body.appraisedValue,
        assessedValue: body.assessedValue,
        priorYearValue: body.priorYearValue,
        renditionPenaltyApplied: body.renditionPenaltyApplied,
        note: body.note,
        recordedBy: actor,
      })
      .returning();
    if (!row) throw new HttpError(500, 'The notice was not recorded.');
    return row;
  });

  const [decorated] = await decorate(engagementId, [inserted]);
  if (!decorated) throw new HttpError(500, 'The notice was not recorded.');
  return decorated;
}

/**
 * Write down that a protest went in, or take back a row recorded in error.
 *
 * Kept apart the way a denied extension is kept apart from a voided one. "We
 * protested this value" and "this notice was never ours" are different facts,
 * and only the first one closes a window.
 */
export async function updateNotice(
  noticeId: string,
  body: UpdateNoticeRequest,
): Promise<AssessmentNotice> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(schema.assessmentNotices)
    .where(eq(schema.assessmentNotices.id, noticeId));
  const existing = rows[0];
  if (!existing) notFound('No notice with that id.');

  if (existing.status === 'void') {
    throw new HttpError(409, 'That notice is already void.');
  }
  if (body.outcome === 'protested') {
    if (existing.status !== 'active') {
      throw new HttpError(
        409,
        'That notice was superseded by a later one. Record the protest against the notice that stands.',
      );
    }
    if (existing.protestFiledOn !== null) {
      throw new HttpError(409, `A protest is already recorded for ${existing.protestFiledOn}.`);
    }
    if (body.protestFiledOn !== null && body.protestFiledOn < existing.noticedOn) {
      throw new HttpError(409, 'A protest cannot have gone in before the notice was dated.');
    }
  }

  const actor = await currentActor();
  const [row] = await db
    .update(schema.assessmentNotices)
    .set(
      body.outcome === 'void'
        ? {
            status: 'void',
            voidReason: body.note ?? 'Recorded in error.',
            voidedBy: actor,
            voidedAt: new Date(),
          }
        : { protestFiledOn: body.protestFiledOn, protestNote: body.note },
    )
    .where(eq(schema.assessmentNotices.id, noticeId))
    .returning();

  if (!row) throw new HttpError(500, 'The notice was not updated.');
  const [decorated] = await decorate(existing.engagementId, [row]);
  if (!decorated) throw new HttpError(500, 'The notice was not updated.');
  return decorated;
}

/**
 * The clocks and the checks, added on read.
 *
 * Derived rather than stored for the reason an extension's standing is: the
 * answer moves without the row moving. "Twelve days to protest" becomes "the
 * window closed" overnight, and a check comparing the value against a return
 * changes the day that return is recorded — which is frequently *after* the
 * notice, because the notice is what sends somebody looking for it.
 */
async function decorate(
  engagementId: string,
  rows: AssessmentNoticeRow[],
): Promise<AssessmentNotice[]> {
  const [filings, extensions] = await Promise.all([
    engagementFilings(engagementId),
    engagementExtensions(engagementId),
  ]);
  const today = new Date().toISOString().slice(0, 10);

  // The return that stands for a site and year, if one went out. Keyed on both
  // because a notice recorded for one year must not be read against a filing
  // from another.
  const standing = new Map<string, RenditionFiling>();
  for (const filing of filings) {
    if (filing.status === 'filed') standing.set(`${filing.locationId}:${filing.taxYear}`, filing);
  }

  return rows.map((row) => {
    const facts: AssessmentNoticeFacts = {
      taxYear: row.taxYear,
      status: row.status as AssessmentNoticeFacts['status'],
      noticedOn: row.noticedOn,
      deliveredOn: row.deliveredOn,
      printedDeadline: row.printedDeadline,
      renditionPenaltyApplied: row.renditionPenaltyApplied,
      protestFiledOn: row.protestFiledOn,
    };
    const protest = protestStanding(facts, today);
    const filing = standing.get(`${row.locationId}:${row.taxYear}`) ?? null;
    return {
      ...facts,
      id: row.id,
      engagementId: row.engagementId,
      locationId: row.locationId,
      locationLabel: row.locationLabel,
      accountId: row.accountId,
      districtName: row.districtName,
      appraisedValue: row.appraisedValue,
      assessedValue: row.assessedValue,
      priorYearValue: row.priorYearValue,
      note: row.note,
      protestNote: row.protestNote,
      recordedBy: row.recordedBy,
      recordedAt: row.recordedAt.toISOString(),
      voidedBy: row.voidedBy,
      voidedAt: row.voidedAt?.toISOString() ?? null,
      voidReason: row.voidReason,
      protest,
      checks: checkNotice(
        { ...facts, appraisedValue: row.appraisedValue },
        filedFacts(filing, extensions, row.taxYear),
        protest,
      ),
    };
  });
}

/**
 * What the return looked like when it went out, for the notice to be read
 * against.
 *
 * The deadline here is the one that return was *actually* working to, extension
 * and all — not the statutory April date. A penalty applied to a return filed
 * on May 2 under a granted extension is exactly as wrong as one applied to a
 * return filed in March, and a check that measured against April would agree
 * with the district instead of catching it.
 */
function filedFacts(
  filing: RenditionFiling | null,
  extensions: readonly RenditionExtension[],
  taxYear: number,
): FiledReturnFacts | null {
  if (filing === null) return null;
  const statutory = statutoryDates(taxYear);
  const forSite = extensions.filter(
    (extension) => extension.locationId === filing.locationId && extension.taxYear === taxYear,
  );
  return {
    filedOn: filing.filedOn,
    dueOn: operativeDeadline(forSite, statutory.dueOn).dueOn,
    confirmation: filing.confirmation,
    totalHistoricalCost: filing.totalHistoricalCost,
    scheduleValue: filing.scheduleValue,
  };
}
