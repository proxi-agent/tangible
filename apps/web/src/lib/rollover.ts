import 'server-only';
import { eq } from 'drizzle-orm';
import { planRollover, type RolloverSource } from '@tangible/filing';
import type { Client, RolloverPlan, RolloverResult } from '@tangible/types';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Opening the next season across the book.
 *
 * The plan is recomputed from the database at both ends — shown before, and
 * re-derived inside the run — so the run creates engagements for the rows
 * that are ready *now*, not the rows a stale screen showed. Creation copies
 * the two fields that live on the engagement and would otherwise start over
 * blank: the county default and the SIC code that decides the machinery
 * schedule. Everything else a season needs — sites, assets, the filing
 * profile, the appointment, the filed record the carry-forward reads — is
 * durable on the client and is simply there when the new engagement loads.
 *
 * Running twice is safe by construction: the second run finds every client
 * already open and creates nothing.
 */

async function sources(): Promise<RolloverSource[]> {
  const db = requireDb();
  const rows = await db
    .select({
      clientId: schema.clients.id,
      clientName: schema.clients.name,
      clientStatus: schema.clients.status,
      engagementId: schema.engagements.id,
      taxYear: schema.engagements.taxYear,
      jurisdictionId: schema.engagements.jurisdictionId,
      sicCode: schema.engagements.sicCode,
      createdAt: schema.engagements.createdAt,
    })
    .from(schema.engagements)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.engagements.clientId));

  const byClient = new Map<string, RolloverSource>();
  for (const row of rows) {
    const entry = byClient.get(row.clientId) ?? {
      clientId: row.clientId,
      clientName: row.clientName,
      clientStatus: row.clientStatus as Client['status'],
      engagements: [],
    };
    entry.engagements.push({
      id: row.engagementId,
      taxYear: row.taxYear,
      jurisdictionId: row.jurisdictionId,
      sicCode: row.sicCode,
      createdAt: row.createdAt.toISOString(),
    });
    byClient.set(row.clientId, entry);
  }
  return [...byClient.values()];
}

/** Who would roll from this year into the next, without creating anything. */
export async function rolloverPlan(fromYear: number): Promise<RolloverPlan> {
  return planRollover(fromYear, await sources());
}

/** Create next year's engagement for every ready client. Safe to run twice. */
export async function runRollover(fromYear: number): Promise<RolloverResult> {
  const before = await rolloverPlan(fromYear);
  const ready = before.clients.filter((entry) => entry.standing === 'ready');

  if (ready.length > 0) {
    await requireDb()
      .insert(schema.engagements)
      .values(
        ready.map((entry) => ({
          clientId: entry.clientId,
          taxYear: before.toYear,
          jurisdictionId: entry.jurisdictionId,
          sicCode: entry.sicCode,
        })),
      );
  }

  return { createdCount: ready.length, plan: await rolloverPlan(fromYear) };
}
