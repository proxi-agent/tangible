import { z } from 'zod';

/**
 * Fixed asset register (FAR) intake: the file a client exports from whatever
 * tracks their assets — Sage, NetSuite, QuickBooks, or a hand-built workbook.
 *
 * Real registers are not clean tables. They arrive as multi-sheet workbooks
 * with subtotal bands, merged two-row headers, section names carried by row
 * position rather than a column, and lives written as "05/00". The pipeline
 * therefore never trusts a guessed layout: parsing produces a summary, the AI
 * proposes a mapping over it, and a human confirms before a single asset row
 * is written. Same philosophy as the roll connectors — a wrong column mapped
 * silently would produce confident, wrong analysis.
 */

export const FAR_FILE_STATUSES = [
  /** Stored in the private bucket; nothing read yet. */
  'uploaded',
  /** Sheets read and summarized; awaiting a mapping. */
  'parsed',
  /** The AI has proposed a mapping; a human has not confirmed it. */
  'proposed',
  /** Mapping confirmed and asset rows written. */
  'normalized',
  'failed',
] as const;

export const FarFileStatusSchema = z.enum(FAR_FILE_STATUSES);
export type FarFileStatus = (typeof FAR_FILE_STATUSES)[number];

/**
 * The canonical asset vocabulary every FAR column can map onto. This is the
 * contract between the parser, the AI proposal, the review UI, and the assets
 * table — extending it is a schema change everywhere at once, on purpose.
 */
export const CANONICAL_ASSET_FIELDS = [
  'assetTag',
  'description',
  'category',
  'glAccount',
  'acquisitionDate',
  'acquisitionYear',
  'inServiceDate',
  'originalCost',
  'accumulatedDepreciation',
  'netBookValue',
  'quantity',
  'serialNumber',
  'entity',
  'location',
  'department',
  'vendor',
  'usefulLife',
  'depreciationMethod',
  'disposalDate',
  'disposalIndicator',
] as const;

export const CanonicalAssetFieldSchema = z.enum(CANONICAL_ASSET_FIELDS);
export type CanonicalAssetField = (typeof CANONICAL_ASSET_FIELDS)[number];

export interface CanonicalFieldInfo {
  label: string;
  /** What belongs in the column — written for both the mapping UI and the AI prompt. */
  description: string;
}

/**
 * One source of truth for what each field means. The AI proposal prompt and the
 * human review dropdown both read from here, so they can never describe the
 * same field differently.
 */
export const CANONICAL_FIELD_INFO: Readonly<Record<CanonicalAssetField, CanonicalFieldInfo>> = {
  assetTag: {
    label: 'Asset ID / tag',
    description:
      'The register’s own identifier for the asset (system number, tag, asset no). Not required to be unique — Sage splits assets into .001/.002 extensions.',
  },
  description: {
    label: 'Description',
    description: 'What the asset is, in the register’s words. The classification input.',
  },
  category: {
    label: 'Category / class',
    description:
      'The register’s grouping — a GL class, depreciation class, or section name. This is the client’s vocabulary, not a jurisdiction schedule class.',
  },
  glAccount: {
    label: 'GL account',
    description: 'General-ledger asset account number or name, when present.',
  },
  acquisitionDate: {
    label: 'Acquisition date',
    description: 'When the asset was acquired. A year-only value belongs in acquisition year.',
  },
  acquisitionYear: {
    label: 'Acquisition year',
    description: 'Year acquired, when the register carries only a year (or "FY20").',
  },
  inServiceDate: {
    label: 'In-service date',
    description: 'Placed-in-service date, when distinct from acquisition.',
  },
  originalCost: {
    label: 'Original cost',
    description:
      'Historical cost when new — the acquired value the rendition schedules key on. Not net book value.',
  },
  accumulatedDepreciation: {
    label: 'Accumulated depreciation',
    description: 'Book accumulated depreciation to date.',
  },
  netBookValue: {
    label: 'Net book value',
    description: 'Cost less accumulated depreciation. Map it when present; never into cost.',
  },
  quantity: { label: 'Quantity', description: 'Unit count, when the register tracks one.' },
  serialNumber: { label: 'Serial number', description: 'Serial or VIN, when present.' },
  entity: {
    label: 'Entity',
    description:
      'The legal entity that owns the asset — a subsidiary, LLC, or company code. Renditions are filed per owner, so a group filing under three entities is three sets of returns even at one address.',
  },
  location: {
    label: 'Location / situs',
    description:
      'Where the asset sits — site, address, store number. The dirtiest critical field in real registers; map anything situs-shaped here.',
  },
  department: { label: 'Department', description: 'Department or cost center.' },
  vendor: { label: 'Vendor', description: 'Who it was purchased from.' },
  usefulLife: {
    label: 'Useful life',
    description:
      'Book life as the register writes it — "05/00", months, or years. Kept as text; the register’s life is evidence, not the jurisdiction’s life.',
  },
  depreciationMethod: {
    label: 'Depreciation method',
    description: 'Book method code (SL, MF200, MACRS…).',
  },
  disposalDate: {
    label: 'Disposal date',
    description: 'When the asset was disposed or sold, if the register records it.',
  },
  disposalIndicator: {
    label: 'Disposal status',
    description:
      'A status column marking disposed/sold/retired assets, when there is no date. Ghost-asset detection reads this.',
  },
};

/**
 * A sheet reduced to what a mapping decision needs: shape, a preview, and a
 * guessed header row. The preview doubles as the AI prompt input, so it is
 * strings — the model and the reviewer look at exactly the same cells.
 */
export const SheetSummarySchema = z.object({
  name: z.string(),
  rowCount: z.number().int().nonnegative(),
  colCount: z.number().int().nonnegative(),
  /** First rows, stringified; null is an empty cell. Capped in both dimensions. */
  preview: z.array(z.array(z.string().nullable())),
  /** Heuristic guess, 0-based. The mapping may override it; null means none found. */
  detectedHeaderRow: z.number().int().nullable(),
});

export type SheetSummary = z.infer<typeof SheetSummarySchema>;

export const SheetMappingSchema = z.object({
  sheetName: z.string(),
  /** Excluded sheets (summaries, rollforwards, notes) contribute no assets. */
  include: z.boolean(),
  /** 0-based row the column headers sit on; data starts on the next row. Null when the sheet has no header row. */
  headerRow: z.number().int().nullable(),
  columns: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      field: CanonicalAssetFieldSchema.nullable(),
      /** Why this column maps there, when the header alone would not say so. */
      note: z.string().optional(),
    }),
  ),
  /**
   * Hand-built registers often encode the category only by which section band a
   * row sits under — a row holding just "Machinery & Equipment" names every row
   * beneath it. When set, such rows become the running category instead of assets.
   */
  categoryFromBands: z.boolean(),
});

export type SheetMapping = z.infer<typeof SheetMappingSchema>;

export const FarMappingSchema = z.object({
  sheets: z.array(SheetMappingSchema),
});

export type FarMapping = z.infer<typeof FarMappingSchema>;

export const FarMappingProposalSchema = FarMappingSchema.extend({
  /** The model's own read on how safe this mapping is to trust unreviewed. */
  confidence: z.number().min(0).max(1),
  /** What the model noticed — ambiguous columns, sheets it excluded and why. */
  rationale: z.string(),
});

export type FarMappingProposal = z.infer<typeof FarMappingProposalSchema>;

export const FarFileSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  originalFilename: z.string(),
  byteSize: z.number().int().nonnegative(),
  contentType: z.string().nullable(),
  status: FarFileStatusSchema,
  error: z.string().nullable(),
  sheetSummaries: z.array(SheetSummarySchema).nullable(),
  proposal: FarMappingProposalSchema.nullable(),
  /** The mapping a human confirmed — the only one normalization will run. */
  confirmedMapping: FarMappingSchema.nullable(),
  /** Which model proposed, kept so a bad proposal is attributable. */
  proposalModel: z.string().nullable(),
  assetCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type FarFile = z.infer<typeof FarFileSchema>;

/**
 * A canonical asset row, as normalization wrote it.
 *
 * Since assets became durable this is a join of two tables rather than one: `id`
 * is the asset that outlives the upload, `versionId` is the snapshot this row's
 * values came from, and the lineage fields describe the cells that version was
 * read out of. Consumers that only want "the assets on this engagement" are
 * unaffected — the shape is the same one they already read.
 */
export const AssetSchema = z.object({
  /** The durable asset. Stable across re-imports and across tax years. */
  id: z.string(),
  /** The snapshot these values came from. */
  versionId: z.string(),
  engagementId: z.string(),
  farFileId: z.string(),
  batchId: z.string(),
  /** Lineage back to the exact cell range: sheet name and 0-based row. */
  sourceSheet: z.string(),
  sourceRow: z.number().int().nonnegative(),
  assetTag: z.string().nullable(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  glAccount: z.string().nullable(),
  acquisitionDate: z.string().nullable(),
  acquisitionYear: z.number().int().nullable(),
  inServiceDate: z.string().nullable(),
  originalCost: z.number().nullable(),
  accumulatedDepreciation: z.number().nullable(),
  netBookValue: z.number().nullable(),
  quantity: z.number().nullable(),
  serialNumber: z.string().nullable(),
  entity: z.string().nullable(),
  location: z.string().nullable(),
  department: z.string().nullable(),
  vendor: z.string().nullable(),
  usefulLife: z.string().nullable(),
  depreciationMethod: z.string().nullable(),
  disposalDate: z.string().nullable(),
  disposalIndicator: z.string().nullable(),
  /** Derived once at normalization: a disposal date or a disposed-shaped status. */
  isDisposed: z.boolean(),
  /** Everything soft about this row — missing cost, unparseable date, and so on. */
  warnings: z.array(z.string()),
  /** How this row was matched to its durable asset. An AssetMatchMethod. */
  matchMethod: z.string(),
  /** Present in an earlier import, missing from the latest. Not a disposal. */
  isAbsent: z.boolean(),
  /** Where it sits, once resolved from the register's own location text. */
  jurisdictionId: z.string().nullable(),
});

export type Asset = z.infer<typeof AssetSchema>;

/**
 * What confirm returns: enough to say what happened without re-querying.
 *
 * The four graph counts are what make a re-import legible. "482 assets" after a
 * second upload is ambiguous — it could be the same register read again or a
 * whole new company — where "3 new, 479 carried forward, 12 changed, 5 no longer
 * listed" is a sentence about the client's year.
 */
export const NormalizationResultSchema = z.object({
  inserted: z.number().int().nonnegative(),
  /** Rows that produced no asset, each with the reason. Capped; the count is exact. */
  skipped: z.array(z.object({ sheet: z.string(), row: z.number().int(), reason: z.string() })),
  skippedCount: z.number().int().nonnegative(),
  warningCount: z.number().int().nonnegative(),
  totalCost: z.number(),
  batchId: z.string(),
  /** Rows the graph had never seen before. */
  newCount: z.number().int().nonnegative(),
  /** Rows resolved to an asset already on file. */
  matchedCount: z.number().int().nonnegative(),
  /** Matched assets where at least one material field moved. */
  changedCount: z.number().int().nonnegative(),
  /** Assets the graph holds that this register did not mention. Not disposals. */
  absentCount: z.number().int().nonnegative(),
});

export type NormalizationResult = z.infer<typeof NormalizationResultSchema>;

// ---------------------------------------------------------------------------
// Asset queries
// ---------------------------------------------------------------------------

/** Closed set because the values reach ORDER BY. */
export const ASSET_SORT_FIELDS = [
  'sourceRow',
  'description',
  'category',
  'acquisitionYear',
  'originalCost',
] as const;

export const AssetSortFieldSchema = z.enum(ASSET_SORT_FIELDS);
export type AssetSortField = (typeof ASSET_SORT_FIELDS)[number];

export const AssetQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  sheet: z.string().optional(),
  warningsOnly: z.boolean().default(false),
  disposedOnly: z.boolean().default(false),
  sortBy: AssetSortFieldSchema.default('sourceRow'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AssetQuery = z.infer<typeof AssetQuerySchema>;

export const ConfirmMappingRequestSchema = z.object({
  mapping: FarMappingSchema,
});

export type ConfirmMappingRequest = z.infer<typeof ConfirmMappingRequestSchema>;

/** Upload constraints, shared by the dropzone and the route that enforces them. */
export const FAR_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
export const FAR_UPLOAD_EXTENSIONS = ['.xlsx', '.xls', '.xlsm', '.csv', '.tsv'] as const;
