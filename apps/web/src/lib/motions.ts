import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import type { CorrectionMotionRow } from '@tangible/db';
import { checkMotion, motionStanding } from '@tangible/filing';
import type {
  ClaimRoute,
  CorrectionMotion,
  CorrectionMotionFacts,
  CorrectionMotionOutcome,
  CorrectionRouteKey,
  RecordMotionRequest,
  UpdateMotionRequest,
  VoidMotionRequest,
} from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { seedClaimsForMotion } from '@/lib/recovery';
import { HttpError, notFound } from '@/lib/http';
import { today } from '@/lib/today';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Storing the motions a practice has actually brought under 25.25.
 *
 * The same discipline as the notices and filings tables: no row is edited, a
 * change supersedes, and a mistake is a void. The rules about what a motion is
 * worth — 25.26's payment condition, 25.25(e)'s ninety days, (g)'s sixty, and
 * what (c-1)(3) spends — live in `@tangible/filing`, because they are statute
 * and arithmetic rather than storage.
 *
 * Read on the (account, year) grain the open-years board uses, and read through
 * the *client* rather than the engagement. A motion brought in last season's
 * engagement bars a route this season, and an engagement-scoped read would not
 * see it — which is exactly the mistake the bar exists to prevent.
 */

/** Every motion on this client, newest filing first. */
export async function clientMotions(clientId: string): Promise<CorrectionMotion[]> {
  const rows = await requireDb()
    .select({ motion: schema.correctionMotions, clientId: schema.engagements.clientId })
    .from(schema.correctionMotions)
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.correctionMotions.engagementId))
    .where(eq(schema.engagements.clientId, clientId))
    .orderBy(desc(schema.correctionMotions.subjectTaxYear), desc(schema.correctionMotions.filedOn));

  const asOf = today();
  return rows.map((row) => hydrate(row.motion, row.clientId, asOf));
}

/**
 * Which ending, if any, spends 25.25(c-1) for a set of motions on one year.
 *
 * A spending ending wins over a withdrawal, because (c-1)(3) asks whether *a*
 * previous motion was agreed, determined or forfeited — one that was, among
 * several that were not, still closes the route. A live motion spends nothing:
 * the subsection is about a motion that ended.
 */
export function spentBy(motions: readonly CorrectionMotion[]): CorrectionMotionOutcome | null {
  const ended = motions.filter((motion) => motion.status === 'recorded' && motion.outcome !== null);
  const spending = ended.find((motion) => motion.standing.barsAnother);
  if (spending) return spending.outcome;
  return ended.length > 0 ? 'withdrawn' : null;
}

/** The key the open-years board grains on: the account where there is one. */
export function motionKey(accountId: string | null, taxYear: number, locationId: string | null) {
  return `${accountId ?? (locationId === null ? 'unplaced' : `site:${locationId}`)}:${taxYear}`;
}

export async function recordMotion(
  engagementId: string,
  body: RecordMotionRequest,
): Promise<CorrectionMotion> {
  const { engagement } = await fetchEngagement(engagementId);
  const db = requireDb();

  // The site is optional, but a site that is named has to be this client's —
  // otherwise the label carried onto the row is somebody else's address.
  let locationLabel: string | null = null;
  if (body.locationId !== null) {
    const sites = await db
      .select({ id: schema.clientLocations.id, label: schema.clientLocations.label })
      .from(schema.clientLocations)
      .where(
        and(
          eq(schema.clientLocations.id, body.locationId),
          eq(schema.clientLocations.clientId, engagement.clientId),
        ),
      );
    const site = sites[0];
    if (!site) notFound('No site of this client with that id.');
    locationLabel = site.label;
  }

  // Neither an account nor a site leaves the motion attached to nothing, and
  // the open-years board has no row it could sit under.
  if (body.accountId === null && body.locationId === null) {
    throw new HttpError(
      422,
      'Say which account this motion is about, or which site. A motion corrects one account’s ' +
        'roll for one year, and with neither there is no year on the board for it to belong to.',
    );
  }

  const actor = await currentActor();
  const [row] = await db
    .insert(schema.correctionMotions)
    .values({
      engagementId,
      locationId: body.locationId,
      locationLabel,
      accountId: body.accountId,
      districtName: body.districtName,
      subjectTaxYear: body.subjectTaxYear,
      route: body.route,
      status: 'recorded',
      filedOn: body.filedOn,
      rolledValue: body.rolledValue,
      claimedValue: body.claimedValue,
      groundsNote: body.groundsNote,
      undisputedTaxPaidOn: body.undisputedTaxPaidOn,
      hearingScheduledFor: body.hearingScheduledFor,
      hearingNoticedOn: body.hearingNoticedOn,
      note: body.note,
      recordedBy: actor,
    })
    .returning();
  if (!row) throw new HttpError(500, 'The motion was not recorded.');

  // Same reasoning as a filing: the positions the motion carries are written
  // down as claims against the year it reopens, so what the district does about
  // them can be scored later. The subsection is recorded on every claim because
  // it is what the district answers — a county that takes (c) and fights (c-1)
  // is a pattern only visible if the route rode along.
  await seedClaimsForMotion({
    engagementId,
    motionId: row.id,
    locationId: row.locationId,
    accountId: row.accountId,
    taxYear: row.subjectTaxYear,
    route: `25.25-${row.route}` as ClaimRoute,
    authority: `Tex. Tax Code 25.25(${row.route})`,
    filedOn: row.filedOn,
  }).catch(() => undefined);

  return hydrate(row, engagement.clientId, today());
}

/**
 * Record what has happened to a motion since.
 *
 * A new row carrying the whole of it, and the old one becomes superseded. The
 * unchanged facts — the route, the year, the values the motion was brought on —
 * are copied from the row being replaced rather than resent, because they are
 * what the motion *was* and re-typing them is how they drift.
 */
export async function updateMotion(
  motionId: string,
  body: UpdateMotionRequest,
): Promise<CorrectionMotion> {
  const db = requireDb();
  const rows = await db
    .select({ motion: schema.correctionMotions, clientId: schema.engagements.clientId })
    .from(schema.correctionMotions)
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.correctionMotions.engagementId))
    .where(eq(schema.correctionMotions.id, motionId));
  const found = rows[0];
  if (!found) notFound('No motion with that id.');
  const existing = found.motion;

  if (existing.status !== 'recorded') {
    throw new HttpError(
      409,
      existing.status === 'void'
        ? 'That motion was recorded in error, so nothing can have happened to it.'
        : 'That record was superseded. Work to the motion that stands.',
    );
  }
  // The one thing that is structurally impossible rather than merely odd.
  // Everything else — an order with no number, a hearing noticed short — is a
  // check on the way out, because those happen and the row has to be saved.
  if (body.outcomeOn !== null && body.outcomeOn < existing.filedOn) {
    throw new HttpError(409, 'A motion cannot have ended before it was filed.');
  }

  const actor = await currentActor();
  const inserted = await db.transaction(async (tx) => {
    await tx
      .update(schema.correctionMotions)
      .set({ status: 'superseded' })
      .where(eq(schema.correctionMotions.id, motionId));

    const [row] = await tx
      .insert(schema.correctionMotions)
      .values({
        engagementId: existing.engagementId,
        locationId: existing.locationId,
        locationLabel: existing.locationLabel,
        accountId: existing.accountId,
        districtName: existing.districtName,
        subjectTaxYear: existing.subjectTaxYear,
        route: existing.route,
        status: 'recorded',
        filedOn: existing.filedOn,
        rolledValue: existing.rolledValue,
        claimedValue: existing.claimedValue,
        groundsNote: existing.groundsNote,
        // These three can be learned later, so the request wins where it says
        // something and the earlier row stands where it does not.
        undisputedTaxPaidOn: body.undisputedTaxPaidOn ?? existing.undisputedTaxPaidOn,
        hearingScheduledFor: body.hearingScheduledFor ?? existing.hearingScheduledFor,
        hearingNoticedOn: body.hearingNoticedOn ?? existing.hearingNoticedOn,
        outcome: body.outcome,
        outcomeOn: body.outcomeOn,
        correctedValue: body.correctedValue,
        orderReference: body.orderReference,
        note: body.note ?? existing.note,
        recordedBy: actor,
      })
      .returning();
    if (!row) throw new HttpError(500, 'The motion was not updated.');
    return row;
  });

  return hydrate(inserted, found.clientId, today());
}

export async function voidMotion(
  motionId: string,
  body: VoidMotionRequest,
): Promise<CorrectionMotion> {
  const db = requireDb();
  const rows = await db
    .select({ motion: schema.correctionMotions, clientId: schema.engagements.clientId })
    .from(schema.correctionMotions)
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.correctionMotions.engagementId))
    .where(eq(schema.correctionMotions.id, motionId));
  const found = rows[0];
  if (!found) notFound('No motion with that id.');
  if (found.motion.status === 'void') throw new HttpError(409, 'That motion is already void.');

  const actor = await currentActor();
  const [row] = await db
    .update(schema.correctionMotions)
    .set({ status: 'void', voidReason: body.reason, voidedBy: actor, voidedAt: new Date() })
    .where(eq(schema.correctionMotions.id, motionId))
    .returning();
  if (!row) throw new HttpError(500, 'The motion was not voided.');
  return hydrate(row, found.clientId, today());
}

function facts(row: CorrectionMotionRow): CorrectionMotionFacts {
  return {
    subjectTaxYear: row.subjectTaxYear,
    route: row.route as CorrectionRouteKey,
    status: row.status as CorrectionMotionFacts['status'],
    filedOn: row.filedOn,
    rolledValue: row.rolledValue,
    claimedValue: row.claimedValue,
    undisputedTaxPaidOn: row.undisputedTaxPaidOn,
    hearingScheduledFor: row.hearingScheduledFor,
    hearingNoticedOn: row.hearingNoticedOn,
    outcome: row.outcome as CorrectionMotionOutcome | null,
    outcomeOn: row.outcomeOn,
    correctedValue: row.correctedValue,
    orderReference: row.orderReference,
  };
}

function hydrate(row: CorrectionMotionRow, clientId: string, on: string): CorrectionMotion {
  const shape = facts(row);
  return {
    ...shape,
    id: row.id,
    engagementId: row.engagementId,
    clientId,
    accountId: row.accountId,
    locationId: row.locationId,
    locationLabel: row.locationLabel,
    districtName: row.districtName,
    groundsNote: row.groundsNote,
    note: row.note,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt.toISOString(),
    voidedBy: row.voidedBy,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    standing: motionStanding(shape, on),
    checks: checkMotion(shape, on),
  };
}
