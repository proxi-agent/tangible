import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Supabase Postgres holds *application* state: what we ingested, what a human
 * saved, what a human wrote down. The public roll itself lives in DuckDB, which
 * is where the analytical scans belong. Nothing here duplicates the warehouse.
 */

export const jurisdictions = pgTable('jurisdictions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  cadCode: text('cad_code').notNull(),
  state: text('state').notNull(),
  county: text('county').notNull(),
  fips: text('fips'),
  connectorId: text('connector_id').notNull(),
  blendedTaxRate: doublePrecision('blended_tax_rate').notNull(),
  homepageUrl: text('homepage_url'),
  dataPortalUrl: text('data_portal_url'),
  /** Set false to hide a jurisdiction from the UI without deleting its data. */
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ingestRuns = pgTable(
  'ingest_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jurisdictionId: text('jurisdiction_id')
      .notNull()
      .references(() => jurisdictions.id, { onDelete: 'cascade' }),
    connectorId: text('connector_id').notNull(),
    taxYears: integer('tax_years').array().notNull(),
    status: text('status').notNull().default('pending'),
    message: text('message'),
    error: text('error'),
    rowsLoaded: integer('rows_loaded').notNull().default(0),
    filesProcessed: integer('files_processed').notNull().default(0),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('ingest_runs_jurisdiction_idx').on(table.jurisdictionId, table.startedAt),
    index('ingest_runs_status_idx').on(table.status),
  ],
);

/**
 * One row per downloaded archive. The checksum is what makes a re-run cheap:
 * an unchanged file is skipped rather than re-parsed.
 */
export const sourceFiles = pgTable(
  'source_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jurisdictionId: text('jurisdiction_id')
      .notNull()
      .references(() => jurisdictions.id, { onDelete: 'cascade' }),
    taxYear: integer('tax_year').notNull(),
    kind: text('kind').notNull(),
    url: text('url').notNull(),
    fileName: text('file_name').notNull(),
    sizeBytes: integer('size_bytes'),
    checksum: text('checksum'),
    rowsLoaded: integer('rows_loaded').notNull().default(0),
    downloadedAt: timestamp('downloaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('source_files_unique').on(table.jurisdictionId, table.taxYear, table.kind),
  ],
);

/**
 * A named filter — the analytical equivalent of a saved search. Stores the same
 * shape the API accepts, so restoring a view is a straight replay.
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description'),
    jurisdictionId: text('jurisdiction_id').notNull(),
    taxYear: integer('tax_year').notNull(),
    /** Serialized AccountQuery. */
    query: jsonb('query').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('saved_views_jurisdiction_idx').on(table.jurisdictionId)],
);

/** A materialized outreach list, frozen at the moment it was built. */
export const leadLists = pgTable('lead_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  jurisdictionId: text('jurisdiction_id').notNull(),
  taxYear: integer('tax_year').notNull(),
  /** The query that produced it, kept so the list can be explained and rebuilt. */
  sourceQuery: jsonb('source_query').notNull(),
  accountCount: integer('account_count').notNull().default(0),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leadListItems = pgTable(
  'lead_list_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    leadListId: uuid('lead_list_id')
      .notNull()
      .references(() => leadLists.id, { onDelete: 'cascade' }),
    jurisdictionId: text('jurisdiction_id').notNull(),
    accountId: text('account_id').notNull(),
    ownerName: text('owner_name'),
    /** Snapshot of the metrics at capture time, so the list stays explainable. */
    snapshot: jsonb('snapshot').notNull(),
    status: text('status').notNull().default('new'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('lead_list_items_list_idx').on(table.leadListId),
    uniqueIndex('lead_list_items_unique').on(table.leadListId, table.accountId),
  ],
);

/** Free-form research notes pinned to a single account. */
export const accountNotes = pgTable(
  'account_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jurisdictionId: text('jurisdiction_id').notNull(),
    accountId: text('account_id').notNull(),
    body: text('body').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [index('account_notes_account_idx').on(table.jurisdictionId, table.accountId)],
);

// ---------------------------------------------------------------------------
// Workspace: clients, engagements, FAR intake
//
// The taxpayer side of the product. Everything below is per-client application
// state — confidential business data, never public record — so it lives here
// and in the private storage bucket, and must never reach the warehouse or the
// published Parquet export.
// ---------------------------------------------------------------------------

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status').notNull().default('prospect'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A physical situs. BPP is assessed where property sits on January 1, so a
 * client with three sites is three renditions — locations cannot be a text
 * column on the client. `jurisdictionId` is a loose reference to the warehouse
 * slug (like saved_views), not a FK: the jurisdictions table is only populated
 * where Supabase persistence is configured.
 */
export const clientLocations = pgTable(
  'client_locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    addressLine1: text('address_line1'),
    city: text('city'),
    stateCode: text('state_code'),
    zip: text('zip'),
    jurisdictionId: text('jurisdiction_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('client_locations_client_idx').on(table.clientId)],
);

/** One tax season's work for one client; FAR files and assets hang off this. */
export const engagements = pgTable(
  'engagements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    taxYear: integer('tax_year').notNull(),
    jurisdictionId: text('jurisdiction_id'),
    /**
     * The client's account on the public roll, once identified. This is what
     * turns the analysis from "here is what your register supports" into "here
     * is what you are assessed, and here is the gap" — without it there is no
     * "before" and no saving can honestly be claimed.
     */
    accountId: text('account_id'),
    /**
     * The taxpayer's SIC code. Texas keys the machinery life to what the
     * business does, not to the machine, so this decides the schedule for every
     * machinery asset on the engagement. Left null it falls back to the roll
     * account's published business code, and failing that to the category
     * default — with the report saying which applied.
     */
    sicCode: text('sic_code'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('engagements_client_idx').on(table.clientId, table.taxYear)],
);

/**
 * An uploaded fixed asset register and everything decided about it: the parse
 * summary, the AI's proposed mapping, and the mapping a human confirmed. The
 * stages are jsonb because their shapes are owned by Zod in @tangible/types —
 * the DB stores them, it does not interpret them.
 */
export const farFiles = pgTable(
  'far_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    originalFilename: text('original_filename').notNull(),
    /** Path inside the private far-uploads bucket. */
    storagePath: text('storage_path').notNull(),
    byteSize: integer('byte_size').notNull(),
    checksum: text('checksum'),
    contentType: text('content_type'),
    status: text('status').notNull().default('uploaded'),
    error: text('error'),
    /** SheetSummary[] once parsed. */
    sheetSummaries: jsonb('sheet_summaries'),
    /** FarMappingProposal once the AI has run. */
    proposal: jsonb('proposal'),
    /** FarMapping as confirmed by a human — the only mapping normalization runs. */
    confirmedMapping: jsonb('confirmed_mapping'),
    proposalModel: text('proposal_model'),
    assetCount: integer('asset_count').notNull().default(0),
    uploadedBy: text('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('far_files_engagement_idx').on(table.engagementId)],
);

/**
 * Canonical asset rows, one per data row that survived normalization. Wide and
 * nullable on purpose: registers differ in what they carry, and a missing value
 * must stay visibly missing rather than defaulting to something plausible.
 * `sourceSheet`/`sourceRow` keep every asset traceable to the exact cells it
 * came from, and `raw` keeps the cells themselves.
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    farFileId: uuid('far_file_id')
      .notNull()
      .references(() => farFiles.id, { onDelete: 'cascade' }),
    sourceSheet: text('source_sheet').notNull(),
    sourceRow: integer('source_row').notNull(),
    assetTag: text('asset_tag'),
    description: text('description'),
    category: text('category'),
    glAccount: text('gl_account'),
    acquisitionDate: text('acquisition_date'),
    acquisitionYear: integer('acquisition_year'),
    inServiceDate: text('in_service_date'),
    originalCost: doublePrecision('original_cost'),
    accumulatedDepreciation: doublePrecision('accumulated_depreciation'),
    netBookValue: doublePrecision('net_book_value'),
    quantity: doublePrecision('quantity'),
    serialNumber: text('serial_number'),
    location: text('location'),
    department: text('department'),
    vendor: text('vendor'),
    usefulLife: text('useful_life'),
    depreciationMethod: text('depreciation_method'),
    disposalDate: text('disposal_date'),
    disposalIndicator: text('disposal_indicator'),
    isDisposed: boolean('is_disposed').notNull().default(false),
    /** string[] of normalization warnings; empty array when clean. */
    warnings: jsonb('warnings').notNull().default([]),
    /** The source row's cells as parsed, for the lineage view. */
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('assets_engagement_idx').on(table.engagementId),
    index('assets_far_file_idx').on(table.farFileId),
  ],
);

/**
 * One decision per asset about which jurisdiction schedule values it.
 *
 * Kept beside the asset rather than on it because the two have different
 * lifetimes: re-confirming a mapping replaces every asset row for a file, and a
 * classification is a judgement about the *thing*, not about the spreadsheet
 * cell it arrived in. The cascade is deliberate all the same — an asset that no
 * longer exists has nothing left to classify — and re-running the engine after
 * a re-import costs one memory lookup per row, not a human.
 */
export const assetClassifications = pgTable(
  'asset_classifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** Null when the engine had nothing to classify on. Honest, and reviewable. */
    categoryKey: text('category_key'),
    lifeClassOverride: integer('life_class_override'),
    confidence: doublePrecision('confidence').notNull().default(0),
    rationale: text('rationale'),
    /** 'memory' | 'ai' | 'human'. */
    source: text('source').notNull(),
    /** 'auto-accepted' | 'needs-review' | 'confirmed'. */
    status: text('status').notNull(),
    model: text('model'),
    /** The memory key this description hashes to, stored whether or not it hit. */
    fingerprint: text('fingerprint'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One live decision per asset — the run upserts on this.
    uniqueIndex('asset_classifications_asset_unique').on(table.assetId),
    index('asset_classifications_queue_idx').on(table.engagementId, table.status),
    index('asset_classifications_fingerprint_idx').on(table.engagementId, table.fingerprint),
  ],
);

/**
 * The compounding part: every description a human has ever settled.
 *
 * This table is the reason the second engagement costs less than the first and
 * the fiftieth costs almost nothing. It deliberately outlives the engagement
 * that produced it — no foreign key — because its value is precisely that it
 * crosses clients. `sourceEngagementId` keeps the provenance so a contribution
 * can still be traced or withdrawn.
 *
 * It holds client-written text. That is internal-only data, never published and
 * never in the warehouse export, and the fingerprint drops serial numbers and
 * digits before it is stored.
 *
 * `conflicted` is what keeps it trustworthy: when two reviewers settle the same
 * text differently, the row records the disagreement and stops auto-applying
 * instead of letting whoever went last quietly rewrite everyone's future.
 */
export const classificationMemory = pgTable(
  'classification_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fingerprint: text('fingerprint').notNull(),
    /** A representative original description, so the row reads like something. */
    sampleDescription: text('sample_description').notNull(),
    categoryKey: text('category_key').notNull(),
    lifeClassOverride: integer('life_class_override'),
    /** How many times a human has settled this text. Ties go to the more-confirmed row. */
    confirmations: integer('confirmations').notNull().default(1),
    /** Set when a later decision disagreed; the row stops auto-applying. */
    conflicted: boolean('conflicted').notNull().default(false),
    /** The category the disagreement was with, kept so the queue can explain it. */
    conflictingCategoryKey: text('conflicting_category_key'),
    sourceEngagementId: uuid('source_engagement_id'),
    lastConfirmedBy: text('last_confirmed_by'),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('classification_memory_fingerprint_unique').on(table.fingerprint)],
);

export type Jurisdiction = typeof jurisdictions.$inferSelect;
export type NewJurisdiction = typeof jurisdictions.$inferInsert;
export type IngestRunRow = typeof ingestRuns.$inferSelect;
export type NewIngestRun = typeof ingestRuns.$inferInsert;
export type SourceFileRow = typeof sourceFiles.$inferSelect;
export type SavedView = typeof savedViews.$inferSelect;
export type LeadList = typeof leadLists.$inferSelect;
export type LeadListItem = typeof leadListItems.$inferSelect;
export type AccountNote = typeof accountNotes.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type NewClientRow = typeof clients.$inferInsert;
export type ClientLocationRow = typeof clientLocations.$inferSelect;
export type EngagementRow = typeof engagements.$inferSelect;
export type FarFileRow = typeof farFiles.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
export type AssetClassificationRow = typeof assetClassifications.$inferSelect;
export type NewAssetClassificationRow = typeof assetClassifications.$inferInsert;
export type ClassificationMemoryRow = typeof classificationMemory.$inferSelect;
