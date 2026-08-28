import { z } from 'zod';
import { SheetSummarySchema } from './far.js';

/**
 * The wire shapes for external evidence.
 *
 * What crosses the wire is deliberately thinner than what the matcher works
 * with. A screen needs to know that a maintenance export holds 14,300 records
 * and was read under these six columns; it never needs the 14,300 records, and
 * sending them would put a client's whole maintenance system in a browser tab
 * for no purpose. Records are queried by export when somebody asks to see a
 * sample, and by asset when a finding names one.
 */

export const EvidenceSourceKindSchema = z.enum([
  'cmms',
  'itam',
  'insurance-sov',
  'real-property',
  'lease-subledger',
  'physical-inventory',
]);

export type EvidenceSourceKindDto = z.infer<typeof EvidenceSourceKindSchema>;

export const EvidenceColumnMapSchema = z.object({
  assetTag: z.number().int().nonnegative().nullable(),
  serial: z.number().int().nonnegative().nullable(),
  model: z.number().int().nonnegative().nullable(),
  description: z.number().int().nonnegative().nullable(),
  amount: z.number().int().nonnegative().nullable(),
  lastSeenOn: z.number().int().nonnegative().nullable(),
});

export type EvidenceColumnMapDto = z.infer<typeof EvidenceColumnMapSchema>;

export const EvidenceExportStatusSchema = z.enum(['parsed', 'imported', 'failed']);

export const EvidenceExportSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  kind: EvidenceSourceKindSchema,
  originalFilename: z.string(),
  byteSize: z.number().int().nonnegative(),
  contentType: z.string().nullable(),
  sheetSummaries: z.array(SheetSummarySchema).nullable(),
  sheetName: z.string().nullable(),
  headerRow: z.number().int().nonnegative().nullable(),
  proposedColumns: EvidenceColumnMapSchema.nullable(),
  confirmedColumns: EvidenceColumnMapSchema.nullable(),
  status: EvidenceExportStatusSchema,
  error: z.string().nullable(),
  recordCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
  uploadedBy: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type EvidenceExport = z.infer<typeof EvidenceExportSchema>;

/**
 * What the whole set of exports adds up to for one engagement.
 *
 * `coverage` is the number the screen is actually for. A firm that has uploaded
 * a maintenance export has not thereby covered its register — the export speaks
 * to machinery and says nothing about furniture — and the honest headline is
 * how many settled assets have at least one source able to speak to them, not
 * how many files were uploaded.
 */
export const EvidenceCoverageSchema = z.object({
  /** Settled, taxable assets on the engagement. The denominator. */
  assetCount: z.number().int().nonnegative(),
  /** Assets at least one imported source covers by category. */
  coveredCount: z.number().int().nonnegative(),
  /** Assets some source actually found. */
  matchedCount: z.number().int().nonnegative(),
  /** Assets a covering source searched for and did not find. */
  deniedCount: z.number().int().nonnegative(),
  /** Category keys no imported source speaks to, with how many assets sit there. */
  blindSpots: z.array(
    z.object({ categoryKey: z.string(), label: z.string(), assetCount: z.number().int() }),
  ),
});

export type EvidenceCoverage = z.infer<typeof EvidenceCoverageSchema>;

export const EvidenceBoardSchema = z.object({
  engagementId: z.string(),
  exports: z.array(EvidenceExportSchema),
  coverage: EvidenceCoverageSchema.nullable(),
  /** Set when coverage could not be computed — no settled assets to measure against. */
  note: z.string().nullable(),
});

export type EvidenceBoard = z.infer<typeof EvidenceBoardSchema>;

/**
 * One asset's evidence, for the asset page.
 *
 * The three-way split survives all the way to the screen: what was found, what
 * was searched for and not found, and what was never in scope. Flattening it
 * into "2 matches" is what would make an out-of-scope source look like a source
 * that came back empty.
 */
export const AssetEvidenceSchema = z.object({
  assetId: z.string(),
  matches: z.array(
    z.object({
      source: EvidenceSourceKindSchema,
      sourceLabel: z.string(),
      method: z.string(),
      score: z.number(),
      on: z.string(),
      lastSeenOn: z.string().nullable(),
      affirms: z.string(),
      exportId: z.string().nullable(),
      filename: z.string().nullable(),
    }),
  ),
  negatives: z.array(
    z.object({
      source: EvidenceSourceKindSchema,
      sourceLabel: z.string(),
      statement: z.string(),
      searched: z.number().int().nonnegative(),
    }),
  ),
  silent: z.array(z.object({ source: EvidenceSourceKindSchema, note: z.string() })),
});

export type AssetEvidence = z.infer<typeof AssetEvidenceSchema>;
