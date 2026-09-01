import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
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
 * Who from the client's own side may sign in and see their report.
 *
 * The portal used to ask the reader which business they were, out of a dropdown
 * of every business the firm holds. This table is what replaces that question
 * with an answer. A row is an access grant: the firm writes one against an
 * email address, and the person it names reaches exactly one client's wing.
 *
 * Keyed on the email rather than on a Supabase auth user, because the grant has
 * to exist before the account does — the firm adds a controller to an
 * engagement on Tuesday and they sign in on Friday. `authUserId` is stamped the
 * first time somebody actually claims the grant, which is also the audit record
 * of *which* identity claimed it. Matching on a verified email is the same
 * thing the firm allowlist already does; what makes it safe in both places is
 * that Supabase will not issue a session for an address it has not confirmed.
 *
 * Not a foreign key onto `auth.users`: that table lives in a schema this app
 * neither owns nor migrates, and a reference across it would make every
 * `drizzle-kit push` depend on the auth schema being present.
 *
 * One email, one business. A person who genuinely sits at two client entities
 * is real and rare, and the honest failure is a refusal at the gate naming both
 * rows — not a silent pick between them, which is how a report reaches the
 * wrong company.
 */
export const portalUsers = pgTable(
  'portal_users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Stored lowercased. The unique index below is what enforces one grant. */
    email: text('email').notNull(),
    /** 'admin' | 'viewer'. See PORTAL_ROLES. */
    role: text('role').notNull().default('admin'),
    /** The Supabase auth user that claimed this grant. Null until first sign-in. */
    authUserId: uuid('auth_user_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    /** The preparer who granted it. Null where auth was not configured. */
    invitedBy: text('invited_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('portal_users_email_unique').on(table.email),
    index('portal_users_client_idx').on(table.clientId),
  ],
).enableRLS();

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
 * One question put to the client, and what came back.
 *
 * Asks are born inside a proposal, but they cannot live there: a re-propose
 * overwrites the proposal jsonb, and an answer somebody collected from the
 * client must survive that. So each ask is its own row, synced from every
 * proposal by fingerprint — a reworded question keeps its answer, a new
 * question gets a new open row, and a question the model stopped asking stays
 * on the record with whatever was learned.
 *
 * The same ledger now carries the other kind of question: the one a screening
 * finding turns on. Those hang off the engagement rather than a file — the
 * finding is computed across every asset in the season, not from one upload —
 * so exactly one of `farFileId` and `engagementId` is set, and `source` says
 * which kind of row this is. Keeping both in one table is what lets the client
 * see a single list of what is being asked of them.
 */
export const mappingAsks = pgTable(
  'mapping_asks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Set for `source` 'mapping': the upload whose columns raised the question. */
    farFileId: uuid('far_file_id').references(() => farFiles.id, { onDelete: 'cascade' }),
    /** Set for `source` 'finding': the season the finding was computed over. */
    engagementId: uuid('engagement_id').references(() => engagements.id, { onDelete: 'cascade' }),
    /** 'mapping' | 'finding'. */
    source: text('source').notNull().default('mapping'),
    /** The finding key a 'finding' ask settles. Null on a mapping ask. */
    subject: text('subject'),
    /**
     * Stable identity across re-proposals; computed in packages/far asks.ts.
     * A finding ask has a stable identity already — `finding:<key>` — so the
     * same rewording rule holds for free: change the wording of the question a
     * finding asks and the answer already given stays attached to it.
     */
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
  (table) => [
    uniqueIndex('mapping_asks_unique').on(table.farFileId, table.fingerprint),
    // Postgres treats NULLs as distinct in a unique index, so the index above
    // constrains nothing once `farFileId` is null. Finding asks get their own.
    uniqueIndex('mapping_asks_finding_unique').on(table.engagementId, table.fingerprint),
  ],
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
 * `currentVersionId` is a plain uuid, not a foreign key: assets and versions
 * reference each other, and one side has to give way for the DDL to be
 * creatable in any order. The batch pointers have no such excuse and are real
 * references — deleting a far file cascades its batches away, and without the
 * constraint that delete left these pointers silently dangling. `no action`
 * on purpose: a future delete path must repair the pointers (repoint to the
 * newest surviving batch among the asset's versions) before the batch can go.
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
    firstSeenBatchId: uuid('first_seen_batch_id')
      .notNull()
      .references(() => importBatches.id),
    lastSeenBatchId: uuid('last_seen_batch_id')
      .notNull()
      .references(() => importBatches.id),
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
 * What the machine said, what the person said, and the gap between them.
 *
 * `asset_classifications` holds one live row per asset and the review screen
 * updates it in place, which is right for the rendition and destroys the only
 * evidence about the classifier. The moment a reviewer settled a row was the
 * moment the machine's answer — its category, and above all its confidence —
 * stopped existing. `AUTO_ACCEPT_CONFIDENCE` has been 0.85 since it was
 * written, defended by an argument about what an error costs on each side, and
 * nothing in the database could have contradicted or confirmed it.
 *
 * A row here is one review, written before the update that overwrites it, and
 * never touched again. Append-only on purpose: a label whose value depends on
 * when you read it is not a label.
 *
 * Three restrictions, each of which changes what the numbers mean:
 *
 *   - **Only the row a person actually looked at.** A confirmation can apply to
 *     every twin of a description in the engagement, and recording forty
 *     inherited rows as forty labels would multiply one judgement by forty and
 *     report the result as a sample size.
 *   - **Only where the machine answered.** Re-reviewing a row a reviewer
 *     already confirmed measures one person against another.
 *   - **`agreed` is strict** — same category *and* same life class. Auto-accept
 *     applies the whole decision, so a partial agreement is a decision that
 *     should not have stood. Both halves are stored, so a softer question can
 *     be asked later without a migration.
 *
 * `machine_status` is the bar's own verdict at the time. It is `needs-review`
 * on every row this table will hold until something deliberately routes
 * auto-accepted rows to a person anyway, and that is the honest shape of the
 * dataset: it can price lowering the bar and cannot say a word about raising
 * it. The column exists so that an audit sample needs no migration, and so the
 * blindness is visible in the data rather than only in this comment.
 *
 * Firm-only — RLS on, no policy. It carries a client's asset ids because a
 * label without them cannot be traced back to the row it judges, and it dies
 * with the client for the same reason.
 */
export const classificationReviews = pgTable(
  'classification_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** Not a foreign key: the label outlives any particular decision row. */
    classificationId: uuid('classification_id').notNull(),
    fingerprint: text('fingerprint'),
    /** 'ai' | 'memory'. Never 'human' — see the restrictions above. */
    machineSource: text('machine_source').notNull(),
    machineCategoryKey: text('machine_category_key'),
    machineLifeClass: integer('machine_life_class'),
    machineConfidence: doublePrecision('machine_confidence').notNull(),
    /** 'auto-accepted' | 'needs-review': whether the bar had let this row stand. */
    machineStatus: text('machine_status').notNull(),
    model: text('model'),
    humanCategoryKey: text('human_category_key').notNull(),
    humanLifeClass: integer('human_life_class'),
    /** Category and life class both unchanged. */
    agreed: boolean('agreed').notNull(),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('classification_reviews_engagement_idx').on(table.engagementId, table.reviewedAt),
    index('classification_reviews_source_idx').on(table.machineSource, table.machineConfidence),
  ],
).enableRLS();

/**
 * What a header in a register means, once a person has settled it.
 *
 * The other half of the same idea as `classification_memory`, one step earlier
 * in the pipeline. That table remembers what an *asset* is; this one remembers
 * what a *column* is — "Acq. Cost" is original cost, "In Svc Date" is the
 * in-service date — so the fortieth export of the same accounting report does
 * not arrive as unfamiliar as the first. The key is the folded header text, not
 * the column position: positions move between exports and the words do not.
 *
 * A separate table rather than a third vocabulary inside `classification_memory`,
 * which does hold two. Those two share a table because they share an *answer
 * space* — both name a valuation category, and `isKnownClassification` is the
 * guard that protects the classification path from a key that does not. A
 * canonical asset field is a different answer space entirely, and storing one
 * in `category_key` would make that guard false for every row here.
 *
 * The conflict rule is the same one, and for the same reason: two reviewers who
 * settle "Cost" differently have discovered that the header does not decide the
 * field, and the row stops asserting itself until somebody agrees with one of
 * them. Firm-wide like its sibling — no `client_id`, RLS on with no policy, so
 * a client connection cannot read a word of it.
 */
export const mappingMemory = pgTable(
  'mapping_memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** The folded header text — see `headerFingerprint` in @tangible/far. */
    fingerprint: text('fingerprint').notNull(),
    /** A representative header as some register actually wrote it. */
    sampleHeader: text('sample_header').notNull(),
    /** A CanonicalAssetField. Never null: an unmapped column is not a decision. */
    field: text('field').notNull(),
    confirmations: integer('confirmations').notNull().default(1),
    /** Set when a later confirmation disagreed; the row stops asserting itself. */
    conflicted: boolean('conflicted').notNull().default(false),
    conflictingField: text('conflicting_field'),
    sourceFarFileId: uuid('source_far_file_id'),
    lastConfirmedBy: text('last_confirmed_by'),
    lastConfirmedAt: timestamp('last_confirmed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('mapping_memory_fingerprint_unique').on(table.fingerprint)],
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
 * Supplier invoices behind capitalized register lines.
 *
 * A separate family from `prior_documents` rather than a `kind` on it, because
 * almost nothing is shared beyond "a file somebody sent us". A rendition is one
 * document about a whole return; an invoice is one of hundreds about individual
 * assets, it links to register rows, and its extraction is checked by
 * per-line confidence rather than by whether the form foots.
 *
 * Storage is the same private bucket as everything else — an invoice is the
 * client's confidential business record under Tax Code 22.27 no less than the
 * return is.
 */
export const invoiceDocuments = pgTable(
  'invoice_documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    originalFilename: text('original_filename').notNull(),
    storagePath: text('storage_path').notNull(),
    byteSize: integer('byte_size').notNull(),
    checksum: text('checksum'),
    contentType: text('content_type'),
    /** 'uploaded' | 'extracting' | 'extracted' | 'needs-review' | 'accepted' | 'failed'. */
    status: text('status').notNull().default('uploaded'),
    error: text('error'),
    /**
     * What the invoice says about itself, denormalized out of the extraction so
     * a list can be scanned without opening anything — and so that an invoice
     * billed to a different company is visible before its numbers are used.
     */
    vendorName: text('vendor_name'),
    invoiceNumber: text('invoice_number'),
    invoiceDate: text('invoice_date'),
    billedTo: text('billed_to'),
    purchaseOrder: text('purchase_order'),
    /** As printed on the document. */
    statedTotal: doublePrecision('stated_total'),
    /** What the extracted lines add to. Kept beside the stated total, never replacing it. */
    derivedTotal: doublePrecision('derived_total'),
    /**
     * The weakest line on the document, not the average. One badly-read
     * $80,000 line is exactly what an average hides, and it is the whole reason
     * this field exists.
     */
    extractionConfidence: doublePrecision('extraction_confidence'),
    extractionModel: text('extraction_model'),
    /** ExtractedInvoice, exactly as the model returned it. */
    extracted: jsonb('extracted'),
    /** string[] of what could not be read, in the model's own words. */
    unreadable: jsonb('unreadable').notNull().default([]),
    uploadedBy: text('uploaded_by'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invoice_documents_engagement_idx').on(table.engagementId, table.status),
    index('invoice_documents_vendor_idx').on(table.engagementId, table.vendorName),
  ],
).enableRLS();

/**
 * One charge on an invoice, and what it is for tax.
 *
 * The reading and the ruling live on the same row but are recorded separately:
 * `description`/`amount` are what the document says and are replaced wholesale
 * when a document is re-extracted, while `treatment` is a conclusion. A
 * treatment a person corrected carries `is_corrected`, and re-extraction
 * preserves nothing — the rules re-run and the correction is lost, which is why
 * re-extracting is an explicit act rather than something a background job does.
 */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => invoiceDocuments.id, { onDelete: 'cascade' }),
    /** Position on the document, so the screen can print it in the vendor's order. */
    lineNumber: integer('line_number').notNull(),
    /** The vendor's wording, verbatim. Never normalized on the way in. */
    description: text('description').notNull(),
    amount: doublePrecision('amount'),
    quantity: doublePrecision('quantity'),
    unitPrice: doublePrecision('unit_price'),
    partNumber: text('part_number'),
    sourcePage: integer('source_page'),
    /** How well the row was read, 0 to 1. Distinct from confidence in the ruling. */
    readConfidence: doublePrecision('read_confidence').notNull().default(0),
    /** 'assessable' | 'non-assessable' | 'unclear'. */
    treatment: text('treatment').notNull().default('unclear'),
    treatmentReason: text('treatment_reason'),
    treatmentAuthority: text('treatment_authority'),
    /** 'rule' | 'human'. Nothing else decides a treatment. */
    treatmentSource: text('treatment_source').notNull().default('rule'),
    treatmentConfidence: doublePrecision('treatment_confidence').notNull().default(0),
    /** Which rule in the jurisdiction table produced it, for auditing the table itself. */
    ruleId: text('rule_id'),
    isCorrected: boolean('is_corrected').notNull().default(false),
    correctedBy: text('corrected_by'),
    correctedAt: timestamp('corrected_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('invoice_lines_document_idx').on(table.documentId, table.lineNumber),
    /** The review queue: what nobody has ruled on yet. */
    index('invoice_lines_treatment_idx').on(table.documentId, table.treatment),
  ],
).enableRLS();

/**
 * Which register lines an invoice paid for.
 *
 * Many-to-many on purpose. One invoice routinely covers several capitalized
 * lines, and one capitalized line — a phased project — is routinely several
 * invoices. Collapsing either direction would work for the easy half of a
 * register and quietly mis-attribute the expensive half.
 *
 * `share` is what makes the difference visible. Linked to one asset, it is 1
 * and the split is a measurement. Linked to three, it is an allocation, and
 * every finding built on it is discounted and says so on its face.
 */
export const invoiceAssetLinks = pgTable(
  'invoice_asset_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => invoiceDocuments.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    share: doublePrecision('share').notNull().default(1),
    /** 'suggested' | 'confirmed'. A matcher proposed it, or a person agreed. */
    status: text('status').notNull().default('suggested'),
    /** Why the matcher proposed it — vendor and amount, a PO number, a person. */
    reason: text('reason'),
    linkedBy: text('linked_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('invoice_asset_links_unique').on(table.documentId, table.assetId),
    index('invoice_asset_links_asset_idx').on(table.assetId),
    index('invoice_asset_links_engagement_idx').on(table.engagementId, table.status),
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
 * An ask-the-graph exchange: a question about the engagement, the digest of
 * the record it was answered from, and the answer — frozen together.
 *
 * Not `mapping_asks` (questions the firm asks the client about a file); these
 * are questions the firm asks the record. Same jsonb discipline as the
 * drafting agents: `facts` is what code assembled and the model was allowed
 * to see, `answer` is what it made of it, and rows are never edited — the
 * history of what was asked is itself part of the record.
 */
export const graphAnswers = pgTable(
  'graph_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    /** The assembled digest, frozen. See GraphDigestSchema. */
    facts: jsonb('facts').notNull(),
    /** The answer, references already validated. See GraphAnswerSchema. */
    answer: jsonb('answer').notNull(),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('graph_answers_engagement_idx').on(table.engagementId, table.createdAt)],
).enableRLS();

/**
 * A drafted 25.25 correction motion: the checked facts and the document,
 * frozen together. Keyed by the open-years (account, year) key as well as the
 * engagement, because the draft belongs to the year being corrected — several
 * open years on one engagement each get their own drafts. Rows are never
 * edited; redrafting inserts, and reads take the newest for the year.
 */
export const motionDrafts = pgTable(
  'motion_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** The open-years key of the (account, year) the motion corrects. */
    yearKey: text('year_key').notNull(),
    /** The assembled inputs, frozen. See MotionDraftFactsSchema. */
    facts: jsonb('facts').notNull(),
    /** The drafted motion. See CorrectionMotionDraftSchema. */
    draft: jsonb('draft').notNull(),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('motion_drafts_year_idx').on(table.engagementId, table.yearKey, table.createdAt),
  ],
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
 * What was decided about one asset under one finding.
 *
 * A second table rather than a wider `finding_dispositions`, and the difference
 * is not grain but *lifetime*. That table holds one current answer per finding
 * and is written in place: a category accepted twice leaves one row saying so.
 * This one is **append-only**. Nothing here is ever updated or deleted, and the
 * current state of a row is the newest record for its
 * (engagement, source, finding, asset) — which makes one table do three jobs at
 * once, none of which can drift from the others:
 *
 *   - the write-back, because the newest record is the answer;
 *   - the audit trail, because a reversal is a second record and the first one
 *     is still there, with who and when on it — and a client's report is a
 *     document a district may eventually ask about, so "who took this off"
 *     needs an answer that does not depend on us having kept a log;
 *   - the training set, because a decision paired with the signals that were
 *     showing when it was made is a label, and a decision without them is an
 *     opinion. `signals` and `confidence` are stamped at decision time for
 *     exactly that reason: the engine will be retuned, and a label recorded
 *     against weights nobody can reconstruct teaches nothing.
 *
 * `decidedValue` carries the same warning as its sibling on the category: an
 * accepted $12,000 row is not consent to the $40,000 the same row claims after
 * the next register lands.
 */
export const findingRowDecisions = pgTable(
  'finding_row_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** 'savings' | 'register-comparison', matching the category disposition. */
    source: text('source').notNull(),
    findingKey: text('finding_key').notNull(),
    /**
     * Deliberately *not* a foreign key to `assets`.
     *
     * A decision is a statement somebody made, and deleting the asset it was
     * about does not unmake it. The asset table is also rebuilt by import; a
     * cascade here would silently erase the audit trail on a re-import, which
     * is the one thing this table exists to prevent.
     */
    assetId: uuid('asset_id').notNull(),
    /** 'accepted' | 'rejected' | 'pending-client'. Undecided has no record. */
    status: text('status').notNull(),
    note: text('note'),
    /** Who decided, and from which side of the engagement. */
    decidedBy: text('decided_by'),
    /** 'firm' | 'client' — the reviewer filter, and the thing a firm asks first. */
    decidedByAudience: text('decided_by_audience'),
    decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
    /** What the row claimed when the decision was made. */
    decidedValue: doublePrecision('decided_value'),
    decidedTaxAtRisk: doublePrecision('decided_tax_at_risk'),
    /** The tier and score showing on screen at that moment. */
    confidenceTier: text('confidence_tier'),
    confidenceScore: doublePrecision('confidence_score'),
    /** DetectionSignal[] — what the decision was actually a judgement about. */
    signals: jsonb('signals'),
    /** The published run the client was looking at, where there was one. */
    decidedRunId: uuid('decided_run_id'),
  },
  (table) => [
    // The read path: newest first for one finding's rows.
    index('finding_row_decisions_current_idx').on(
      table.engagementId,
      table.source,
      table.findingKey,
      table.decidedAt,
    ),
    index('finding_row_decisions_asset_idx').on(table.engagementId, table.assetId),
  ],
).enableRLS();

/**
 * The client's own settings for their portal.
 *
 * One row per client, and today one setting: the confidence floor beneath which
 * a finding row is not shown by default. It belongs to the client rather than
 * to the browser because it is a statement about how they want to work — a
 * controller who only wants to see positions their auditor would not blink at
 * should not have to re-say that on their phone, and a colleague opening the
 * same report should see the same report.
 *
 * A floor hides rows; it never removes them from a total. The report's headline
 * is what the engine found, and a client who has narrowed their working view is
 * still told what the whole population is — otherwise the setting quietly
 * becomes a way to be shown a smaller number than the truth.
 */
export const portalSettings = pgTable('portal_settings', {
  clientId: uuid('client_id')
    .primaryKey()
    .references(() => clients.id, { onDelete: 'cascade' }),
  /** 'high' | 'medium' | 'low' — the lowest tier shown by default. */
  confidenceFloor: text('confidence_floor').notNull().default('low'),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * An analysis run: the job that produced a report, and the record that it was
 * published.
 *
 * The firm keeps reading the report derived on read — settling one more row in
 * the review queue still moves the number under them immediately, which is what
 * a working screen should do. This table exists because the *client* must not
 * read that report. A taxpayer who opens their report twice and finds two
 * different totals has been given nothing they can act on, and the number they
 * quoted in an email last March has to still mean what it meant.
 *
 * So the client wing reads the last run that reached `published`, and every
 * figure it prints cites this row's id. A run that failed publishes nothing and
 * leaves the previous report standing, which is the correct behaviour on both
 * counts: the customer's report does not disappear because our detector threw,
 * and nobody is shown a partial one.
 *
 * `setId` points at the committed `finding_sets` row rather than storing a
 * report here, so a published run and a partner's committed set are the same
 * object seen from two sides — and the dispositions already keyed on
 * (engagement, source, key) keep working without knowing runs exist.
 */
export const analysisRuns = pgTable(
  'analysis_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /**
     * Denormalized from the engagement so a run can be listed and dated without
     * the join. It is also the year the client would name, and a run outlives
     * the reason anybody had to look it up.
     */
    taxYear: integer('tax_year').notNull(),
    /** 'savings' | 'register-comparison', matching finding_sets.source. */
    source: text('source').notNull().default('savings'),

    /** 'queued' | 'running' | 'published' | 'failed'. See RUN_STATUSES. */
    status: text('status').notNull().default('queued'),
    /** 'upload' | 'manual' | 'refresh'. Decides whether publishing sends mail. */
    trigger: text('trigger').notNull().default('manual'),
    /** Which stage a running job is on, in the customer's words. See RUN_STEPS. */
    step: text('step'),

    /**
     * The set this run committed. Not cascaded to on delete: a deleted set
     * should leave the run standing as the record that something was published,
     * rather than erasing the fact along with the document.
     */
    setId: uuid('set_id').references(() => findingSets.id, { onDelete: 'set null' }),

    /**
     * The three things that make a published number reproducible: what the
     * client's data looked like, which detectors ran, and which depreciation
     * guide was applied. All null until the worker has actually read them —
     * a queued run has not looked at anything yet, and defaulting them to the
     * current values would assert that it had.
     */
    inputFingerprint: text('input_fingerprint'),
    rulesVersion: text('rules_version'),
    scheduleVersion: text('schedule_version'),

    requestedBy: text('requested_by'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    /** Written for whoever debugs it. Never rendered in the client wing. */
    error: text('error'),
    /**
     * Picked-up count. A worker that dies mid-run leaves a row in `running`
     * with no process behind it, and the only way to tell that from a long job
     * is elapsed time — so the reaper requeues it, and this is what stops a job
     * that crashes deterministically from being retried forever.
     */
    attempts: integer('attempts').notNull().default(0),
    /** Moved on every state change, so the reaper can find stalled runs. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('analysis_runs_engagement_idx').on(table.engagementId, table.source, table.requestedAt),
    /**
     * The claim query's index: the runner asks for the oldest row that is
     * queued, and the reaper for the oldest that is running. One partial index
     * over both is not possible, so this covers the ordering and the status
     * filter narrows it.
     */
    index('analysis_runs_status_idx').on(table.status, table.requestedAt),
  ],
).enableRLS();

/**
 * What one attempt at a run finished, so the next one does not do it again.
 *
 * A run is started inside the request that queued it and torn down when that
 * invocation ends. Before this table an attempt that ran out of wall clock lost
 * everything: the reaper requeued it, it re-read the roll, re-matched every
 * asset against every export, and hit the same wall in the same place. Three
 * times, and then `failed` — a register that does not fit in one invocation
 * could never be analysed at all, however many times it was retried.
 *
 * A row here is one stage's output, written the moment that stage returns. The
 * next attempt reads it back instead of recomputing, so the unit of lost work
 * is a stage rather than a run, and successive attempts get further. It is a
 * resume log, not a cache: rows are scoped to one run, they are never shared
 * between runs, and they die with it.
 *
 * `fingerprint` is what makes reuse safe. It is the run's input fingerprint at
 * the moment the stage ran; if the client re-uploads their register between two
 * attempts the fingerprint moves, every row here is discarded, and the run
 * starts over rather than publishing a report assembled half from each. That
 * check is the whole reason this is not simply a memo table.
 *
 * Not every stage belongs here — see `run-checkpoints.ts` for which do and, more
 * importantly, which deliberately do not.
 */
export const runCheckpoints = pgTable(
  'run_checkpoints',
  {
    runId: uuid('run_id')
      .notNull()
      .references(() => analysisRuns.id, { onDelete: 'cascade' }),
    /** Internal stage name. Not a `RunStep`: those are the customer's words. */
    stage: text('stage').notNull(),
    /**
     * The run's `input_fingerprint` when this stage ran. A row whose
     * fingerprint no longer matches the run's is stale and gets dropped.
     */
    fingerprint: text('fingerprint').notNull(),
    /**
     * The stage's return value, as JSON. Anything stored here has to survive
     * `JSON.parse(JSON.stringify(x))` unchanged — which is a real constraint,
     * not a formality, and it is why the fitted detection model is not here.
     */
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.stage] }),
    /**
     * The reaper's question: did this attempt achieve anything? It compares the
     * newest checkpoint against the run's `started_at`, and an attempt that
     * wrote none is one that will not get further next time either.
     */
    index('run_checkpoints_progress_idx').on(table.runId, table.createdAt),
  ],
).enableRLS();

/**
 * Every message this app has sent to a person outside it.
 *
 * A row per recipient per message, written whether the send succeeded or not.
 * Three reasons it is a table rather than a log line. A client who says "you
 * never told me" is answered by a date and an address, and the answer has to
 * outlive a log retention window. A publish that emails twice because a retry
 * re-ran the notification is worse than one that emails late, so the sender
 * checks here first. And mail that silently stopped going out is invisible
 * without somewhere to see the failures — `sent_at` null with `error` set is
 * the shape a monitoring query looks for.
 *
 * Deliberately not a queue. Nothing here is retried: a report that published is
 * on the portal whether the mail landed or not, and a second copy of a stale
 * notification a week later would confuse rather than help.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Scoped to a season, because every message this app sends is about one. */
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** 'report-published' | 'question-waiting' | 'answer-received'. */
    kind: text('kind').notNull(),
    /** The run this was about, where there was one. */
    runId: uuid('run_id').references(() => analysisRuns.id, { onDelete: 'set null' }),
    /** Lowercased, one row each — never a comma-joined To: line. */
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    /** Null means it did not go: see `error`. */
    sentAt: timestamp('sent_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    /** The suppression lookup: "have we already said this about this season?" */
    index('notifications_engagement_idx').on(table.engagementId, table.kind, table.createdAt),
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

/**
 * What is left after a client is deleted at their request.
 *
 * Deliberately unconstrained: `clientId` carries no foreign key, because the
 * row it would point at is the row this table exists to record the absence of.
 * It holds counts and a name, no client data — enough to answer "did you
 * actually delete us, and when", which is the whole point of writing it down.
 * Never edited, for the same reason a receipt you can revise is worthless.
 */
export const deletionReceipts = pgTable(
  'deletion_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id').notNull(),
    clientName: text('client_name').notNull(),
    /** See DeletionCountsSchema — what the cascade destroyed, by kind. */
    counts: jsonb('counts').notNull(),
    storageRemoved: integer('storage_removed').notNull().default(0),
    /** Objects the bucket would not give up, named rather than rounded down. */
    storageFailed: jsonb('storage_failed').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('deletion_receipts_deleted_idx').on(table.deletedAt)],
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
/**
 * The assistant: a conversation, and the turns inside it.
 *
 * Two tables rather than one because this surface is multi-turn. Ask-the-graph
 * stores an exchange and nothing else, which is right for a question asked
 * once about one engagement; here a preparer works a thread — narrows, follows
 * up, asks the same question about a second client — and the thread is the
 * thing they come back to.
 *
 * A turn is immutable, the same rule the drafting tables follow. `tool_calls`
 * freezes what every lookup actually returned at the moment it ran, next to
 * the answer that leaned on it. Re-running the same question next week may
 * legitimately answer differently — a filing was recorded, a notice arrived —
 * and a stored turn has to keep meaning what it meant when it was written.
 */
export const assistantConversations = pgTable(
  'assistant_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Taken from the first question. Never model-written. */
    title: text('title').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Moved by each new turn, so the list sorts by activity rather than birth. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('assistant_conversations_updated_idx').on(table.updatedAt)],
).enableRLS();

export const assistantTurns = pgTable(
  'assistant_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => assistantConversations.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    /** Where the preparer was standing. See AssistantScopeSchema. */
    scope: jsonb('scope'),
    /** Every lookup, its arguments and its result, frozen. See AssistantToolCallSchema. */
    toolCalls: jsonb('tool_calls').notNull(),
    /** The answer, citations already validated. See AssistantAnswerSchema. */
    answer: jsonb('answer').notNull(),
    /** 'model' or 'fallback' — an assembled answer is never presented as a written one. */
    source: text('source').notNull(),
    model: text('model'),
    /**
     * Which clients this turn read. Not a foreign key: a turn survives the
     * engagement it discussed, and a hard reference would either block a
     * deletion or silently null itself out. It exists so client deletion can
     * find these rows at all — a turn holds register figures and filed values,
     * confidential under Tax Code 22.27, and no cascade reaches a table that
     * hangs off a conversation rather than off a client.
     */
    clientIds: uuid('client_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('assistant_turns_conversation_idx').on(table.conversationId, table.createdAt),
    index('assistant_turns_clients_idx').using('gin', table.clientIds),
  ],
).enableRLS();

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
export type ClassificationReviewRow = typeof classificationReviews.$inferSelect;
export type MappingMemoryRow = typeof mappingMemory.$inferSelect;
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
export type FindingRowDecisionRow = typeof findingRowDecisions.$inferSelect;
export type NewFindingRowDecisionRow = typeof findingRowDecisions.$inferInsert;
export type PortalSettingsRow = typeof portalSettings.$inferSelect;
export type NewPortalSettingsRow = typeof portalSettings.$inferInsert;
export type NotificationRow = typeof notifications.$inferSelect;
export type NewNotificationRow = typeof notifications.$inferInsert;
export type AnalysisRunRow = typeof analysisRuns.$inferSelect;
export type NewAnalysisRunRow = typeof analysisRuns.$inferInsert;
export type RunCheckpointRow = typeof runCheckpoints.$inferSelect;
export type PortalUserRow = typeof portalUsers.$inferSelect;
export type NewPortalUserRow = typeof portalUsers.$inferInsert;
export type FilingAgentRow = typeof filingAgent.$inferSelect;
export type NewFilingAgentRow = typeof filingAgent.$inferInsert;
export type AgentAppointmentRow = typeof agentAppointments.$inferSelect;
export type NewAgentAppointmentRow = typeof agentAppointments.$inferInsert;
export type AssistantConversationRow = typeof assistantConversations.$inferSelect;
export type NewAssistantConversationRow = typeof assistantConversations.$inferInsert;
export type AssistantTurnRow = typeof assistantTurns.$inferSelect;
export type NewAssistantTurnRow = typeof assistantTurns.$inferInsert;

/* -------------------------------------------------------------------------- */
/*  What a position was actually worth                                        */
/* -------------------------------------------------------------------------- */

/**
 * A position taken to a district, recorded at the moment it goes out.
 *
 * Everything upstream of this table is a claim about what a finding *should* be
 * worth. This is the first table in the product that records what somebody
 * actually asked a district for, and it exists so the next table can record
 * what they got. Without both, every acceptance rate in this codebase stays a
 * constant somebody typed.
 *
 * The grain is one asset, one finding, one tax year — deliberately finer than
 * the district works at. A district settles a whole account for a year and
 * hands back one number; it does not say which of eleven positions it agreed
 * with. So the asset grain is *ours*, and the allocation from their number to
 * our rows is an explicit, labelled step rather than an assumption buried in a
 * query. See `recoveryOutcomes.allocation`.
 *
 * Rows are never edited. A claim that was recorded wrongly is voided and a new
 * one recorded, the same rule filed renditions and protest resolutions follow,
 * and for the same reason: this is the dataset the learned models will be
 * trained on, and a training set that rewrites its own history cannot be
 * audited when a model starts behaving strangely.
 */
export const recoveryClaims = pgTable(
  'recovery_claims',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /**
     * Carried alongside the engagement so a claim survives into the practice's
     * history when a season is archived, and so the acceptance model can pool
     * across a client's engagements without a join through a table that may
     * have been reorganised between seasons.
     */
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** Restricted, like every other outcome row: closing a site settles nothing. */
    locationId: uuid('location_id').references(() => clientLocations.id, {
      onDelete: 'restrict',
    }),
    accountId: text('account_id'),
    taxYear: integer('tax_year').notNull(),

    /**
     * Not a foreign key, for the reason `finding_row_decisions.assetId` is not:
     * import rebuilds the asset table, and a cascade here would erase the
     * record of what was asked for the moment somebody re-imported a register.
     *
     * Null is meaningful and common. A category-level position — "remove the
     * $84,000 of freight inside Schedule E" — names no single asset, and a
     * claim that invented one to satisfy a column would be a claim nobody could
     * check against the return that carried it.
     */
    assetId: uuid('asset_id'),
    findingKey: text('finding_key').notNull(),

    /**
     * How this position reached the district. Not the same question as which
     * statute it rests on — a position can ride out on a timely rendition and
     * never be a claim at all in the correction sense, and that is the most
     * common case by far.
     *
     * 'rendition' | 'protest' | '25.25-c' | '25.25-c-1' | '25.25-d' |
     * 'fl-refund' | 'fl-vab'.
     */
    route: text('route').notNull(),
    /** The statute, spelled as a report would print it. */
    authority: text('authority'),

    /** Appraised value the position asks the district to take off. */
    valueClaimed: doublePrecision('value_claimed'),
    /** That value at the rate on file, which is what the client was promised. */
    taxClaimed: doublePrecision('tax_claimed'),
    /** The confidence showing when it went out — the model's own prediction. */
    predictedConfidence: doublePrecision('predicted_confidence'),
    /** The acceptance rate the model assumed. The number this table exists to replace. */
    predictedAcceptance: doublePrecision('predicted_acceptance'),
    /**
     * The signals the row was carrying when the position went out.
     *
     * Frozen here rather than joined back to `finding_row_decisions` for the
     * same reason the two predictions above are frozen, and for one more. The
     * decision row is mutable — a reviewer can revisit it, and re-importing a
     * register rebuilds the assets underneath it — so a join would let the
     * evidence a district is thought to have answered change after the answer
     * arrived. And a category-level claim has no decision row at all, which
     * would make the absence of evidence look like an absence of signals.
     *
     * A `DetectionSignal[]`. Null on every claim written before this column
     * existed, and null reads as "not recorded", never as "none" — a claim that
     * says it went out on no evidence would drag every measured lift toward
     * zero.
     */
    predictedSignals: jsonb('predicted_signals'),

    /** What carried it: a filed rendition, a protest, a motion. */
    filingId: uuid('filing_id').references(() => renditionFilings.id, { onDelete: 'set null' }),
    motionId: uuid('motion_id').references(() => correctionMotions.id, { onDelete: 'set null' }),

    claimedOn: date('claimed_on').notNull(),

    /** 'recorded' | 'void'. Superseding happens on the outcome, not the claim. */
    status: text('status').notNull().default('recorded'),
    note: text('note'),
    recordedBy: text('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    voidedBy: text('voided_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => [
    index('recovery_claims_engagement_idx').on(table.engagementId, table.taxYear, table.status),
    index('recovery_claims_asset_idx').on(table.engagementId, table.assetId),
    /** The read the acceptance model makes: every claim of a kind, across clients. */
    index('recovery_claims_learning_idx').on(table.findingKey, table.taxYear, table.status),
  ],
).enableRLS();

/**
 * What the district actually did with a claim.
 *
 * One row per claim per recording, newest not-void row winning — the same
 * shape as protest resolutions, because it is the same kind of fact: a thing
 * that happened on a date, which somebody may later have recorded better.
 *
 * `allocation` is the column that keeps this table honest. A district that
 * agrees to take $600,000 off an account has not told anybody which claims it
 * agreed with, and three different people will split that $600,000 three
 * different ways. So the split is named:
 *
 *   - **itemized** — the district's own letter or the ARB order says which
 *     positions it allowed. The only allocation that is a fact.
 *   - **stated** — the appraiser said it verbally, or the firm's own notes
 *     record which arguments landed. A person's word, recorded as such.
 *   - **pro-rata** — nobody said, so the settlement was split across the claims
 *     in proportion to what each asked for. An assumption, and it must never be
 *     fed to the acceptance model as though it were an observation.
 *
 * That last exclusion is the reason this column exists rather than being
 * inferred. A pro-rata split makes every claim look partially accepted, which
 * would train the model toward a universal middling acceptance rate no matter
 * what districts actually concede.
 */
export const recoveryOutcomes = pgTable(
  'recovery_outcomes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    claimId: uuid('claim_id')
      .notNull()
      .references(() => recoveryClaims.id, { onDelete: 'cascade' }),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),

    /** 'accepted' | 'partial' | 'rejected' | 'withdrawn'. */
    outcome: text('outcome').notNull(),
    /** 'itemized' | 'stated' | 'pro-rata'. See the table note. */
    allocation: text('allocation').notNull(),

    /** Appraised value the district actually took off for this claim. */
    valueAllowed: doublePrecision('value_allowed'),
    /**
     * Tax actually recovered or avoided. Kept separately from value × rate
     * because a refund cheque is a fact and a rate multiplication is a model,
     * and the whole point of this table is to stop confusing the two.
     */
    taxRecovered: doublePrecision('tax_recovered'),
    /** True where `taxRecovered` came off a cheque, a bill or a refund notice. */
    taxIsDocumented: boolean('tax_is_documented').notNull().default(false),

    /** Where the outcome came from, where it came from a recorded resolution. */
    resolutionId: uuid('resolution_id').references(() => protestResolutions.id, {
      onDelete: 'set null',
    }),
    resolvedOn: date('resolved_on').notNull(),

    /** 'recorded' | 'superseded' | 'void'. */
    status: text('status').notNull().default('recorded'),
    note: text('note'),
    recordedBy: text('recorded_by'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    voidedBy: text('voided_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => [
    index('recovery_outcomes_claim_idx').on(table.claimId, table.status),
    index('recovery_outcomes_engagement_idx').on(table.engagementId, table.status),
  ],
).enableRLS();

export type RecoveryClaimRow = typeof recoveryClaims.$inferSelect;
export type NewRecoveryClaimRow = typeof recoveryClaims.$inferInsert;
export type RecoveryOutcomeRow = typeof recoveryOutcomes.$inferSelect;
export type NewRecoveryOutcomeRow = typeof recoveryOutcomes.$inferInsert;

/**
 * An export out of a system that is not the register, and what it holds.
 *
 * Two tables rather than one blob, and the split is not a preference. A
 * maintenance export is tens of thousands of rows; storing it as jsonb would
 * mean the whole file is read, parsed and held in memory to answer "how many
 * records were searched", which is the number every negative statement in this
 * product rests on. Rows also make the file inspectable — a reviewer arguing
 * with a match can be shown the record it matched, by id, without the app
 * re-reading the original upload.
 *
 * The original file is kept too, under the same private bucket as a register.
 * These exports are client data of exactly the same kind, and a match nobody
 * can trace back to a line in the file somebody sent is a match the firm cannot
 * defend.
 */
export const evidenceExports = pgTable(
  'evidence_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** An EvidenceSourceKind. What this system is, which is what it can prove. */
    kind: text('kind').notNull(),
    originalFilename: text('original_filename').notNull(),
    /** Path inside the private far-uploads bucket, under evidence/. */
    storagePath: text('storage_path').notNull(),
    byteSize: integer('byte_size').notNull(),
    checksum: text('checksum'),
    contentType: text('content_type'),
    /** SheetSummary[] once parsed — the same shape a register upload produces. */
    sheetSummaries: jsonb('sheet_summaries'),
    /** Which sheet the records were read from, once a human settled it. */
    sheetName: text('sheet_name'),
    headerRow: integer('header_row'),
    /** EvidenceColumnMap proposed from the header, before anybody looked. */
    proposedColumns: jsonb('proposed_columns'),
    /** EvidenceColumnMap as confirmed. The only one records are read under. */
    confirmedColumns: jsonb('confirmed_columns'),
    /** 'parsed' | 'imported' | 'failed'. Nothing matches until 'imported'. */
    status: text('status').notNull().default('parsed'),
    error: text('error'),
    recordCount: integer('record_count').notNull().default(0),
    /**
     * Rows the file carried that produced nothing matchable — every mapped
     * field blank. Reported rather than dropped silently, because the gap
     * between "20,000 rows" and "14,300 records" is exactly the gap a person
     * needs to see before leaning on this export's silence.
     */
    skippedCount: integer('skipped_count').notNull().default(0),
    uploadedBy: text('uploaded_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('evidence_exports_engagement_idx').on(table.engagementId, table.status)],
).enableRLS();

/**
 * One row of an external system, reduced to the six fields a match can use.
 *
 * Deliberately not the whole row. Everything else in a CMMS export — the
 * technician, the cost centre, the failure code — is client operational data
 * this product has no business retaining, and keeping it would mean a firm's
 * evidence store slowly becomes a copy of its clients' maintenance systems.
 * `sourceRow` is the pointer back to the file for anything not held here.
 */
export const evidenceRecords = pgTable(
  'evidence_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    exportId: uuid('export_id')
      .notNull()
      .references(() => evidenceExports.id, { onDelete: 'cascade' }),
    /** 0-based row in the source sheet, for the audit trail. */
    sourceRow: integer('source_row').notNull(),
    assetTag: text('asset_tag'),
    serial: text('serial'),
    model: text('model'),
    description: text('description'),
    amount: doublePrecision('amount'),
    lastSeenOn: text('last_seen_on'),
  },
  (table) => [index('evidence_records_export_idx').on(table.exportId)],
).enableRLS();

export type EvidenceExportRow = typeof evidenceExports.$inferSelect;
export type NewEvidenceExportRow = typeof evidenceExports.$inferInsert;
export type EvidenceRecordRow = typeof evidenceRecords.$inferSelect;
export type NewEvidenceRecordRow = typeof evidenceRecords.$inferInsert;

/* --- The operational floor ------------------------------------------------
 *
 * Four tables that are not about a tax return.
 *
 * Everything above this line exists because a client has property to render.
 * These exist because the firm is a going concern that has to know when its own
 * software broke and has to get paid — the two facts that, with zero customers,
 * cost nothing to ignore and, with three, are the ones that end it.
 */

/**
 * A fault, grouped by what went wrong rather than by when.
 *
 * The unit is the *fingerprint*, not the occurrence: one deterministic bug hit
 * by a client refreshing a page is one incident with a count, not four hundred
 * rows that bury the second bug. `fingerprint` is a hash of the surface, the
 * place, and the message with its ids and numbers stripped out, so the same
 * fault from two different clients lands on one row and two different faults
 * from one route stay apart.
 *
 * The unique index is *partial* — one open incident per fingerprint, and none
 * of the resolved ones. So a fault that returns after somebody marked it fixed
 * opens a new row rather than quietly incrementing the old one's counter, and
 * the record then says the true thing: this was closed on the 3rd and came back
 * on the 9th. It also re-alerts, which a reopened row would not.
 *
 * The client and engagement are recorded where the request had them, because
 * "whose upload was it" is the first question and the logs cannot answer it.
 * Both are `set null` rather than `cascade`: deleting a client should not
 * delete the evidence that the software failed them.
 */
export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Hash of surface + label + the message with its variables removed. */
    fingerprint: text('fingerprint').notNull(),
    /** 'api' | 'run' | 'cron' | 'probe' — which part of the system was working. */
    surface: text('surface').notNull(),
    /** Where, in the words a person would use: a route path, a job name. */
    label: text('label').notNull(),
    /** The message as it was thrown, untruncated variables and all. */
    message: text('message').notNull(),
    /** The stack, trimmed. Null when the throw carried none. */
    detail: text('detail'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    engagementId: uuid('engagement_id').references(() => engagements.id, { onDelete: 'set null' }),
    occurrences: integer('occurrences').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    /** When the firm was told. Null means nobody has been mailed about this. */
    alertedAt: timestamp('alerted_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: text('resolved_by'),
    /** Why it was closed. The next person to see it return reads this first. */
    resolution: text('resolution'),
  },
  (table) => [
    /**
     * One *open* incident per fingerprint. Postgres ignores rows failing the
     * predicate, so resolved rows accumulate freely and the upsert below has
     * exactly one row to find.
     */
    uniqueIndex('incidents_open_fingerprint_idx')
      .on(table.fingerprint)
      .where(sql`resolved_at is null`),
    index('incidents_recent_idx').on(table.lastSeenAt),
  ],
).enableRLS();

/**
 * One "everything answered" check, written whether or not it did.
 *
 * A row here is worth more than it looks: it is the only thing that makes
 * silence mean something. Without it, a system that has stopped running its
 * jobs and a system with nothing to do produce identical screens.
 *
 * What this cannot do is notice that the app is down, because it runs inside
 * the app. That is not a gap to be closed by writing more of this file — it is
 * closed by pointing something outside at `/api/health`, which is why that
 * endpoint answers with a status code an uptime service can read. What the
 * probe covers is the larger class of failure where the app is up and one of
 * the things underneath it is not: the warehouse missing, Postgres refusing
 * connections, an environment variable that did not survive a deploy.
 */
export const healthProbes = pgTable(
  'health_probes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    /** True only when every check passed. */
    ok: boolean('ok').notNull(),
    /** Per-dependency results: `[{ name, ok, ms, detail }]`. Shape owned by Zod. */
    checks: jsonb('checks').notNull(),
    /** How long the whole sweep took, for noticing slow before noticing down. */
    ms: integer('ms').notNull(),
    /** 'cron' | 'manual' — a scheduled sweep, or somebody pressing the button. */
    source: text('source').notNull(),
  },
  (table) => [index('health_probes_recent_idx').on(table.checkedAt)],
).enableRLS();

/**
 * What the firm charges for a season, agreed once and then read, never guessed.
 *
 * One row per engagement rather than per client, because the terms are the
 * terms of *this* year's work: a first season that reaches back three years
 * under 25.25 is not priced like the fourth season for the same taxpayer.
 *
 * Three bases, because those are the three ways this work is actually sold:
 *
 *   - **fixed** — one amount for the engagement, whatever it turns up.
 *   - **per-return** — an amount for each return filed. The count comes off
 *     the filings, so a client with eleven sites is billed for eleven.
 *   - **contingency** — a share of what the work saved. Only measurable after
 *     the year resolves, which is exactly what the statement enforces.
 *
 * `minimumCents` exists because a contingency engagement that saves very little
 * still consumed a season of somebody's attention, and a bill for $180 is a
 * bill nobody should send.
 */
export const engagementFees = pgTable(
  'engagement_fees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** 'fixed' | 'per-return' | 'contingency'. */
    basis: text('basis').notNull(),
    /**
     * Money is held in whole cents, unlike every valuation in this schema.
     * Those are estimates of what a district will do and a floating point is
     * honest about them; this is what somebody owes, and a bill that reads
     * $4,999.999999 is a bill that was computed wrong.
     */
    fixedCents: integer('fixed_cents'),
    perReturnCents: integer('per_return_cents'),
    /** The share, as a fraction: 0.25 is a quarter of what was saved. */
    contingencyRate: real('contingency_rate'),
    /** A floor under a contingency fee, where the engagement letter set one. */
    minimumCents: integer('minimum_cents'),
    /** The day the client agreed. A term with no date is a term nobody agreed. */
    agreedOn: date('agreed_on'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('engagement_fees_engagement_idx').on(table.engagementId)],
).enableRLS();

/**
 * A bill, frozen.
 *
 * Same discipline as the filed rendition record: the amount and everything it
 * was computed from are written down at the moment it is issued and never
 * recomputed. A statement that re-derived itself would change after a
 * disposition was edited, and the client is holding a piece of paper that says
 * something else.
 *
 * `terms` is the fee agreement as it stood; `measure` is what the fee was
 * applied to — the realized reduction, the returns counted, the sites they came
 * from. Between them they answer "why is this the number" a year later, when
 * the engagement has moved on and the scoreboard says something different.
 *
 * The only edits a row accepts are the two things that happen to a bill after
 * it goes out: it gets paid, or it gets voided. Neither changes what it says.
 */
export const feeStatements = pgTable(
  'fee_statements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    engagementId: uuid('engagement_id')
      .notNull()
      .references(() => engagements.id, { onDelete: 'cascade' }),
    /** The reference the client quotes back. Unique across the firm. */
    number: text('number').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    issuedBy: text('issued_by'),
    /** The basis this was billed on, snapshotted from the terms. */
    basis: text('basis').notNull(),
    /** `[{ label, detail, amountCents }]` — what the client reads. */
    lines: jsonb('lines').notNull(),
    totalCents: integer('total_cents').notNull(),
    /** The fee agreement as it stood when this was issued. */
    terms: jsonb('terms').notNull(),
    /** What the fee was applied to, in enough detail to re-derive the total. */
    measure: jsonb('measure').notNull(),
    /** 'issued' | 'paid' | 'void'. */
    status: text('status').notNull().default('issued'),
    paidOn: date('paid_on'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => [
    uniqueIndex('fee_statements_number_idx').on(table.number),
    index('fee_statements_engagement_idx').on(table.engagementId, table.issuedAt),
  ],
).enableRLS();

export type IncidentRow = typeof incidents.$inferSelect;
export type NewIncidentRow = typeof incidents.$inferInsert;
export type HealthProbeRow = typeof healthProbes.$inferSelect;
export type EngagementFeeRow = typeof engagementFees.$inferSelect;
export type FeeStatementRow = typeof feeStatements.$inferSelect;
