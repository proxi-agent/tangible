import 'server-only';
import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { deletionWarnings } from '@tangible/filing';
import type { DeletionCounts, DeletionPreview, DeletionReceipt } from '@tangible/types';
import { removeFarFiles } from '@/lib/far-storage';
import { HttpError } from '@/lib/route';
import { fetchClient } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Deleting a client, for real.
 *
 * The free-diagnostic pitch promises deletion on request, and a promise the
 * software cannot keep is the kind of thing that surfaces at the worst moment.
 * Archiving is not deletion; a client who asks to be deleted is not asking to
 * be filtered out of a list.
 *
 * Two things make this more than a `DELETE FROM clients`. The schema's own
 * cascade is not sufficient — five foreign keys onto `client_locations` are
 * `restrict` (a filed rendition pins the site it was filed for), and
 * `assets.first_seen_batch_id` has no delete rule at all, so the plain
 * statement can deadlock against its own cascade order. And two stores hold
 * client data that no cascade reaches: the private upload bucket, and the
 * cross-client classification memory, which keeps a verbatim sample of the
 * client's own description text.
 *
 * What survives is a receipt: counts, a name, a date, and no client data.
 */

async function tally(table: PgTable, where: SQL | undefined): Promise<number> {
  const [row] = await requireDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(where);
  return row?.n ?? 0;
}

/** Engagement ids first — almost everything else hangs off them. */
async function engagementIdsFor(clientId: string): Promise<string[]> {
  const rows = await requireDb()
    .select({ id: schema.engagements.id })
    .from(schema.engagements)
    .where(eq(schema.engagements.clientId, clientId));
  return rows.map((row) => row.id);
}

/**
 * Every object in the bucket this client put there.
 *
 * Collected as explicit paths rather than swept by prefix: routing an intake
 * file copies its row into the pipeline table without copying the object, so
 * one file can be named twice, and the remove API takes keys anyway.
 */
async function storagePathsFor(engagementIds: string[]): Promise<string[]> {
  if (engagementIds.length === 0) return [];
  const db = requireDb();
  const [fars, priors, intake] = await Promise.all([
    db
      .select({ path: schema.farFiles.storagePath })
      .from(schema.farFiles)
      .where(inArray(schema.farFiles.engagementId, engagementIds)),
    db
      .select({ path: schema.priorDocuments.storagePath })
      .from(schema.priorDocuments)
      .where(inArray(schema.priorDocuments.engagementId, engagementIds)),
    db
      .select({ path: schema.intakeFiles.storagePath })
      .from(schema.intakeFiles)
      .where(inArray(schema.intakeFiles.engagementId, engagementIds)),
  ]);
  return [...new Set([...fars, ...priors, ...intake].map((row) => row.path).filter(Boolean))];
}

async function countsFor(clientId: string): Promise<{
  counts: DeletionCounts;
  engagementIds: string[];
  storagePaths: string[];
}> {
  const engagementIds = await engagementIdsFor(clientId);
  const storagePaths = await storagePathsFor(engagementIds);

  /**
   * Zero by construction when the client has no engagements — and never an
   * unfiltered count, which is what an empty `inArray` would quietly become.
   */
  const scoped = async (table: PgTable, column: PgColumn): Promise<number> =>
    engagementIds.length === 0 ? 0 : tally(table, inArray(column, engagementIds));

  const [
    locations,
    assets,
    fars,
    priors,
    intake,
    findings,
    filedRenditions,
    notices,
    protests,
    correctionMotions,
    appointments,
    memoryRows,
  ] = await Promise.all([
    tally(schema.clientLocations, eq(schema.clientLocations.clientId, clientId)),
    tally(schema.assets, eq(schema.assets.clientId, clientId)),
    scoped(schema.farFiles, schema.farFiles.engagementId),
    scoped(schema.priorDocuments, schema.priorDocuments.engagementId),
    scoped(schema.intakeFiles, schema.intakeFiles.engagementId),
    scoped(schema.findings, schema.findings.engagementId),
    scoped(schema.renditionFilings, schema.renditionFilings.engagementId),
    scoped(schema.assessmentNotices, schema.assessmentNotices.engagementId),
    scoped(schema.protestResolutions, schema.protestResolutions.engagementId),
    scoped(schema.correctionMotions, schema.correctionMotions.engagementId),
    tally(schema.agentAppointments, eq(schema.agentAppointments.clientId, clientId)),
    scoped(schema.classificationMemory, schema.classificationMemory.sourceEngagementId),
  ]);

  return {
    engagementIds,
    storagePaths,
    counts: {
      engagements: engagementIds.length,
      locations,
      assets,
      documents: fars + priors + intake,
      storageObjects: storagePaths.length,
      findings,
      filedRenditions,
      notices,
      protests,
      correctionMotions,
      appointments,
      memoryRows,
    },
  };
}

/** What deleting this client would destroy, before anyone confirms it. */
export async function previewClientDeletion(clientId: string): Promise<DeletionPreview> {
  const client = await fetchClient(clientId);
  const { counts } = await countsFor(clientId);
  return {
    clientId: client.id,
    clientName: client.name,
    status: client.status,
    counts,
    warnings: deletionWarnings(counts),
  };
}

/**
 * Delete the client and everything of theirs, then write the receipt.
 *
 * Rows go inside one transaction, in an order the schema forces: the five
 * tables that pin a location go first, then assets (which frees the import
 * batches they point at), then engagements — whose cascade carries the rest —
 * then the client's own children, then the client.
 *
 * The bucket is swept after the commit, on purpose. Object storage is not
 * transactional, and a file that refuses to delete is not a reason to hand a
 * client back their data. The receipt records what the sweep actually managed.
 */
export async function deleteClient(
  clientId: string,
  confirmName: string,
): Promise<DeletionReceipt> {
  const client = await fetchClient(clientId);
  if (confirmName.trim() !== client.name.trim()) {
    throw new HttpError(400, `Type the client's name exactly — "${client.name}" — to confirm.`);
  }

  const { counts, engagementIds, storagePaths } = await countsFor(clientId);
  const db = requireDb();

  await db.transaction(async (tx) => {
    if (engagementIds.length > 0) {
      const scope = engagementIds;
      // The five that hold `client_locations` under a restrict, motions first
      // because a motion may name a location no filing does.
      await tx
        .delete(schema.correctionMotions)
        .where(inArray(schema.correctionMotions.engagementId, scope));
      await tx
        .delete(schema.protestResolutions)
        .where(inArray(schema.protestResolutions.engagementId, scope));
      await tx
        .delete(schema.assessmentNotices)
        .where(inArray(schema.assessmentNotices.engagementId, scope));
      await tx
        .delete(schema.renditionExtensions)
        .where(inArray(schema.renditionExtensions.engagementId, scope));
      await tx
        .delete(schema.renditionFilings)
        .where(inArray(schema.renditionFilings.engagementId, scope));

      // Learned memory is cross-client and has no foreign key, so nothing
      // would ever carry it away. It holds this client's own text.
      await tx
        .delete(schema.classificationMemory)
        .where(inArray(schema.classificationMemory.sourceEngagementId, scope));
    }

    // Before the import batches they point at: `first_seen_batch_id` and
    // `last_seen_batch_id` declare no delete rule.
    await tx.delete(schema.assets).where(eq(schema.assets.clientId, clientId));

    await tx.delete(schema.engagements).where(eq(schema.engagements.clientId, clientId));
    await tx
      .delete(schema.agentAppointments)
      .where(eq(schema.agentAppointments.clientId, clientId));
    await tx
      .delete(schema.clientFilingProfiles)
      .where(eq(schema.clientFilingProfiles.clientId, clientId));
    await tx.delete(schema.clientLocations).where(eq(schema.clientLocations.clientId, clientId));
    await tx.delete(schema.clients).where(eq(schema.clients.id, clientId));
  });

  const sweep = await removeFarFiles(storagePaths);

  const [receipt] = await db
    .insert(schema.deletionReceipts)
    .values({
      clientId: client.id,
      clientName: client.name,
      counts,
      storageRemoved: sweep.removed,
      storageFailed: sweep.failed,
    })
    .returning();

  return {
    id: receipt!.id,
    clientId: receipt!.clientId,
    clientName: receipt!.clientName,
    counts: receipt!.counts as DeletionCounts,
    storageRemoved: receipt!.storageRemoved,
    storageFailed: receipt!.storageFailed as string[],
    deletedAt: receipt!.deletedAt.toISOString(),
  };
}
