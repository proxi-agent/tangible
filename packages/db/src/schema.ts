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

/**
 * Every table here calls `.enableRLS()`, and none of them defines a policy.
 * That combination denies every PostgREST client outright — anon and signed-in
 * alike — which is the intent.
 *
 * The anon key ships to every browser by design; it is an identifier, not a
 * secret. What makes that safe is that it grants nothing. Supabase's default
 * is the opposite: a table without RLS is world-readable through the REST API
 * to anyone holding that key, and this schema holds client registers, filed
 * renditions and the engagements around them — confidential under Tax Code
 * 22.27, the same constraint that keeps them out of the public export bucket
 * and out of git.
 *
 * Nothing in the app loses a read path. `supabase-browser.ts` is used only for
 * auth (sign in, get user, sign out), and every data path goes through this
 * app's own API routes on a direct Postgres connection as the table owner,
 * which is not subject to RLS. A policy would only be worth writing if the
 * browser ever queried a table directly, and it does not.
 *
 * The rule is uniform on purpose, including for tables holding nothing
 * confidential. A per-table judgement has to be made again every time someone
 * adds a table, and the failure mode of forgetting is silent. Declaring it
 * here also stops `drizzle-kit push` proposing to turn RLS off: push diffs the
 * database against this file, and RLS it does not know about reads as drift.
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
}).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
}).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
}).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

/**
 * One application of one confirmed mapping to one file.
 *
 * A file gets confirmed more than once in practice — a mis-set header row, a
 * cost column corrected — and each confirmation is its own batch rather than an
 * overwrite. That is what makes re-confirming both safe and auditable: the
 * earlier batch is marked superseded and its versions stay readable, so "why
 * did this asset's cost change" answers with a mapping instead of a shrug.
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    farFileId: uuid('far_file_id')
      .notNull()
      .references(() => farFiles.id, { onDelete: 'cascade' }),
    /** 'pending' | 'applied' | 'superseded' | 'failed'. */
    status: text('status').notNull().default('pending'),
    /** The mapping exactly as applied, so a batch can be replayed or explained. */
    mapping: jsonb('mapping').notNull(),
    assetCount: integer('asset_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),
    matchedCount: integer('matched_count').notNull().default(0),
    absentCount: integer('absent_count').notNull().default(0),
    changedCount: integer('changed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (table) => [
    index('import_batches_engagement_idx').on(table.engagementId, table.createdAt),
    index('import_batches_file_idx').on(table.farFileId, table.status),
  ],
).enableRLS();

/**
 * An asset as a thing the client owns — the durable half of the graph.
 *
 * Deliberately thin, and deliberately scoped to the **client** rather than to an
 * engagement or a file. A forklift does not stop existing because a new tax year
 * started or because somebody re-uploaded the register with a corrected header
 * row, and everything the product wants to do next — compare this year to last,
 * track a move between counties, show an asset's history — needs a row that
 * survives both of those.
 *
 * Identity is `(clientId, naturalKey, ordinal)`. The natural key is the
 * register's own asset tag where there is one and a fingerprint of description,
 * cost and acquisition where there is not; the ordinal separates rows that are
 * genuinely identical, like ten desks on one purchase order, which have to stay
 * ten assets. `matchMethod` records which of those applied, because a reviewer
 * looking at a disposal should know the difference between "this asset left" and
 * "one of these ten left".
 *
 * `currentVersionId` and the batch pointers are plain uuids, not foreign keys:
 * assets and versions reference each other, and one side has to give way for the
 * DDL to be creatable in any order.
 */
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Asset tag where the register carries one, else a description fingerprint. */
    naturalKey: text('natural_key').notNull(),
    /** Position among rows sharing this key. 0 unless the key is ambiguous. */
    ordinal: integer('ordinal').notNull().default(0),
    /** 'asset-tag' | 'fingerprint' | 'fingerprint-ordinal' | 'new'. */
    matchMethod: text('match_method').notNull(),
    firstSeenBatchId: uuid('first_seen_batch_id').notNull(),
    lastSeenBatchId: uuid('last_seen_batch_id').notNull(),
    currentVersionId: uuid('current_version_id'),
    /**
     * The tax year of the most recent register this asset appeared in, which is
     * what makes "current" mean the newest thing we know rather than the most
     * recent thing anyone happened to upload. Re-confirming a 2027 file after a
     * 2028 file has landed must not walk the asset's current values backwards,
     * and must not mark 2028-only assets absent for failing to appear in a 2027
     * register they were never going to be in.
     */
    currentTaxYear: integer('current_tax_year').notNull(),
    /**
     * Present in an earlier import and missing from the latest one, with no
     * disposal recorded. Not a disposal — a filtered export, a divested site
     * whose rows were dropped, and a genuine untracked retirement all look the
     * same from here, and only the client can say which.
     */
    isAbsent: boolean('is_absent').notNull().default(false),
    /**
     * Where the property sits, once resolved. The register's own location text
     * lives on the version (it is what the file said); this is our reading of
     * it, and it is what decides whose schedules value the asset.
     */
    locationId: uuid('location_id').references(() => clientLocations.id, {
      onDelete: 'set null',
    }),
    jurisdictionId: text('jurisdiction_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('assets_identity_unique').on(table.clientId, table.naturalKey, table.ordinal),
    index('assets_client_idx').on(table.clientId),
    index('assets_location_idx').on(table.locationId),
  ],
).enableRLS();

/**
 * The asset as one import saw it: every field, plus where in the workbook it
 * came from.
 *
 * This is the table that used to be `assets`, and it keeps that shape — wide and
 * nullable on purpose, because registers differ in what they carry and a missing
 * value must stay visibly missing rather than defaulting to something plausible.
 * `sourceSheet`/`sourceRow` keep every row traceable to the exact cells it came
 * from, and `raw` keeps the cells themselves.
 *
 * What is new is that a version is a *snapshot*, not the asset. Re-confirming a
 * mapping writes a new batch of versions and supersedes the old ones instead of
 * deleting them, so the history of what the client's own books said is
 * recoverable rather than overwritten.
 *
 * `engagementId` is denormalized from the batch because every read in the app is
 * engagement-scoped and the alternative is a three-table join on the hot path.
 */
export const assetVersions = pgTable(
  'asset_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
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
    /**
     * The legal entity that owns it. Renditions are filed per owner per
     * jurisdiction, so a group filing under three entities is three sets of
     * returns even at one address — and every ERP export carries this column.
     */
    entity: text('entity'),
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
    /**
     * False once a later batch for the same file supersedes it. Denormalized
     * from the batch's status because every engagement read filters on it and
     * the alternative is joining batches on the hot path.
     */
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The engagement read: current rows for one engagement, which is what every
    // page, stat and report starts from.
    index('asset_versions_engagement_idx').on(table.engagementId, table.isCurrent),
    index('asset_versions_asset_idx').on(table.assetId, table.createdAt),
    index('asset_versions_batch_idx').on(table.batchId),
    // One row per asset per batch — the diff upserts on this, so a retried
    // confirm cannot double-write a version.
    uniqueIndex('asset_versions_batch_asset_unique').on(table.batchId, table.assetId),
  ],
).enableRLS();

/**
 * What changed about an asset, and when.
 *
 * The reason the graph is worth building. A fixed asset register is a book
 * record that gets rewritten every year, and the questions that find money are
 * all about the rewriting: what appeared, what stopped appearing, what got
 * cheaper, what moved counties. None of them are answerable from a table that is
 * deleted and rebuilt on every upload.
 *
 * Two rules keep it honest. An asset vanishing from a register is recorded as
 * `absent`, never as a disposal — a filtered export and a genuine retirement are
 * indistinguishable from here. And book depreciation, which moves on every asset
 * every year, is stored like everything else but marked `routine`, so the
 * material changes stay legible instead of drowning.
 */
export const assetEvents = pgTable(
  'asset_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** The import that produced it. Null for classification events. */
    batchId: uuid('batch_id').references(() => importBatches.id, { onDelete: 'set null' }),
    /** An AssetEventKind. */
    kind: text('kind').notNull(),
    /** A TrackedAssetField on 'field-changed'; null on every other kind. */
    field: text('field'),
    previousValue: text('previous_value'),
    value: text('value'),
    /** 'material' | 'routine'. */
    significance: text('significance').notNull().default('material'),
    /** One sentence a person can read without decoding the columns above. */
    summary: text('summary').notNull(),
    actor: text('actor'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('asset_events_asset_idx').on(table.assetId, table.occurredAt),
    index('asset_events_batch_idx').on(table.batchId, table.kind),
  ],
).enableRLS();

/**
 * What one asset was worth, to one jurisdiction, in one tax year.
 *
 * Three value columns rather than one, because the three differ in kind and
 * collapsing them is how a report starts quoting our own arithmetic as the
 * district's opinion. `renderedValue` is a fact read off a filed document.
 * `scheduleValue` is our calculation. `allocatedAssessedValue` is an
 * apportionment of an account-level figure — districts assess accounts, not
 * assets — and it carries the basis it was apportioned on so it can never be
 * mistaken for something anyone observed.
 */
export const assetPositions = pgTable(
  'asset_positions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    taxYear: integer('tax_year').notNull(),
    jurisdictionId: text('jurisdiction_id').notNull(),
    /** The roll account this position belongs to, once identified. */
    accountId: text('account_id'),
    /** From a prior return, where we hold one. Observed, not computed. */
    renderedValue: doublePrecision('rendered_value'),
    /** From the district's schedules and our classification. */
    scheduleValue: doublePrecision('schedule_value'),
    /** Apportioned down from the account's assessed value. Never observed. */
    allocatedAssessedValue: doublePrecision('allocated_assessed_value'),
    allocationBasis: text('allocation_basis'),
    estimatedTax: doublePrecision('estimated_tax'),
    taxRate: doublePrecision('tax_rate'),
    /** 'rendered' | 'computed' | 'allocated'. */
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('asset_positions_unique').on(
      table.assetId,
      table.taxYear,
      table.jurisdictionId,
      table.source,
    ),
    index('asset_positions_year_idx').on(table.taxYear, table.jurisdictionId),
  ],
).enableRLS();

/**
 * One decision per asset about which jurisdiction schedule values it.
 *
 * A classification is a judgement about the *thing*, not about the spreadsheet
 * cell it arrived in, and now that assets are durable this points at the thing
 * literally rather than aspirationally. A re-import no longer discards
 * classifications — the asset it was made about is still the same row — so a
 * corrected mapping costs nothing in review time.
 *
 * `engagementId` stays, as provenance: which engagement the decision was made
 * on. It is not the query key for the review queue, because an asset carried
 * across two tax years has one classification and would otherwise disappear from
 * the second year's queue. The queue joins through the versions instead.
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
).enableRLS();

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
).enableRLS();

/**
 * A document the client filed or received: last year's rendition, an assessment
 * notice.
 *
 * The missing input. Until this existed the only "before" available was the
 * assessed total on the public roll — one number, in the four Texas counties
 * whose rolls we hold, and nothing at all about *how* the client got there.
 * That is why three of the five findings in the savings report carry no dollar
 * figure: we can show an asset would be cheaper on the right schedule, but not
 * that the client actually rendered it on the wrong one.
 *
 * Kept separate from `far_files` deliberately, despite the similar lifecycle. A
 * register is tabular and needs a column mapping confirmed before it means
 * anything; a rendition is a known form with a fixed structure and needs
 * extraction plus a footing check. Sharing a table would mean half its columns
 * are null for whichever kind you are looking at.
 */
export const priorDocuments = pgTable(
  'prior_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** 'rendition' | 'notice'. */
    kind: text('kind').notNull(),
    originalFilename: text('original_filename').notNull(),
    /** Path inside the private far-uploads bucket. Confidential under 22.27. */
    storagePath: text('storage_path').notNull(),
    byteSize: integer('byte_size').notNull(),
    checksum: text('checksum'),
    contentType: text('content_type'),
    /** 'uploaded' | 'extracting' | 'verified' | 'discrepant' | 'accepted' | 'failed'. */
    status: text('status').notNull().default('uploaded'),
    error: text('error'),
    /**
     * The tax year and account as the *document* states them, not as we expect
     * them. Denormalized out of the extraction so a mismatch is visible in a
     * list without opening the record — a return filed under another account is
     * the one error that would attribute someone else's numbers to this client.
     */
    documentTaxYear: integer('document_tax_year'),
    documentAccountId: text('document_account_id'),
    /** ExtractedRendition or ExtractedNotice, exactly as the model returned it. */
    extracted: jsonb('extracted'),
    /** FootingResult — whether the document adds up, and where it does not. */
    footing: jsonb('footing'),
    /** What the form prints as its total, and what its lines actually add to. */
    statedTotal: doublePrecision('stated_total'),
    derivedTotal: doublePrecision('derived_total'),
    extractionModel: text('extraction_model'),
    uploadedBy: text('uploaded_by'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('prior_documents_engagement_idx').on(table.engagementId, table.kind),
    index('prior_documents_year_idx').on(table.documentTaxYear),
  ],
).enableRLS();

/**
 * One reported line of a filed rendition.
 *
 * Rows rather than jsonb because these get corrected. The footing check exists
 * precisely to catch a misread figure, and catching one is worthless if fixing
 * it means hand-editing a blob — a reviewer changes the line, the footing
 * re-runs, and the document moves from discrepant to accepted.
 *
 * The grain is the form's, not ours: schedule, the filer's own property-type
 * wording, and year acquired. A rendition reports in aggregate and never
 * enumerates assets, so any per-asset figure here would be invented. Mapping
 * "Mach & Equip" onto our category vocabulary is a separate judgement, stored
 * in `categoryKey` once someone makes it.
 */
export const priorReturnLines = pgTable(
  'prior_return_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => priorDocuments.id, { onDelete: 'cascade' }),
    /** 'A'..'F', the form's own letters. */
    schedule: text('schedule').notNull(),
    /** The filer's wording, verbatim. Never normalized on the way in. */
    type: text('type').notNull(),
    yearAcquired: integer('year_acquired'),
    historicalCost: doublePrecision('historical_cost'),
    goodFaithEstimate: doublePrecision('good_faith_estimate'),
    sourcePage: integer('source_page'),
    /**
     * Our category, once something has decided what the filer's wording means:
     * a classification key, 'mixed' for wording that blends categories the form
     * printed as one number, or null when nothing has read it yet.
     *
     * The decision lives on the line rather than in its own table because it is
     * **derived and disposable**. Re-extracting a document replaces its lines
     * wholesale — a fresh reading of the same page — and the mapping should be
     * re-derived with them. What survives is `classification_memory`, keyed on
     * the wording itself, which replays every settled reading instantly and for
     * every later client who writes the same words.
     */
    categoryKey: text('category_key'),
    /** 'schedule' | 'memory' | 'ai' | 'human' — which of the four settled it. */
    mappingSource: text('mapping_source'),
    /** 'auto-accepted' | 'needs-review' | 'confirmed'. */
    mappingStatus: text('mapping_status'),
    mappingConfidence: doublePrecision('mapping_confidence'),
    mappingRationale: text('mapping_rationale'),
    /** The memory key this wording folds to, namespaced by schedule. */
    mappingFingerprint: text('mapping_fingerprint'),
    mappedBy: text('mapped_by'),
    mappedAt: timestamp('mapped_at', { withTimezone: true }),
    /** True once a reviewer corrected this line against the document. */
    isCorrected: boolean('is_corrected').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('prior_return_lines_document_idx').on(table.documentId, table.schedule),
    index('prior_return_lines_grain_idx').on(
      table.documentId,
      table.categoryKey,
      table.yearAcquired,
    ),
    /** The review queue: lines on this document still waiting on a person. */
    index('prior_return_lines_mapping_idx').on(table.documentId, table.mappingStatus),
  ],
).enableRLS();


/**
 * A committed finding set, and the findings in it.
 *
 * The reports themselves stay derived on read — see the header of
 * `@tangible/types/findings`. What lands here is the deliberate act of saying
 * "this is the analysis, as of now": the document that went to a client, and
 * the decisions taken against each line of it.
 */
export const findingSets = pgTable(
  'finding_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** 'savings' | 'register-comparison'. */
    source: text('source').notNull(),
    /**
     * The return a comparison ran against. Null for a savings set. Not cascaded
     * from the document on purpose: deleting a mis-uploaded PDF should not
     * silently retract a report that was already sent.
     */
    priorDocumentId: uuid('prior_document_id').references(() => priorDocuments.id, {
      onDelete: 'set null',
    }),
    taxYear: integer('tax_year').notNull(),
    /** Free text, for the human reason this run exists. */
    label: text('label'),

    /**
     * The full SavingsReport or RegisterComparison, exactly as produced. The
     * findings below are the part that gets worked; this is what makes the
     * document reproducible — coverage caveats, schedule year, the exemption
     * applied — none of which a total means anything without.
     */
    report: jsonb('report').notNull(),

    /**
     * A cheap digest of what this was computed from: the register, the
     * classifications, and the return's mapping. Compared against a freshly
     * computed one to tell a reader that the set is behind the workspace.
     * Deliberately not a content hash of the report — the point is to detect
     * that the *inputs* moved, including in ways that happen not to change a
     * number this time.
     */
    sourceFingerprint: text('source_fingerprint').notNull(),

    findingCount: integer('finding_count').notNull(),
    savingCount: integer('saving_count').notNull(),
    exposureCount: integer('exposure_count').notNull(),
    totalCost: doublePrecision('total_cost').notNull(),
    totalValue: doublePrecision('total_value'),
    headlineLabel: text('headline_label').notNull(),
    headlineValue: doublePrecision('headline_value'),
    headlineCaveat: text('headline_caveat'),

    committedBy: text('committed_by'),
    committedAt: timestamp('committed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('finding_sets_engagement_idx').on(table.engagementId, table.source, table.committedAt),
    index('finding_sets_document_idx').on(table.priorDocumentId),
  ],
).enableRLS();

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    setId: uuid('set_id')
      .notNull()
      .references(() => findingSets.id, { onDelete: 'cascade' }),
    /**
     * Denormalized from the set. A finding is read by engagement far more often
     * than by set — the disposition join needs it, and so does every "what is
     * still open on this client" question.
     */
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    /** Stable across runs of the same analysis. What a disposition is keyed on. */
    key: text('key').notNull(),
    ordinal: integer('ordinal').notNull(),

    title: text('title').notNull(),
    /** 'measured' | 'modeled' | 'screening'. */
    kind: text('kind').notNull(),
    /** 'saving' | 'exposure' | 'neutral'. */
    effect: text('effect').notNull(),
    cost: doublePrecision('cost').notNull(),
    /** Null where no schedule could price it, which is not the same as zero. */
    value: doublePrecision('value'),
    assetCount: integer('asset_count').notNull().default(0),

    summary: text('summary').notNull(),
    basis: text('basis').notNull(),
    assumption: text('assumption'),

    /** FindingEvidence[] — the register rows behind the claim. */
    evidence: jsonb('evidence').notNull(),
    /** ComparisonCell[] — the return's side. Empty for a savings finding. */
    cells: jsonb('cells').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('findings_set_idx').on(table.setId, table.ordinal),
    index('findings_engagement_idx').on(table.engagementId, table.source, table.key),
  ],
).enableRLS();

/**
 * What was decided about a finding — the one durable thing here.
 *
 * Keyed on (engagement, source, key) rather than on a finding row, because
 * findings are disposable and decisions are not. Re-running an analysis after
 * new assets land replaces every finding row and replays every decision, so
 * only genuinely new findings arrive undecided. Same division as the line
 * mapping: the derived reading is thrown away and rebuilt, the human answer
 * survives it.
 *
 * `decidedCost` / `decidedValue` record what the finding claimed at the moment
 * of the decision. Accepting a $96,000 position is not consent to a $184,000
 * one, and without these a carried decision would quietly assert otherwise.
 */
export const findingDispositions = pgTable(
  'finding_dispositions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    key: text('key').notNull(),
    /** 'accepted' | 'rejected' | 'pending-client'. Undecided has no row. */
    status: text('status').notNull(),
    note: text('note'),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    decidedCost: doublePrecision('decided_cost'),
    decidedValue: doublePrecision('decided_value'),
    /** The set the decision was made on, for the audit trail back to a document. */
    decidedSetId: uuid('decided_set_id').references(() => findingSets.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [
    uniqueIndex('finding_dispositions_key_unique').on(table.engagementId, table.source, table.key),
  ],
).enableRLS();


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
export type ImportBatchRow = typeof importBatches.$inferSelect;
export type NewImportBatchRow = typeof importBatches.$inferInsert;
export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
export type AssetVersionRow = typeof assetVersions.$inferSelect;
export type NewAssetVersionRow = typeof assetVersions.$inferInsert;
export type AssetEventRow = typeof assetEvents.$inferSelect;
export type NewAssetEventRow = typeof assetEvents.$inferInsert;
export type AssetPositionRow = typeof assetPositions.$inferSelect;
export type NewAssetPositionRow = typeof assetPositions.$inferInsert;
export type AssetClassificationRow = typeof assetClassifications.$inferSelect;
export type NewAssetClassificationRow = typeof assetClassifications.$inferInsert;
export type ClassificationMemoryRow = typeof classificationMemory.$inferSelect;
export type PriorDocumentRow = typeof priorDocuments.$inferSelect;
export type NewPriorDocumentRow = typeof priorDocuments.$inferInsert;
export type PriorReturnLineRow = typeof priorReturnLines.$inferSelect;
export type NewPriorReturnLineRow = typeof priorReturnLines.$inferInsert;
export type FindingSetRow = typeof findingSets.$inferSelect;
export type NewFindingSetRow = typeof findingSets.$inferInsert;
export type FindingRow = typeof findings.$inferSelect;
export type NewFindingRow = typeof findings.$inferInsert;
export type FindingDispositionRow = typeof findingDispositions.$inferSelect;
export type NewFindingDispositionRow = typeof findingDispositions.$inferInsert;
