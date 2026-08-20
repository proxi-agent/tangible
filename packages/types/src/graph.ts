import { z } from 'zod';

/**
 * The asset graph: an asset as a thing the company owns, not a row in a
 * spreadsheet.
 *
 * Until now an asset was owned by the file it arrived in — confirming a mapping
 * deleted every row for that file and inserted a fresh set. That is correct for
 * a single import and impossible to build on, because it means an asset has no
 * identity that survives the next upload. There is nothing to attach a history
 * to, nothing to compare last year's register against, and no way to say that a
 * machine moved from Houston to Dallas in March.
 *
 * So identity moves up a level. An asset belongs to the **client**, not to a
 * file and not to an engagement. Each import produces a *version* of it, each
 * difference between versions produces an *event*, and each tax year produces a
 * *position* — what it was rendered at, what it was assessed at, what it cost
 * in tax.
 *
 * The discipline is the same one that runs everywhere else here: a match that
 * rests on an assumption says so, and a number that was derived rather than
 * observed is labelled as derived. An asset graph that quietly asserts two rows
 * are the same asset is worse than one that admits it is guessing, because the
 * whole point of it is to be the record you can defend.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export const ASSET_MATCH_METHODS = [
  /**
   * The register's own identifier matched one we already hold. The strongest
   * signal there is, and the usual case for any client whose fixed asset system
   * assigns tags — which is most of them.
   */
  'asset-tag',
  /**
   * No usable tag, but description, cost and acquisition agree exactly. Solid
   * for anything distinctive: a register rarely holds two different assets
   * called "Haas VF-2SS vertical mill" bought the same year for the same money.
   */
  'fingerprint',
  /**
   * The fingerprint matched more than one asset, and this row took the nth
   * place among them. Ten identical desks bought on one purchase order are ten
   * rows with one fingerprint, and they have to stay ten assets rather than
   * collapsing into one.
   *
   * Weaker than it looks and stronger than it sounds: we cannot tell which
   * physical desk is which, and it does not matter, because they are fungible
   * and carry identical tax treatment. It is recorded distinctly all the same,
   * because a reviewer looking at a disposal should know the difference between
   * "this asset left" and "one of these ten left".
   */
  'fingerprint-ordinal',
  /** Nothing matched. This is the first time we have seen this asset. */
  'new',
] as const;

export const AssetMatchMethodSchema = z.enum(ASSET_MATCH_METHODS);
export type AssetMatchMethod = (typeof ASSET_MATCH_METHODS)[number];

// ---------------------------------------------------------------------------
// Change
// ---------------------------------------------------------------------------

/**
 * Fields whose movement between imports is worth a line in the history.
 *
 * Deliberately not every column. `sourceRow` moving means somebody inserted a
 * row above it; `raw` changing means a column shifted. Neither is a fact about
 * the asset, and a log full of them is a log nobody reads.
 */
export const TRACKED_ASSET_FIELDS = [
  'description',
  'category',
  'glAccount',
  'entity',
  'location',
  'department',
  'serialNumber',
  'originalCost',
  'quantity',
  'acquisitionDate',
  'acquisitionYear',
  'inServiceDate',
  'usefulLife',
  'depreciationMethod',
  'accumulatedDepreciation',
  'netBookValue',
] as const;

export const TrackedAssetFieldSchema = z.enum(TRACKED_ASSET_FIELDS);
export type TrackedAssetField = (typeof TRACKED_ASSET_FIELDS)[number];

/**
 * Book depreciation moves every year on every asset by design. Recording those
 * changes is right — they are real, and a register that *stopped* depreciating
 * something is itself a finding — but surfacing them beside a cost restatement
 * would bury the thing worth looking at under thousands of rows of arithmetic.
 *
 * So every change is stored and each one says which kind it is. The history
 * view shows material changes and offers the rest.
 */
const ROUTINE_FIELDS = new Set<TrackedAssetField>(['accumulatedDepreciation', 'netBookValue']);

export const CHANGE_SIGNIFICANCES = ['material', 'routine'] as const;
export const ChangeSignificanceSchema = z.enum(CHANGE_SIGNIFICANCES);
export type ChangeSignificance = (typeof CHANGE_SIGNIFICANCES)[number];

export function significanceOf(field: TrackedAssetField): ChangeSignificance {
  return ROUTINE_FIELDS.has(field) ? 'routine' : 'material';
}

export const ASSET_EVENT_KINDS = [
  /** First import this asset appeared in. Every asset has exactly one. */
  'discovered',
  /**
   * A tracked field moved between imports. Carries `field`, `previousValue` and
   * `value` — the three things a reviewer needs to judge it without opening
   * both registers.
   */
  'field-changed',
  /** The register began marking it sold, scrapped, retired or written off. */
  'disposed',
  /**
   * A disposal mark went away. Usually a correction, occasionally a register
   * being rebuilt badly, and always worth seeing — the asset has been off the
   * rendition and is about to go back on it.
   */
  'undisposed',
  /**
   * Present in an earlier import, missing from this one, with no disposal
   * recorded. **This is not a disposal.** A register exported with a filter on,
   * a location sold with its rows dropped, and an asset genuinely retired
   * without an entry all look identical here, and only the client can say
   * which. It is recorded as the open question it is.
   */
  'absent',
  /** Absent from at least one import, and back. */
  'reappeared',
  /** First classification decision recorded against it. */
  'classified',
  /** A later decision changed the class. Carries both, so the swing is legible. */
  'reclassified',
] as const;

export const AssetEventKindSchema = z.enum(ASSET_EVENT_KINDS);
export type AssetEventKind = (typeof ASSET_EVENT_KINDS)[number];

export const AssetEventSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  kind: AssetEventKindSchema,
  /** The import that produced it, where one did. Classification events have none. */
  batchId: z.string().nullable(),
  /** Set on field-changed; null on every other kind. */
  field: TrackedAssetFieldSchema.nullable(),
  previousValue: z.string().nullable(),
  value: z.string().nullable(),
  significance: ChangeSignificanceSchema,
  /** One sentence a person can read without decoding the fields above. */
  summary: z.string(),
  /** Who or what caused it: an import batch, the classification engine, a person. */
  actor: z.string().nullable(),
  occurredAt: z.string().datetime(),
});

export type AssetEvent = z.infer<typeof AssetEventSchema>;

// ---------------------------------------------------------------------------
// Per-year position
// ---------------------------------------------------------------------------

export const POSITION_SOURCES = [
  /**
   * Read off a document the client gave us — a prior rendition, an assessment
   * notice. The only source that is a fact rather than a calculation.
   */
  'rendered',
  /** Our own arithmetic against the district's published schedules. */
  'computed',
  /**
   * Apportioned down from an account-level figure, because districts assess an
   * account and not an asset. `allocationBasis` says how, and no allocated
   * number is ever presented as something the district said.
   */
  'allocated',
] as const;

export const PositionSourceSchema = z.enum(POSITION_SOURCES);
export type PositionSource = (typeof POSITION_SOURCES)[number];

/**
 * What one asset was worth, to one jurisdiction, in one tax year.
 *
 * Split by source rather than collapsed into a single "value" because the three
 * differ in kind. What the client rendered is a fact about a filed document.
 * What the schedules produce is our arithmetic. What the district assessed is
 * known only for the account as a whole, so any per-asset figure is an
 * apportionment — useful for ranking where the money sits, never quotable as
 * the district's opinion of that asset.
 */
export const AssetPositionSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  taxYear: z.number().int(),
  jurisdictionId: z.string(),
  accountId: z.string().nullable(),
  /** From a prior return, when we hold one. */
  renderedValue: z.number().nullable(),
  /** From the district's schedules and our classification. */
  scheduleValue: z.number().nullable(),
  /** Apportioned from the account's assessed value. Never observed. */
  allocatedAssessedValue: z.number().nullable(),
  allocationBasis: z.string().nullable(),
  estimatedTax: z.number().nullable(),
  taxRate: z.number().nullable(),
  source: PositionSourceSchema,
  createdAt: z.string().datetime(),
});

export type AssetPosition = z.infer<typeof AssetPositionSchema>;

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export const BATCH_STATUSES = ['pending', 'applied', 'superseded', 'failed'] as const;
export const BatchStatusSchema = z.enum(BATCH_STATUSES);
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/**
 * One application of one confirmed mapping to one file.
 *
 * A file can be confirmed more than once — a mis-set header row, a cost column
 * corrected — and each confirmation is a separate batch rather than an
 * overwrite. That is what makes re-confirming safe *and* auditable: the earlier
 * batch is marked superseded and its versions stay readable, so "why did this
 * asset's cost change" has an answer that names a mapping rather than shrugging.
 */
export const ImportBatchSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  farFileId: z.string(),
  status: BatchStatusSchema,
  /** Counts of what the diff decided, kept so a batch can be explained later. */
  assetCount: z.number().int().nonnegative(),
  newCount: z.number().int().nonnegative(),
  matchedCount: z.number().int().nonnegative(),
  absentCount: z.number().int().nonnegative(),
  changedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  createdBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  appliedAt: z.string().datetime().nullable(),
});

export type ImportBatch = z.infer<typeof ImportBatchSchema>;

/** Everything the graph knows about one asset, for the detail drawer. */
export const AssetProfileSchema = z.object({
  assetId: z.string(),
  clientId: z.string(),
  naturalKey: z.string(),
  ordinal: z.number().int().nonnegative(),
  matchMethod: AssetMatchMethodSchema,
  firstSeenBatchId: z.string(),
  lastSeenBatchId: z.string(),
  isAbsent: z.boolean(),
  events: z.array(AssetEventSchema),
  positions: z.array(AssetPositionSchema),
});

export type AssetProfile = z.infer<typeof AssetProfileSchema>;
