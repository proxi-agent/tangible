import 'server-only';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { EngagementSite } from '@tangible/types';
import { engagementAssetsWhere } from '@/lib/asset-graph';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The sites this engagement's register names, and where we have put them.
 *
 * Grouped by the register's own location text because that is the unit the
 * work happens in. A register names its sites a handful of times across
 * thousands of rows; asking an operator to place rows one at a time would be
 * asking them to redo by hand what the file already said. The text is trimmed
 * and blank-mapped-to-null on ingest, so grouping on it directly cannot split
 * a site in two over a trailing space.
 *
 * Counts are over property still held, since that is what a return covers.
 * Disposed rows are reported alongside rather than mixed in — they are real
 * history and they were somewhere, but they are not on this year's rendition
 * and counting them would overstate every site on the screen.
 */
export async function engagementSites(engagementId: string): Promise<EngagementSite[]> {
  const db = requireDb();
  const rows = await db
    .select({
      text: schema.assetVersions.location,
      locationId: schema.assets.locationId,
      label: schema.clientLocations.label,
      isDisposed: schema.assetVersions.isDisposed,
      assetCount: sql<number>`count(*)::int`,
      totalCost: sql<number>`coalesce(sum(${schema.assetVersions.originalCost}), 0)::float8`,
    })
    .from(schema.assetVersions)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.assetVersions.assetId))
    .leftJoin(schema.clientLocations, eq(schema.clientLocations.id, schema.assets.locationId))
    .where(engagementAssetsWhere(engagementId))
    .groupBy(
      schema.assetVersions.location,
      schema.assets.locationId,
      schema.clientLocations.label,
      schema.assetVersions.isDisposed,
    );

  // A Map takes null as a key, which is what the "register named no site" group
  // needs — it is a real group with real property in it, not an absence.
  const sites = new Map<string | null, EngagementSite>();
  const site = (text: string | null): EngagementSite => {
    const existing = sites.get(text);
    if (existing) return existing;
    const created: EngagementSite = {
      text,
      assetCount: 0,
      disposedCount: 0,
      totalCost: 0,
      placements: [],
      unplacedCount: 0,
    };
    sites.set(text, created);
    return created;
  };

  for (const row of rows) {
    const entry = site(row.text);
    if (row.isDisposed) {
      entry.disposedCount += row.assetCount;
      continue;
    }
    entry.assetCount += row.assetCount;
    entry.totalCost += row.totalCost;
    if (row.locationId === null) {
      entry.unplacedCount += row.assetCount;
      continue;
    }
    const placement = entry.placements.find((p) => p.locationId === row.locationId);
    if (placement) placement.assetCount += row.assetCount;
    else
      entry.placements.push({
        locationId: row.locationId,
        label: row.label ?? 'Unknown location',
        assetCount: row.assetCount,
      });
  }

  for (const entry of sites.values()) {
    entry.placements.sort((a, b) => b.assetCount - a.assetCount || a.label.localeCompare(b.label));
  }

  return [...sites.values()].sort((a, b) => {
    // The unnamed group last: it is the one with the least to go on, and
    // leading with it would put the vaguest row at the top of every screen.
    if ((a.text === null) !== (b.text === null)) return a.text === null ? 1 : -1;
    return b.assetCount - a.assetCount || (a.text ?? '').localeCompare(b.text ?? '');
  });
}

/**
 * Put every asset the register filed under one location string at one place.
 *
 * Disposed rows are moved too. They are not on the return, but they did sit
 * somewhere, and leaving them behind would make next season's comparison read
 * a disposal as a site change.
 *
 * Writes `assets.location_id` — the durable asset, not the version — so the
 * placement outlives the register it was read from. The consequence, which is
 * correct but worth knowing: this moves the asset for every engagement it
 * appears in, because a lathe is in one building whatever season we are filing.
 *
 * @returns how many assets moved.
 */
export async function placeSite(
  engagementId: string,
  text: string | null,
  locationId: string,
): Promise<number> {
  const db = requireDb();
  const { engagement } = await fetchEngagement(engagementId);

  // The location has to belong to this engagement's client. Without the check a
  // client id in the request body would place one taxpayer's property at
  // another's address, on a document that gets sworn to.
  const [location] = await db
    .select({ id: schema.clientLocations.id })
    .from(schema.clientLocations)
    .where(
      and(
        eq(schema.clientLocations.id, locationId),
        eq(schema.clientLocations.clientId, engagement.clientId),
      ),
    );
  if (!location) throw new Error('That location belongs to a different client.');

  const targets = await db
    .selectDistinct({ assetId: schema.assetVersions.assetId })
    .from(schema.assetVersions)
    .where(
      and(
        engagementAssetsWhere(engagementId),
        text === null
          ? isNull(schema.assetVersions.location)
          : eq(schema.assetVersions.location, text),
      ),
    );
  if (targets.length === 0) return 0;

  await db
    .update(schema.assets)
    .set({ locationId, updatedAt: new Date() })
    .where(
      inArray(
        schema.assets.id,
        targets.map((t) => t.assetId),
      ),
    );
  return targets.length;
}
