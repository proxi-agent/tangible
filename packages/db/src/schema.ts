import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  real,
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
    /**
     * This site's account on the public roll.
     *
     * It lives here rather than on the engagement because that is where the
     * district puts it: Harris opens one BPP account per business location, so
     * a taxpayer with two sites has two accounts and files two returns. It is
     * also durable in a way an engagement is not — the same account number is
     * the site's identity season after season, which is what lets a 2028
     * engagement compare against the 2027 assessment without being told again.
     */
    accountId: text('account_id'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('client_locations_client_idx').on(table.clientId)],
).enableRLS();

/**
 * The facts a return needs that a fixed asset register was never going to hold.
 *
 * A register knows what the company owns. Form 50-144 also asks who the owner
 * is on the roll, where their notices go, what the business does in their own
 * words, and — where we sign — what authorises us to. None of that is derivable
 * from an asset list, and each missing one is a blocking omission on a sworn
 * document, so they are recorded once per client rather than retyped per
 * filing.
 *
 * One row per client, hence `clientId` as the primary key: a taxpayer has one
 * identity on the roll, not a history of them. Everything except that key is
 * nullable, because a half-filled profile is the normal state of a client
 * between the first call and the first filing, and the form already knows how
 * to name what is still missing.
 */
export const clientFilingProfiles = pgTable('client_filing_profiles', {
  clientId: uuid('client_id')
    .primaryKey()
    .references(() => clients.id, { onDelete: 'cascade' }),
  /**
   * The owner as it appears on the roll. Usually the name we file the client
   * under and legally need not be — a d/b/a, a renamed entity, or a roll that
   * never caught up. Null means nobody has confirmed it differs, and the
   * client's own name is used.
   */
  ownerName: text('owner_name'),
  mailingAddressLine1: text('mailing_address_line1'),
  mailingAddressLine2: text('mailing_address_line2'),
  mailingCity: text('mailing_city'),
  mailingStateCode: text('mailing_state_code'),
  mailingZip: text('mailing_zip'),
  /**
   * What the business does, in the owner's words. Distinct from the SIC code
   * and not a restatement of it: Texas keys machinery life to the business
   * rather than the machine, so this is what an appraiser reads when the code
   * is generic.
   */
  businessDescription: text('business_description'),
  /** The title the signature is made in — 'Agent' for us, an officer's title otherwise. */
  signerTitle: text('signer_title'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** One tax season's work for one client; FAR files and assets hang off this. */
export const engagements = pgTable(
  'engagements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    taxYear: integer('tax_year').notNull(),
    /**
     * The county this season's work is for, and the default for its sites. A
     * location may name its own, and where it does that one wins — the property
     * is taxed where it stood, not where the engagement was opened.
     */
    jurisdictionId: text('jurisdiction_id'),
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
/**
 * One file from a client drop, before anybody has decided what it is.
 *
 * The staging ground for multi-file intake: everything the client sent lands
 * here first, the triage model proposes where each file belongs — the register
 * pipeline, the priors pipeline, or nowhere — and a person confirms. Routing
 * copies the file into its pipeline's own table; this row keeps the record of
 * the drop and the decision, because "why is there no 2025 rendition on file"
 * is answered by the row that says somebody dismissed it.
 */
export const intakeFiles = pgTable(
  'intake_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    originalFilename: text('original_filename').notNull(),
    /** Path inside the private far-uploads bucket, under intake/. */
    storagePath: text('storage_path').notNull(),
    byteSize: integer('byte_size').notNull(),
    checksum: text('checksum'),
    contentType: text('content_type'),
    /** Sheet names when the file opened as a workbook — triage evidence. */
    sheetNames: jsonb('sheet_names'),
    /** 'register' | 'rendition' | 'notice' | 'other', when triage ran. */
    proposedRoute: text('proposed_route'),
    proposedConfidence: real('proposed_confidence'),
    proposedReason: text('proposed_reason'),
    triageModel: text('triage_model'),
    /** DocumentPeek — what a first look read off a PDF or image; null for workbooks. */
    peek: jsonb('peek'),
    /** 'triaged' | 'routed' | 'dismissed' | 'failed'. */
    status: text('status').notNull().default('triaged'),
    /** Which pipeline the human sent it down, and the row it became there. */
    routedKind: text('routed_kind'),
    routedId: uuid('routed_id'),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('intake_files_engagement_idx').on(table.engagementId)],
).enableRLS();

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
 * One question the mapping put to the client, and what came back.
 *
 * Asks are born inside a proposal, but they cannot live there: a re-propose
 * overwrites the proposal jsonb, and an answer somebody collected from the
 * client must survive that. So each ask is its own row, synced from every
 * proposal by fingerprint — a reworded question keeps its answer, a new
 * question gets a new open row, and a question the model stopped asking stays
 * on the record with whatever was learned.
 */
export const mappingAsks = pgTable(
  'mapping_asks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    farFileId: uuid('far_file_id')
      .notNull()
      .references(() => farFiles.id, { onDelete: 'cascade' }),
    /** Stable identity across re-proposals; computed in packages/far asks.ts. */
    fingerprint: text('fingerprint').notNull(),
    question: text('question').notNull(),
    why: text('why').notNull(),
    /** Canonical field the answer decides, when it is that specific. */
    field: text('field'),
    sheetName: text('sheet_name'),
    /** 'open' | 'answered' | 'dismissed'. */
    status: text('status').notNull().default('open'),
    /** The client's answer, verbatim as relayed. */
    answer: text('answer'),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('mapping_asks_unique').on(table.farFileId, table.fingerprint)],
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
 * A rendition that was actually filed, frozen as it went out.
 *
 * Every other read in this app is derived: ask for the rendition and it is
 * rebuilt from the register as it stands this second, which is exactly right
 * until a document is sworn to and then exactly wrong. The register keeps
 * moving after the return goes out — a late invoice, a corrected cost, a
 * disposal nobody had recorded — and the form on screen quietly stops being the
 * form that was filed. The penalty under 22.28 is assessed against what was
 * rendered, so "what did we render" has to have an answer that does not depend
 * on the current state of anything.
 *
 * What is frozen is the *input* — the rendition document, the party, the signer
 * — and not the printed sheet. The builders that turn those into paper are pure
 * functions, so a frozen input re-renders through whatever renderer is current;
 * freezing the output too would put every number in the database twice and let
 * the two copies drift. The cost is that a later form revision re-renders the
 * same content on a different sheet, which is why the revision and checksum of
 * the PDF that was actually filled are columns here: the record says so out
 * loud rather than pretending the paper is identical.
 *
 * One row per return per attempt. A site that files an amendment gets a second
 * row and the first becomes `superseded`; nothing is ever updated in place and
 * nothing is deleted, because this table is the evidence.
 */
export const renditionFilings = pgTable(
  'rendition_filings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /**
     * The site whose return this is. Not cascaded away with the location: a
     * site can be closed, renamed or merged, and none of that unfiles the
     * return that went out under it.
     */
    locationId: uuid('location_id')
      .notNull()
      .references(() => clientLocations.id, { onDelete: 'restrict' }),
    /** The label and account as they read at filing, not as they read today. */
    locationLabel: text('location_label').notNull(),
    accountId: text('account_id'),
    taxYear: integer('tax_year').notNull(),
    jurisdictionId: text('jurisdiction_id'),

    /** 'filed' | 'superseded' | 'void'. */
    status: text('status').notNull().default('filed'),
    /** 'cost' | 'estimate'. */
    basis: text('basis').notNull(),
    filedByAgent: boolean('filed_by_agent').notNull(),
    /** 'certified-mail' | 'mail' | 'efile' | 'email' | 'hand-delivered'. */
    method: text('method').notNull(),
    /**
     * The postmark or submission date, as a plain date. Timeliness under 1.08
     * is decided by the day it was mailed, in the district's timezone, and a
     * timestamp here would let a late-evening filing in one zone record itself
     * as the following day in another.
     */
    filedOn: date('filed_on').notNull(),
    /** Certified article number, e-file confirmation — what proves it went. */
    confirmation: text('confirmation'),
    note: text('note'),

    /** What the form said. Columns, so a list of filings needs no unpacking. */
    totalHistoricalCost: doublePrecision('total_historical_cost').notNull(),
    totalGoodFaithEstimate: doublePrecision('total_good_faith_estimate'),
    scheduleValue: doublePrecision('schedule_value').notNull(),
    assetCount: integer('asset_count').notNull(),

    /** The Rendition document, exactly as built at the moment of filing. */
    rendition: jsonb('rendition').notNull(),
    /** FormParty — owner name, mailing address, situs, business description. */
    party: jsonb('party').notNull(),
    /** FormSigner — who signed it, in what capacity, under what appointment. */
    signer: jsonb('signer').notNull(),
    /**
     * The assets that were on this return, by id.
     *
     * The rendition reports in aggregate, which is what the district receives
     * and all a re-render needs. This is the part the paper does not carry: next
     * season, "asset 4471 was rendered in 2026 and is not on the 2027 register"
     * is a question worth asking, and nothing else records the answer.
     */
    assetIds: jsonb('asset_ids').notNull(),

    formRevision: text('form_revision').notNull(),
    formSha256: text('form_sha256').notNull(),

    recordedBy: text('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    voidedBy: text('voided_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => [
    index('rendition_filings_engagement_idx').on(table.engagementId, table.status),
    /** Last season's return for this site, which is next season's starting point. */
    index('rendition_filings_site_year_idx').on(table.locationId, table.taxYear, table.status),
  ],
).enableRLS();

/**
 * A rendition extension, as requested and as answered.
 *
 * Tax Code 22.23(b) has two sentences and they are not the same promise. The
 * first says the chief appraiser *shall* extend to May 15 on written request
 * made before the deadline — that extension is the owner's by right, so the
 * date it buys is real the moment a timely request goes out, whether or not
 * the district has written back. The second says he *may* add up to fifteen
 * more days for good cause. That one is discretion, and a deadline moved on
 * the strength of a discretionary request nobody has granted is a deadline
 * somebody will miss.
 *
 * So `kind` is stored, and it is what decides whether a row with no answer yet
 * moves anything. Everything else follows the rule the filings table sets: no
 * row is ever edited, a mistake is a void, and the date the extension bought
 * is written down rather than recomputed — a record whose date moves when our
 * calendar code changes is not a record.
 */
export const renditionExtensions = pgTable(
  'rendition_extensions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** Restricted for the same reason the filing's is: closing a site un-files nothing. */
    locationId: uuid('location_id')
      .notNull()
      .references(() => clientLocations.id, { onDelete: 'restrict' }),
    locationLabel: text('location_label').notNull(),
    accountId: text('account_id'),
    taxYear: integer('tax_year').notNull(),

    /** 'standard' (22.23(b), to May 15) | 'additional' (up to 15 more days). */
    kind: text('kind').notNull(),
    /** 'requested' | 'granted' | 'denied' | 'superseded' | 'void'. */
    status: text('status').notNull().default('requested'),

    /**
     * The day the written request went out, as a plain date.
     *
     * Timeliness is the whole question — a standard request is only good if it
     * was made on or before the original due date — and under 1.08 that is
     * decided by the day it was mailed. A timestamp would let an evening
     * request in one zone record itself as the next day in another, which on
     * April 15 is the difference between an extension and a penalty.
     */
    requestedOn: date('requested_on').notNull(),
    /** 'certified-mail' | 'mail' | 'efile' | 'email' | 'hand-delivered'. */
    method: text('method').notNull(),
    confirmation: text('confirmation'),
    /**
     * The good cause stated. Required for an additional request, which the
     * statute grants only for cause — a request that never stated one has no
     * argument to make if the district says no.
     */
    reason: text('reason'),
    note: text('note'),

    /**
     * The deadline this extension buys, as a plain date.
     *
     * Written down rather than derived. A standard extension runs to May 15
     * observed; an additional one runs to whatever day the district named,
     * which is the district's answer and not ours to recompute.
     */
    extendedTo: date('extended_to').notNull(),

    /** When the district answered, and how we know. Null while outstanding. */
    answeredOn: date('answered_on'),
    answerNote: text('answer_note'),

    recordedBy: text('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    voidedBy: text('voided_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => [
    index('rendition_extensions_engagement_idx').on(table.engagementId, table.status),
    /** Which deadline this site is actually working to, this year. */
    index('rendition_extensions_site_year_idx').on(table.locationId, table.taxYear, table.status),
  ],
).enableRLS();

/**
 * A notice of appraised value, as it arrived.
 *
 * The season did not end when the return went out. Under 25.19 the chief
 * appraiser delivers this by May 1 for personal property, and it is the first
 * time anybody learns whether the filing worked — and the last chance to do
 * anything about it. A late rendition costs 10% of the taxes on the property
 * (22.28). A value nobody protested costs the whole difference between what the
 * district decided and what the property is worth, for the year.
 *
 * Per site and year, like the filing and the extension, because the notice
 * comes addressed to an account and an account belongs to a site. The same
 * discipline holds: a corrected notice is a second row and the first becomes
 * `superseded`, a mistake is a void, and nothing is edited in place except the
 * one fact that is genuinely ours to add later — the day we protested.
 *
 * Deliberately not `prior_documents`, which also holds notices. That table is a
 * *file*: it requires a storage path, a filename and a byte count, and its
 * lifecycle is extraction and review of a prior year's paper. This one is a
 * record of what a district concluded about a return we filed, typed off the
 * envelope on the day it lands, usually before anybody has scanned anything.
 */
export const assessmentNotices = pgTable(
  'assessment_notices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** Restricted for the same reason the filing's is: closing a site un-notices nothing. */
    locationId: uuid('location_id')
      .notNull()
      .references(() => clientLocations.id, { onDelete: 'restrict' }),
    locationLabel: text('location_label').notNull(),
    accountId: text('account_id'),
    taxYear: integer('tax_year').notNull(),
    /** The district as the notice names itself, where somebody typed it in. */
    districtName: text('district_name'),

    /** 'active' | 'superseded' | 'void'. */
    status: text('status').notNull().default('active'),

    /**
     * The date printed on the notice, as a plain date.
     *
     * This is the clock. 41.44 counts thirty days from delivery, and 1.07
     * presumes delivery on the day the notice went in the mail — so this date
     * is usually the day the window opened. A timestamp would let a notice
     * dated May 1 record itself as April 30 in another zone, which at the far
     * end of thirty days is a day of protest window.
     */
    noticedOn: date('noticed_on').notNull(),
    /** When it actually arrived, where that is known and differs from the above. */
    deliveredOn: date('delivered_on'),
    /**
     * The protest deadline the notice itself prints.
     *
     * Stored rather than computed because it is the district's own statement
     * and it is what the counter will enforce. Where it disagrees with 41.44 —
     * commonly a flat May 15 on a notice mailed in late April — the
     * disagreement is the finding, and it cannot be one if only our answer
     * survives.
     */
    printedDeadline: date('printed_deadline'),

    /** What the district concluded. Null where the notice does not print it. */
    appraisedValue: doublePrecision('appraised_value'),
    assessedValue: doublePrecision('assessed_value'),
    priorYearValue: doublePrecision('prior_year_value'),
    /**
     * Set where the notice says the 22.28 rendition penalty was applied.
     *
     * Worth a column of its own rather than a line in the note, because it
     * starts a second and shorter clock: 22.30(b) gives thirty days from this
     * notice to ask for a waiver, with no May 15 floor under it. A firm can
     * protest the value in time and lose the penalty anyway.
     */
    renditionPenaltyApplied: boolean('rendition_penalty_applied'),

    note: text('note'),

    /** The day a protest went in, which closes the window whatever the date said. */
    protestFiledOn: date('protest_filed_on'),
    protestNote: text('protest_note'),

    recordedBy: text('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    voidedBy: text('voided_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => [
    index('assessment_notices_engagement_idx').on(table.engagementId, table.status),
    /** Which value this site is living with this year, and how long there is to argue. */
    index('assessment_notices_site_year_idx').on(table.locationId, table.taxYear, table.status),
  ],
).enableRLS();

/**
 * How a protest ended.
 *
 * The trail used to stop at `assessment_notices.protest_filed_on`, which is the
 * point at which an engagement stops being able to answer the two questions it
 * exists to answer: what did the year come to, and what does next year start
 * from. With no ending on file the noticed value is the only value in the
 * record, so a protest that won $200,000 back reads exactly like one nobody
 * ever worked — including to the carry-forward that opens the next season.
 *
 * Hung off the notice rather than the site, because a resolution is an answer
 * to one particular piece of mail. Where a corrected notice supersedes an
 * earlier one, the resolution stays with the notice it actually resolved.
 *
 * Same discipline as everything around it: a correction is a second row and the
 * first becomes `superseded`, a mistake is a void, and no row is edited.
 */
export const protestResolutions = pgTable(
  'protest_resolutions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /**
     * Cascades, unlike the location below.
     *
     * A resolution has no meaning apart from the notice it resolves — it does
     * not even carry the value it started from except as a copy — so a notice
     * that is genuinely deleted takes it with it. Voiding a notice is the
     * ordinary path and leaves both rows standing.
     */
    noticeId: uuid('notice_id')
      .notNull()
      .references(() => assessmentNotices.id, { onDelete: 'cascade' }),
    /** Restricted for the same reason the notice's is: closing a site settles nothing. */
    locationId: uuid('location_id')
      .notNull()
      .references(() => clientLocations.id, { onDelete: 'restrict' }),
    locationLabel: text('location_label').notNull(),
    accountId: text('account_id'),
    taxYear: integer('tax_year').notNull(),

    /** 'recorded' | 'superseded' | 'void'. */
    status: text('status').notNull().default('recorded'),

    /**
     * 'informal' | 'arb' | 'withdrawn' | 'dismissed'.
     *
     * The column the rest of the row means nothing without. An informal
     * agreement is final under 1.111(e) and has no appeal after it; a written
     * ARB order under 41.47 starts sixty days to district court under 42.21(a)
     * and to 41A arbitration; a withdrawal or a dismissal determines nothing
     * and leaves the noticed value standing. Four endings, four different
     * answers to "is this year closed".
     */
    stage: text('stage').notNull(),
    /** The day it ended: the agreement, the order, the withdrawal, the dismissal. */
    resolvedOn: date('resolved_on').notNull(),

    /**
     * What the notice said, copied here at the moment of recording.
     *
     * Denormalised deliberately. The reduction this represents is the number a
     * firm bills on and reports to the client, and it must not silently change
     * because somebody later corrected the notice — the same reason a filing
     * freezes its asset ids.
     */
    noticedValue: doublePrecision('noticed_value'),
    /** What it came to. Null where nothing was determined. */
    finalValue: doublePrecision('final_value'),
    /**
     * 'waived' | 'upheld', or null where the resolution does not say.
     *
     * Separate from the value because winning one is not winning the other.
     * 22.28's penalty is 10% of the taxes on the property, so a settlement that
     * halves the value halves the penalty and leaves it owed. Waiving it is a
     * separate request under 22.30 on a clock that closed thirty days after the
     * notice — and null here is the answer that most needs surfacing, not the
     * one that means nothing happened.
     */
    penaltyOutcome: text('penalty_outcome'),
    /** The ARB order number, which is what a 42.21 petition is filed against. */
    orderReference: text('order_reference'),

    note: text('note'),

    recordedBy: text('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    voidedBy: text('voided_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => [
    index('protest_resolutions_engagement_idx').on(table.engagementId, table.status),
    /** The read that matters: how did this notice end. */
    index('protest_resolutions_notice_idx').on(table.noticeId, table.status),
  ],
).enableRLS();

/**
 * A drafted protest brief: the argument for one notice, frozen at draft time.
 *
 * Two jsonb columns doing two different jobs. `facts` is the deterministic
 * record the draft was allowed to argue from — assembled by code, no model —
 * and `brief` is what the model made of it. Kept together so a brief read
 * months later is a statement about what the record said then, not a claim
 * that recomputes itself. Rows are never edited; redrafting inserts a new row
 * and the newest wins on read.
 */
export const protestBriefs = pgTable(
  'protest_briefs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    noticeId: uuid('notice_id')
      .notNull()
      .references(() => assessmentNotices.id, { onDelete: 'cascade' }),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** The assembled inputs, frozen. See ProtestBriefFactsSchema. */
    facts: jsonb('facts').notNull(),
    /** The drafted argument. See ProtestBriefSchema. */
    brief: jsonb('brief').notNull(),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('protest_briefs_notice_idx').on(table.noticeId, table.createdAt)],
).enableRLS();

/**
 * A drafted unblock plan: the work that releases an engagement's blocked
 * returns, and the client outreach it requires — frozen at draft time.
 *
 * Same shape and same discipline as `protestBriefs`: `facts` is what the
 * assembler selected (blocked returns, blocking problems, operative
 * deadlines), `plan` is what the model made of it, rows are never edited,
 * and redrafting after the season moves inserts a new row.
 */
export const unblockPlans = pgTable(
  'unblock_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** The assembled inputs, frozen. See UnblockFactsSchema. */
    facts: jsonb('facts').notNull(),
    /** The drafted plan. See UnblockPlanSchema. */
    plan: jsonb('plan').notNull(),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('unblock_plans_engagement_idx').on(table.engagementId, table.createdAt)],
).enableRLS();

/**
 * A drafted season result letter: the scoreboard's facts and the client-facing
 * telling of them, frozen together. Rows are never edited — redrafting after
 * the season moves inserts a new row, and reads take the newest.
 */
export const resultLetters = pgTable(
  'result_letters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** The assembled scoreboard, frozen. See LetterFactsSchema. */
    facts: jsonb('facts').notNull(),
    /** The drafted letter. See ResultLetterSchema. */
    letter: jsonb('letter').notNull(),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('result_letters_engagement_idx').on(table.engagementId, table.createdAt)],
).enableRLS();


/**
 * A motion filed under 25.25 to correct an appraisal roll after the fact.
 *
 * The open-years board asks whether a year can still be reopened. This is the
 * record of having tried, and it is what makes 25.25(c-1)(3) answerable: a
 * previous motion under the *section* that was agreed to, determined, or
 * forfeited closes (c-1) for that property and year. Without this table the bar
 * was permanently false and the board was telling firms a route was open that
 * their own earlier filing had shut.
 *
 * Kept on the (account, year) grain the board uses. The years worth a motion
 * are mostly years the firm was not engaged for, and their only paper names an
 * account — so `location_id` is set where the site is known and left null
 * rather than guessed at, which is the opposite of the notice table's rule and
 * deliberate for that reason.
 *
 * Append-only. Recording an outcome inserts a new row carrying the same facts
 * plus the ending and supersedes the earlier one; a motion recorded in error is
 * voided with a reason. What we believed about a live motion in March is worth
 * as much as how it ended.
 */
export const correctionMotions = pgTable(
  'correction_motions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The engagement the work was done under, which is not the year at issue. */
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** Null where the account has not been matched to a site. */
    locationId: uuid('location_id').references(() => clientLocations.id, { onDelete: 'restrict' }),
    locationLabel: text('location_label'),
    accountId: text('account_id'),
    districtName: text('district_name'),

    /** The year being corrected. Almost never the engagement's year. */
    subjectTaxYear: integer('subject_tax_year').notNull(),
    /** 'c' | 'c-1' | 'd' — which subsection it was brought under. */
    route: text('route').notNull(),

    /** 'recorded' | 'superseded' | 'void'. */
    status: text('status').notNull().default('recorded'),

    /** The day the motion went to the district. */
    filedOn: date('filed_on').notNull(),
    /** What the roll said when it went in, copied so the two cannot drift. */
    rolledValue: doublePrecision('rolled_value'),
    /** What the motion says the value should be. 25.25(d)'s threshold rides on it. */
    claimedValue: doublePrecision('claimed_value'),
    /** What the motion says is wrong, in the firm's own words. */
    groundsNote: text('grounds_note'),

    /**
     * The day the taxes on the undisputed portion were paid.
     *
     * 25.26(b) makes that payment before the delinquency date the condition of
     * a final determination, and 25.26(a) says filing the motion does not move
     * that date. Null means we have not asked, which on a live motion is the
     * thing to go and do — not that it went unpaid.
     */
    undisputedTaxPaidOn: date('undisputed_tax_paid_on'),

    /** The hearing the board set, and when it gave the 25.25(e) written notice. */
    hearingScheduledFor: date('hearing_scheduled_for'),
    hearingNoticedOn: date('hearing_noticed_on'),

    /**
     * 'agreed' | 'determined' | 'forfeited' | 'withdrawn', or null while pending.
     *
     * Three of the four close (c-1) under (c-1)(3). Withdrawal is the one that
     * is not on the list, which is the difference between pulling a motion back
     * and losing one — and a forfeiture is on it despite determining nothing
     * about value, which makes it the worst ending available.
     */
    outcome: text('outcome'),
    outcomeOn: date('outcome_on'),
    /** The value the roll was changed to, where it was changed. */
    correctedValue: doublePrecision('corrected_value'),
    /** The board's order number, which a 25.25(g) suit is filed against. */
    orderReference: text('order_reference'),

    note: text('note'),

    recordedBy: text('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    voidedBy: text('voided_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => [
    index('correction_motions_engagement_idx').on(table.engagementId, table.status),
    /** The read that matters: has this account and year been moved on before. */
    index('correction_motions_subject_idx').on(table.accountId, table.subjectTaxYear, table.status),
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

/**
 * Us, as Form 50-162 names us. One row, id `agent`.
 *
 * A singleton table rather than environment config, because it is printed onto
 * a legal document an operator has to be able to read back and correct — and
 * because Step 4 has the owner direct the district to deliver every notice
 * "only to the agent at the agent's address indicated above". A stale address
 * in a `.env` file is a protest deadline missed silently.
 */
export const filingAgent = pgTable('filing_agent', {
  id: text('id').primaryKey().default('agent'),
  name: text('name'),
  phone: text('phone'),
  addressLine1: text('address_line1'),
  city: text('city'),
  stateCode: text('state_code'),
  zip: text('zip'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * A Form 50-162 appointment, per client per appraisal district.
 *
 * Per district because the form's first field is the district's name and
 * districts keep their own agent records: one filed with Harris is invisible
 * to Fort Bend, so a client with sites in two counties signs two forms. That is
 * the fact the old single `agent_appointment_date` on the filing profile could
 * not carry, and getting it wrong means signing a rendition for a district that
 * has never heard of us.
 */
export const agentAppointments = pgTable(
  'agent_appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Warehouse jurisdiction slug, e.g. `tx-harris`. */
    jurisdictionId: text('jurisdiction_id').notNull(),

    /** 'all-at-address' | 'listed' — Step 2's check-one. */
    scope: text('scope').notNull().default('listed'),
    /**
     * The sites Step 2 lists, by our id rather than by account number.
     *
     * An account is a fact about a site that arrives late and gets corrected;
     * an appointment that stopped covering a site because somebody fixed a
     * typo would be a bad surprise. Kept as jsonb rather than a join table
     * because it is a frozen copy of what one signed page said, not a
     * relationship that evolves.
     */
    locationIds: jsonb('location_ids').$type<string[]>().notNull().default([]),
    /** 'all' | 'specific' — Step 4's check-one. */
    matters: text('matters').notNull().default('all'),
    specificMatters: text('specific_matters'),
    /**
     * Step 4's 22.27(b)(2) radio.
     *
     * Its own column because it is its own permission: an appointment can be
     * perfectly valid, let us protest and sign, and still leave the district
     * unable to send us the client's own rendition back.
     */
    receivesConfidential: boolean('receives_confidential').notNull().default(true),
    /** Subset of 'chief-appraiser' | 'arb' | 'taxing-units'. */
    deliveries: jsonb('deliveries').$type<string[]>().notNull().default([]),

    /** Plain dates: transcribed off a signed page, compared, never summed. */
    signedOn: date('signed_on').notNull(),
    /**
     * The day it reached the district.
     *
     * Nullable and load-bearing. The form says the designation "will not take
     * effect until filed with the appropriate appraisal district", so a row
     * with no date here is a signed page that authorises nothing — which is a
     * different thing from having no appointment, and the difference is a
     * phone call rather than a client meeting.
     */
    filedOn: date('filed_on'),
    /** Step 5's expiry, where one was given. Null runs until revoked. */
    endsOn: date('ends_on'),

    revokedOn: date('revoked_on'),
    revokedReason: text('revoked_reason'),

    signerName: text('signer_name').notNull(),
    signerTitle: text('signer_title'),
    /** 'owner' | 'property-manager' | 'other-authorized' — Step 6's check-one. */
    signerCapacity: text('signer_capacity').notNull().default('owner'),
    note: text('note'),

    recordedBy: text('recorded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The question every rendition asks: may we sign for this client, here? */
    index('agent_appointments_client_district_idx').on(table.clientId, table.jurisdictionId),
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
export type ClientFilingProfileRow = typeof clientFilingProfiles.$inferSelect;
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
export type RenditionFilingRow = typeof renditionFilings.$inferSelect;
export type NewRenditionFilingRow = typeof renditionFilings.$inferInsert;
export type RenditionExtensionRow = typeof renditionExtensions.$inferSelect;
export type NewRenditionExtensionRow = typeof renditionExtensions.$inferInsert;
export type AssessmentNoticeRow = typeof assessmentNotices.$inferSelect;
export type NewAssessmentNoticeRow = typeof assessmentNotices.$inferInsert;
export type ProtestResolutionRow = typeof protestResolutions.$inferSelect;
export type NewProtestResolutionRow = typeof protestResolutions.$inferInsert;
export type CorrectionMotionRow = typeof correctionMotions.$inferSelect;
export type NewCorrectionMotionRow = typeof correctionMotions.$inferInsert;
export type FindingSetRow = typeof findingSets.$inferSelect;
export type NewFindingSetRow = typeof findingSets.$inferInsert;
export type FindingRow = typeof findings.$inferSelect;
export type NewFindingRow = typeof findings.$inferInsert;
export type FindingDispositionRow = typeof findingDispositions.$inferSelect;
export type NewFindingDispositionRow = typeof findingDispositions.$inferInsert;
export type FilingAgentRow = typeof filingAgent.$inferSelect;
export type NewFilingAgentRow = typeof filingAgent.$inferInsert;
export type AgentAppointmentRow = typeof agentAppointments.$inferSelect;
export type NewAgentAppointmentRow = typeof agentAppointments.$inferInsert;
