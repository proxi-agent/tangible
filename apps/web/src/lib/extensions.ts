import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import type { RenditionExtensionRow } from '@tangible/db';
import {
  addDays,
  extensionStanding,
  stamp,
  statutoryDates,
  type StatutoryDates,
} from '@tangible/filing';
import type {
  AnswerExtensionRequest,
  ExtensionKind,
  FilingMethod,
  RecordExtensionRequest,
  RenditionExtension,
} from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { HttpError, notFound } from '@/lib/http';
import { engagementReturns } from '@/lib/sites';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Storing what was asked for, and what came back.
 *
 * The filings table's discipline again: no row is edited, a mistake is a void,
 * and the date an extension bought is written down rather than recomputed. The
 * rule about *which* requests are worth anything is in `@tangible/filing` —
 * {@link extensionStanding} — because it is the statute rather than the
 * storage, and it is only testable there.
 */

/** Every extension recorded on this engagement, newest request first. */
export async function engagementExtensions(engagementId: string): Promise<RenditionExtension[]> {
  const { engagement } = await fetchEngagement(engagementId);
  const rows = await requireDb()
    .select()
    .from(schema.renditionExtensions)
    .where(eq(schema.renditionExtensions.engagementId, engagementId))
    .orderBy(
      desc(schema.renditionExtensions.requestedOn),
      desc(schema.renditionExtensions.recordedAt),
    );
  const statutory = statutoryDates(engagement.taxYear);
  return rows.map((row) => toExtension(row, statutory));
}

/**
 * Record that an extension request went out.
 *
 * The date a standard request buys is taken from the same statutory calendar
 * every other deadline on the engagement comes from, not from the caller: it is
 * May 15 observed and there is nothing to decide. An additional request names
 * its own date, because that day is the district's answer.
 */
export async function recordExtension(
  engagementId: string,
  body: RecordExtensionRequest,
): Promise<RenditionExtension> {
  const { engagement } = await fetchEngagement(engagementId);
  const statutory = statutoryDates(engagement.taxYear);

  const { returns } = await engagementReturns(engagementId);
  const target = returns.find((entry) => entry.locationId === body.locationId);
  if (!target) notFound('That site owes no return on this engagement.');

  // A standard request never takes its date from the caller. The statute names
  // May 15 and nothing is being decided, so the date is read off the same
  // calendar as every other deadline here — written this way round so a client
  // posting its own `extendedTo` cannot move a deadline it does not set.
  let extendedTo = statutory.extendedDueOn;
  if (body.kind === 'additional') {
    // `RecordExtensionRequestSchema` already refuses this; the check is here so
    // the type narrows, not as a second opinion.
    if (body.extendedTo === null) {
      throw new HttpError(400, 'An additional extension runs to a date the district names.');
    }
    // 22.23(b) caps the further extension at fifteen days, and a record
    // claiming more would put a date on the board no district can grant.
    const cap = addDays(statutory.extendedDueOn, 15);
    if (body.extendedTo > cap) {
      throw new HttpError(
        409,
        `22.23(b) allows up to 15 further days, which is ${stamp(cap)} this year. ` +
          `${stamp(body.extendedTo)} is beyond what the chief appraiser can grant.`,
      );
    }
    if (body.extendedTo <= statutory.extendedDueOn) {
      throw new HttpError(
        409,
        `An additional extension has to run past ${stamp(statutory.extendedDueOn)}, ` +
          'which the standard one already reaches.',
      );
    }
    extendedTo = body.extendedTo;
  }

  const actor = await currentActor();
  const db = requireDb();
  return db.transaction(async (tx) => {
    // Scoped to the kind as well as the site and year: a standard extension and
    // a granted additional one stand together, and superseding across kinds
    // would retract the very extension the second one was built on.
    await tx
      .update(schema.renditionExtensions)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(schema.renditionExtensions.locationId, target.locationId),
          eq(schema.renditionExtensions.taxYear, engagement.taxYear),
          eq(schema.renditionExtensions.kind, body.kind),
          eq(schema.renditionExtensions.status, 'requested'),
        ),
      );

    const [row] = await tx
      .insert(schema.renditionExtensions)
      .values({
        engagementId,
        locationId: target.locationId,
        locationLabel: target.label,
        accountId: target.accountId ?? null,
        taxYear: engagement.taxYear,
        kind: body.kind,
        status: 'requested',
        requestedOn: body.requestedOn,
        method: body.method,
        confirmation: body.confirmation,
        reason: body.reason,
        note: body.note,
        extendedTo,
        recordedBy: actor,
      })
      .returning();

    if (!row) throw new HttpError(500, 'The extension was not recorded.');
    return toExtension(row, statutory);
  });
}

/**
 * Write down what the district said, or take back a row recorded in error.
 *
 * Voiding is kept separate from denial on purpose. "The chief appraiser refused
 * this" and "we never sent it" are different facts, and only one of them is an
 * argument for anything later.
 */
export async function answerExtension(
  extensionId: string,
  body: AnswerExtensionRequest,
): Promise<RenditionExtension> {
  const db = requireDb();
  const rows = await db
    .select()
    .from(schema.renditionExtensions)
    .where(eq(schema.renditionExtensions.id, extensionId));
  const existing = rows[0];
  if (!existing) notFound('No extension with that id.');
  const { engagement } = await fetchEngagement(existing.engagementId);

  if (existing.status === 'void') {
    throw new HttpError(409, 'That request is already void.');
  }
  if (body.outcome !== 'void' && existing.status !== 'requested') {
    throw new HttpError(
      409,
      `That request is already ${existing.status}. Record a fresh one rather than rewriting this.`,
    );
  }

  const actor = await currentActor();
  const [row] = await db
    .update(schema.renditionExtensions)
    .set(
      body.outcome === 'void'
        ? {
            status: 'void',
            voidReason: body.note ?? 'Recorded in error.',
            voidedBy: actor,
            voidedAt: new Date(),
          }
        : { status: body.outcome, answeredOn: body.answeredOn, answerNote: body.note },
    )
    .where(eq(schema.renditionExtensions.id, extensionId))
    .returning();

  if (!row) throw new HttpError(500, 'The extension was not updated.');
  return toExtension(row, statutoryDates(engagement.taxYear));
}

function toExtension(row: RenditionExtensionRow, statutory: StatutoryDates): RenditionExtension {
  const base = {
    id: row.id,
    engagementId: row.engagementId,
    locationId: row.locationId,
    locationLabel: row.locationLabel,
    accountId: row.accountId,
    taxYear: row.taxYear,
    kind: row.kind as ExtensionKind,
    status: row.status as RenditionExtension['status'],
    requestedOn: row.requestedOn,
    method: row.method as FilingMethod,
    confirmation: row.confirmation,
    reason: row.reason,
    note: row.note,
    extendedTo: row.extendedTo,
    answeredOn: row.answeredOn,
    answerNote: row.answerNote,
  };
  return { ...base, ...extensionStanding(base, statutory) };
}
