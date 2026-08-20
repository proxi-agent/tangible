import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { ClientLocationRow, ClientRow, EngagementRow, FarFileRow } from '@tangible/db';
import type {
  ClassificationStats,
  Client,
  ClientLocation,
  Engagement,
  EngagementAssetStats,
  FarFile,
  FarMapping,
  FarMappingProposal,
  SheetSummary,
} from '@tangible/types';
import { notFound } from '@/lib/route';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Row → API-shape converters and the small shared lookups. The jsonb columns
 * hold shapes owned by @tangible/types; they were validated on the way in, so
 * on the way out they are cast, not re-parsed.
 */

const iso = (d: Date) => d.toISOString();

export function clientDto(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    status: row.status as Client['status'],
    notes: row.notes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function locationDto(row: ClientLocationRow): ClientLocation {
  return {
    id: row.id,
    clientId: row.clientId,
    label: row.label,
    addressLine1: row.addressLine1,
    city: row.city,
    stateCode: row.stateCode,
    zip: row.zip,
    jurisdictionId: row.jurisdictionId,
    notes: row.notes,
  };
}

export function engagementDto(row: EngagementRow): Engagement {
  return {
    id: row.id,
    clientId: row.clientId,
    taxYear: row.taxYear,
    jurisdictionId: row.jurisdictionId,
    accountId: row.accountId,
    sicCode: row.sicCode,
    notes: row.notes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function farFileDto(row: FarFileRow): FarFile {
  return {
    id: row.id,
    engagementId: row.engagementId,
    originalFilename: row.originalFilename,
    byteSize: row.byteSize,
    contentType: row.contentType,
    status: row.status as FarFile['status'],
    error: row.error,
    sheetSummaries: row.sheetSummaries as SheetSummary[] | null,
    proposal: row.proposal as FarMappingProposal | null,
    confirmedMapping: row.confirmedMapping as FarMapping | null,
    proposalModel: row.proposalModel,
    assetCount: row.assetCount,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export async function fetchClient(clientId: string): Promise<ClientRow> {
  const db = requireDb();
  const [row] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  return row ?? notFound(`Unknown client: ${clientId}`);
}

export async function fetchEngagement(
  engagementId: string,
): Promise<{ engagement: EngagementRow; client: ClientRow }> {
  const db = requireDb();
  const [row] = await db
    .select({ engagement: schema.engagements, client: schema.clients })
    .from(schema.engagements)
    .innerJoin(schema.clients, eq(schema.clients.id, schema.engagements.clientId))
    .where(eq(schema.engagements.id, engagementId));
  return row ?? notFound(`Unknown engagement: ${engagementId}`);
}

export async function fetchFarFile(fileId: string): Promise<FarFileRow> {
  const db = requireDb();
  const [row] = await db.select().from(schema.farFiles).where(eq(schema.farFiles.id, fileId));
  return row ?? notFound(`Unknown FAR file: ${fileId}`);
}

/**
 * Stats read the *current versions* for the engagement, not the durable assets:
 * an asset the client owns is not necessarily on this year's register, and the
 * counts on an engagement page are about the register in front of you.
 */
const v = schema.assetVersions;
const currentVersions = (engagementId: string) =>
  and(eq(v.engagementId, engagementId), eq(v.isCurrent, true));

export async function engagementAssetStats(engagementId: string): Promise<EngagementAssetStats> {
  const db = requireDb();
  const [stats] = await db
    .select({
      assetCount: sql<number>`count(*)::int`,
      totalCost: sql<number>`coalesce(sum(${v.originalCost}), 0)::double precision`,
      disposedCount: sql<number>`(count(*) filter (where ${v.isDisposed}))::int`,
      warningCount: sql<number>`(count(*) filter (where jsonb_array_length(${v.warnings}) > 0))::int`,
      missingCostCount: sql<number>`(count(*) filter (where ${v.originalCost} is null))::int`,
      missingYearCount: sql<number>`(count(*) filter (where ${v.acquisitionYear} is null))::int`,
    })
    .from(v)
    .where(currentVersions(engagementId));

  return (
    stats ?? {
      assetCount: 0,
      totalCost: 0,
      disposedCount: 0,
      warningCount: 0,
      missingCostCount: 0,
      missingYearCount: 0,
    }
  );
}

/**
 * Where the engagement stands on classification.
 *
 * Counted from the assets side rather than the classifications side, so an
 * asset with no decision at all shows up as unclassified instead of quietly
 * vanishing from every denominator.
 */
export async function engagementClassificationStats(
  engagementId: string,
): Promise<ClassificationStats> {
  const db = requireDb();
  const c = schema.assetClassifications;
  const [stats] = await db
    .select({
      assetCount: sql<number>`count(*)::int`,
      classifiedCount: sql<number>`(count(*) filter (where ${c.id} is not null))::int`,
      unclassifiedCount: sql<number>`(count(*) filter (where ${c.id} is null))::int`,
      autoAcceptedCount: sql<number>`(count(*) filter (where ${c.status} = 'auto-accepted'))::int`,
      needsReviewCount: sql<number>`(count(*) filter (where ${c.status} = 'needs-review'))::int`,
      confirmedCount: sql<number>`(count(*) filter (where ${c.status} = 'confirmed'))::int`,
      fromMemoryCount: sql<number>`(count(*) filter (where ${c.source} = 'memory'))::int`,
    })
    .from(v)
    .leftJoin(c, eq(c.assetId, v.assetId))
    .where(currentVersions(engagementId));

  return (
    stats ?? {
      assetCount: 0,
      classifiedCount: 0,
      unclassifiedCount: 0,
      autoAcceptedCount: 0,
      needsReviewCount: 0,
      confirmedCount: 0,
      fromMemoryCount: 0,
    }
  );
}
