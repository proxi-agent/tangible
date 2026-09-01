import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole } from 'drizzle-orm/pg-core';
import * as t from './schema.js';

/**
 * Row-level security, declared where `drizzle-kit push` can see it.
 *
 * These policies existed first as plain SQL, and the first `push` after they
 * landed dropped all forty-two of them without being asked to — drizzle-kit
 * reconciles what the database has against what the schema declares, and a
 * policy the schema never mentioned is, to it, a policy that should not be
 * there. It printed the DROPs and applied them, and the application went on
 * working perfectly with the boundary gone. That is the worst possible failure
 * mode for a security control, so the policies live here instead of in a file
 * push has never heard of.
 *
 * What is *not* here is in `sql/tenancy.sql`, which stays: the role itself, the
 * `app.client_id()` function the policies read, and the grants. Those are not
 * things drizzle models, and the SQL file is where the reasoning behind the
 * whole arrangement is written down. Read that first.
 *
 * The two sentences below are the whole vocabulary:
 *
 *     client_id = app.client_id()          — the row names its owner
 *     <fk> in (select id from <parent>)    — the row's parent names it instead
 *
 * The second defers to the parent's own policy rather than repeating the
 * ownership test, so "an invoice line is visible when its invoice is" stays one
 * fact in one place.
 *
 * Eighteen tables appear nowhere in this file. That is deliberate and it is the
 * strongest setting available: RLS is on for them, no policy exists, and a
 * client connection therefore reads nothing. They are the firm's own records —
 * lead lists, saved views, the classification and mapping memories, the
 * assistant's transcripts — and none is a client's to see even in principle.
 *
 * `classification_reviews` is the newest and reads like an exception, since a
 * row on it names a client's asset. It is not one. The row is the firm marking
 * its own engine's homework — what the classifier said, what the reviewer said
 * instead — and the client wing has no screen that asks the question, let alone
 * one that should answer it with the machine's discarded first guess.
 *
 * The four newest are the operational floor: `incidents`, `health_probes`,
 * `engagement_fees` and `fee_statements`. A client's own bill is the one of
 * those that will eventually want a policy, and it does not have one yet
 * because nothing shows it a bill — an unused policy is a hole open for a
 * screen that does not exist.
 *
 * The one worth explaining is `run_checkpoints`, because its
 * parent `analysis_runs` *does* have a policy: a client follows their own
 * report being prepared. A checkpoint is not that. It is one attempt's
 * intermediate working — the roll it read, the evidence it matched — and what
 * the client wing shows of a run is three words and a spinner. A policy here
 * would publish the pipeline's internals to answer a question nothing asks.
 *
 * `packages/db/scripts/verify-tenancy.mjs` proves the whole arrangement against
 * the live database. Run it after every push.
 */

/**
 * Declared as existing so drizzle never tries to create or drop it. The role
 * carries a password, and a password belongs in `scripts/apply-tenancy.mjs`
 * rather than in a file that gets committed.
 */
export const tangibleClient = pgRole('tangible_client').existing();

const mine = sql`client_id = app.client_id()`;

/** A row is visible when the engagement it belongs to is. */
const throughEngagement = sql`engagement_id in (select id from public.engagements)`;

/** A row is visible when its parent row is. */
const through = (fk: string, parent: string) =>
  sql.raw(`${fk} in (select id from public.${parent})`);

/* --- The two roots ------------------------------------------------------ */

export const clientsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: sql`id = app.client_id()`,
  withCheck: sql`id = app.client_id()`,
}).link(t.clients);
export const engagementsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: mine,
  withCheck: mine,
}).link(t.engagements);

/* --- Rows that name their client directly -------------------------------- */

/**
 * `notifications` carries a nullable client_id: the "they answered" template is
 * addressed to the firm. NULL never equals app.client_id(), so those rows are
 * invisible here without a special case — the right answer for the right
 * reason.
 */

export const agentAppointmentsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: mine,
  withCheck: mine,
}).link(t.agentAppointments);
export const assetsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: mine,
  withCheck: mine,
}).link(t.assets);
export const clientFilingProfilesTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: mine,
  withCheck: mine,
}).link(t.clientFilingProfiles);
export const clientLocationsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: mine,
  withCheck: mine,
}).link(t.clientLocations);
export const notificationsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: mine,
  withCheck: mine,
}).link(t.notifications);
export const portalSettingsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: mine,
  withCheck: mine,
}).link(t.portalSettings);
export const portalUsersTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: mine,
  withCheck: mine,
}).link(t.portalUsers);

/* --- Rows that hang off an engagement ------------------------------------ */

export const analysisRunsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.analysisRuns);
export const assessmentNoticesTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.assessmentNotices);
export const assetClassificationsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.assetClassifications);
export const assetVersionsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.assetVersions);
export const correctionMotionsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.correctionMotions);
export const evidenceExportsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.evidenceExports);
export const farFilesTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.farFiles);
export const findingDispositionsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.findingDispositions);
export const findingRowDecisionsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.findingRowDecisions);
export const findingSetsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.findingSets);
export const findingsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.findings);
export const graphAnswersTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.graphAnswers);
export const importBatchesTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.importBatches);
export const intakeFilesTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.intakeFiles);
export const invoiceAssetLinksTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.invoiceAssetLinks);
export const invoiceDocumentsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.invoiceDocuments);
export const mappingAsksTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.mappingAsks);
export const motionDraftsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.motionDrafts);
export const priorDocumentsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.priorDocuments);
export const protestBriefsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.protestBriefs);
export const protestResolutionsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.protestResolutions);
export const recoveryClaimsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.recoveryClaims);
export const recoveryOutcomesTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.recoveryOutcomes);
export const renditionExtensionsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.renditionExtensions);
export const renditionFilingsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.renditionFilings);
export const resultLettersTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.resultLetters);
export const unblockPlansTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: throughEngagement,
  withCheck: throughEngagement,
}).link(t.unblockPlans);

/* --- Rows that hang off another row -------------------------------------- */

export const assetEventsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: through('asset_id', 'assets'),
  withCheck: through('asset_id', 'assets'),
}).link(t.assetEvents);
export const assetPositionsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: through('asset_id', 'assets'),
  withCheck: through('asset_id', 'assets'),
}).link(t.assetPositions);
export const invoiceLinesTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: through('document_id', 'invoice_documents'),
  withCheck: through('document_id', 'invoice_documents'),
}).link(t.invoiceLines);
export const priorReturnLinesTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: through('document_id', 'prior_documents'),
  withCheck: through('document_id', 'prior_documents'),
}).link(t.priorReturnLines);
export const evidenceRecordsTenancy = pgPolicy('client_tenancy', {
  for: 'all',
  to: tangibleClient,
  using: through('export_id', 'evidence_exports'),
  withCheck: through('export_id', 'evidence_exports'),
}).link(t.evidenceRecords);

/* --- Public record -------------------------------------------------------- */

/**
 * Appraisal districts are not anybody's tenant data. A CAD's name, its homepage
 * and its adopted rate are published facts, and the portal prints them next to
 * a site. Readable by everyone, writable by nobody here — hence `select` rather
 * than `all`, and no `withCheck`.
 */
export const jurisdictionsTenancy = pgPolicy('client_tenancy', {
  for: 'select',
  to: tangibleClient,
  using: sql`true`,
}).link(t.jurisdictions);
