import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import type { RenditionFilingRow } from '@tangible/db';
import {
  buildForm50144,
  FORM_50144_REVISION,
  FORM_50144_SHA256,
  planFormFill,
  renderForm50144,
  type Form50144,
  type FormAudience,
  type FormFillPlan,
  type FormParty,
  type FormSigner,
} from '@tangible/filing';
import type {
  RecordFilingRequest,
  Rendition,
  RenditionFiling,
  RenditionFilingRecord,
} from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { formInputs } from '@/lib/rendition';
import { HttpError, notFound } from '@/lib/route';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The record of what was actually filed.
 *
 * Two rules, and they are the same two that govern committing a finding set.
 * The first is that recording a filing *rebuilds* the rendition server-side
 * rather than accepting one from the browser — a client that posted its own
 * numbers could record a return that never matched anything this app would
 * produce, which is precisely what the record exists to rule out. The second is
 * that nothing here is ever edited: an amendment is a new row and a mistake is
 * a void, because the table is evidence and evidence that can be rewritten is
 * not evidence.
 */

/**
 * Record that a return went out.
 *
 * The gate is that a rendition with blocking blockers cannot be recorded as
 * filed. That looks like the app second-guessing the operator, and the reason
 * it is right anyway is what the blockers are: unclassified property, no situs,
 * no signature, an agent with no appointment. Each names something that makes
 * the filed return wrong, and a record saying "we filed this" over a document
 * the app knows to be wrong is worse than no record — it launders the defect
 * into history. Clear the blocker, then record.
 */
export async function recordFiling(
  engagementId: string,
  body: RecordFilingRequest,
): Promise<RenditionFilingRecord> {
  // Authorisation, and nothing else — every fact this record needs comes from
  // the rebuilt rendition rather than from the engagement row.
  await fetchEngagement(engagementId);
  const inputs = await formInputs(engagementId, {
    basis: body.basis,
    filedByAgent: body.filedByAgent,
    locationId: body.locationId,
  });
  const { rendition, assetIds, party, signer, extra, target, actor } = inputs;

  // `target` is non-null whenever a location was named and it owed a return —
  // `resolveReturn` throws otherwise — but the type does not know that.
  if (!target) notFound('That site owes no return on this engagement.');

  // Both lists, because they block for different reasons and an operator who
  // only saw one would clear it and be told about the other.
  const blocking = [
    ...rendition.blockers.filter((blocker) => blocker.severity === 'blocking').map((b) => b.message),
    ...extra.filter((omission) => omission.severity === 'blocking').map((o) => o.missing),
  ];
  if (blocking.length > 0) {
    throw new HttpError(
      409,
      `This rendition still has ${blocking.length} unresolved ${
        blocking.length === 1 ? 'problem' : 'problems'
      }, so it cannot be recorded as filed: ${blocking.join(' ')}`,
    );
  }

  const db = requireDb();
  return db.transaction(async (tx) => {
    // An amendment supersedes what it amends. Scoped to the site and the year
    // rather than the engagement: the same site may file for two years under
    // one engagement, and superseding across years would retract a return that
    // is still the standing one.
    await tx
      .update(schema.renditionFilings)
      .set({ status: 'superseded' })
      .where(
        and(
          eq(schema.renditionFilings.locationId, target.locationId),
          eq(schema.renditionFilings.taxYear, rendition.taxYear),
          eq(schema.renditionFilings.status, 'filed'),
        ),
      );

    const [row] = await tx
      .insert(schema.renditionFilings)
      .values({
        engagementId,
        locationId: target.locationId,
        locationLabel: target.label,
        accountId: target.accountId ?? null,
        taxYear: rendition.taxYear,
        jurisdictionId: rendition.jurisdictionId,
        status: 'filed',
        basis: rendition.basis,
        filedByAgent: rendition.filedByAgent,
        method: body.method,
        filedOn: body.filedOn,
        confirmation: body.confirmation,
        note: body.note,
        totalHistoricalCost: rendition.totalHistoricalCost,
        totalGoodFaithEstimate: rendition.totalGoodFaithEstimate,
        scheduleValue: rendition.scheduleValue,
        assetCount: assetsOnReturn(rendition),
        rendition,
        party,
        signer,
        assetIds,
        formRevision: FORM_50144_REVISION,
        formSha256: FORM_50144_SHA256,
        recordedBy: actor,
      })
      .returning();

    if (!row) throw new HttpError(500, 'The filing was not recorded.');
    return toRecord(row);
  });
}

/**
 * How many pieces of property this return actually reports.
 *
 * Deliberately not `assetIds.length`. That is the register slice the form was
 * built from, and the rendition then sets part of it aside — property disposed
 * of before January 1, intangibles, whatever an accepted finding removed. What
 * the signer swears to, and what a 22.28 penalty is measured against, is the
 * property on the schedules, so the count is taken from there.
 */
function assetsOnReturn(rendition: Rendition): number {
  return rendition.schedules.reduce(
    (total, schedule) => total + schedule.lines.reduce((n, line) => n + line.assetCount, 0),
    0,
  );
}

/** Every filing on this engagement, newest first. Voids and all. */
export async function engagementFilings(engagementId: string): Promise<RenditionFiling[]> {
  await fetchEngagement(engagementId);
  const rows = await requireDb()
    .select()
    .from(schema.renditionFilings)
    .where(eq(schema.renditionFilings.engagementId, engagementId))
    .orderBy(desc(schema.renditionFilings.filedOn), desc(schema.renditionFilings.recordedAt));
  return rows.map(toSummary);
}

/**
 * One filing, and the client it belongs to.
 *
 * The client id comes out of the authorisation read rather than a second query
 * — every caller that is allowed to see a filing has just been told whose it
 * is, and a page that shows one needs somewhere to link back to.
 */
async function filingRow(filingId: string): Promise<{ row: RenditionFilingRow; clientId: string }> {
  const rows = await requireDb()
    .select()
    .from(schema.renditionFilings)
    .where(eq(schema.renditionFilings.id, filingId));
  const row = rows[0];
  if (!row) notFound('No filing with that id.');
  // Through the engagement, so a filing is visible to exactly whoever the
  // engagement is — one authorisation rule rather than a second one here.
  const { client } = await fetchEngagement(row.engagementId);
  return { row, clientId: client.id };
}

export async function filingRecord(filingId: string): Promise<RenditionFilingRecord> {
  return toRecord((await filingRow(filingId)).row);
}

export interface FiledForm {
  form: Form50144;
  filing: RenditionFiling;
  /** Where the page came from, so it has somewhere to go back to. */
  clientId: string;
  /**
   * What the printed sheet can carry, and whether the sheet has moved.
   *
   * `revision` is the form the fill plan targets *now*. Where it differs from
   * the filing's own `formRevision`, the paper this reproduces is not the paper
   * that went out — same content, later sheet — and the screen says so rather
   * than letting a reviewer assume they are holding a copy.
   */
  printed: { revision: string; blocked: string | null; overflow: FormFillPlan['overflow'] };
}

/**
 * Form 50-144 as it was filed, rebuilt from the frozen inputs.
 *
 * Nothing here reads the register. That is the entire point: this renders the
 * same numbers in 2031 that went out in 2026, whatever has happened to the
 * assets since.
 */
export async function buildFiledForm(filingId: string, audience: FormAudience): Promise<FiledForm> {
  const { row, clientId } = await filingRow(filingId);
  const frozen = frozenFormInputs(row);
  const form = buildForm50144({ ...frozen, audience });
  const plan = planFormFill(frozen);
  return {
    form,
    filing: toSummary(row),
    clientId,
    printed: { revision: plan.revision, blocked: plan.blocked, overflow: plan.overflow },
  };
}

/** The filed rendition on the Comptroller's PDF, from the same frozen inputs. */
export async function buildFiledFormPdf(
  filingId: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const { row } = await filingRow(filingId);
  const plan = planFormFill(frozenFormInputs(row));
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return {
    bytes: await renderForm50144(plan),
    filename: `50-144-filed-${slug(row.locationLabel)}-${row.taxYear}.pdf`,
  };
}

/**
 * Mark a recorded filing as never having happened.
 *
 * Not a delete. A return that was recorded and then voided is a different fact
 * from a return that was never recorded, and a reviewer looking at an
 * engagement with no filing deserves to know which one they are looking at.
 * Voiding does not restore whatever it superseded either: the earlier return
 * really was superseded at the time, and rewriting that would be inventing a
 * history in which the amendment never happened.
 */
export async function voidFiling(filingId: string, reason: string): Promise<RenditionFiling> {
  const existing = await filingRecord(filingId);
  if (existing.status === 'void') {
    throw new HttpError(409, 'That filing is already void.');
  }
  const actor = await currentActor();
  const [row] = await requireDb()
    .update(schema.renditionFilings)
    .set({ status: 'void', voidReason: reason, voidedBy: actor, voidedAt: new Date() })
    .where(eq(schema.renditionFilings.id, filingId))
    .returning();
  if (!row) throw new HttpError(500, 'The filing was not voided.');
  return toSummary(row);
}

function toSummary(row: RenditionFilingRow): RenditionFiling {
  return {
    id: row.id,
    engagementId: row.engagementId,
    locationId: row.locationId,
    locationLabel: row.locationLabel,
    accountId: row.accountId,
    taxYear: row.taxYear,
    jurisdictionId: row.jurisdictionId,
    status: row.status as RenditionFiling['status'],
    basis: row.basis as RenditionFiling['basis'],
    filedByAgent: row.filedByAgent,
    method: row.method as RenditionFiling['method'],
    filedOn: row.filedOn,
    confirmation: row.confirmation,
    note: row.note,
    totalHistoricalCost: row.totalHistoricalCost,
    totalGoodFaithEstimate: row.totalGoodFaithEstimate,
    scheduleValue: row.scheduleValue,
    assetCount: row.assetCount,
    formRevision: row.formRevision,
    formSha256: row.formSha256,
    recordedBy: row.recordedBy,
    recordedAt: row.recordedAt.toISOString(),
    voidedBy: row.voidedBy,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

function toRecord(row: RenditionFilingRow): RenditionFilingRecord {
  return {
    ...toSummary(row),
    rendition: row.rendition as Rendition,
    assetIds: row.assetIds as string[],
  };
}

/**
 * The frozen inputs, in the shape the form builders take.
 *
 * Cast rather than re-parsed: these went in as `FormParty` and `FormSigner`
 * from this same codebase, and re-validating them on the way out would mean a
 * later tightening of those types could make an already-filed return
 * unreadable — the one document that must still render years from now.
 */
export function frozenFormInputs(row: RenditionFilingRow): {
  rendition: Rendition;
  party: FormParty;
  signer: FormSigner;
} {
  return {
    rendition: row.rendition as Rendition,
    party: row.party as FormParty,
    signer: row.signer as FormSigner,
  };
}
