import { z } from 'zod';

export const INGEST_STATUSES = [
  'pending',
  'downloading',
  'extracting',
  'loading',
  'normalizing',
  'completed',
  'failed',
] as const;

export const IngestStatusSchema = z.enum(INGEST_STATUSES);
export type IngestStatus = (typeof INGEST_STATUSES)[number];

/** A source file as advertised by a jurisdiction's data portal. */
export const SourceFileSchema = z.object({
  jurisdictionId: z.string(),
  taxYear: z.number().int(),
  /** What this file contains, e.g. 'accounts', 'detail', 'jurisdictions'. */
  kind: z.string(),
  url: z.string().url(),
  fileName: z.string(),
  sizeBytes: z.number().int().nullable().default(null),
  /** SHA-256 of the downloaded archive, so re-ingests are skippable. */
  checksum: z.string().nullable().default(null),
});

export type SourceFile = z.infer<typeof SourceFileSchema>;

export const IngestRunSchema = z.object({
  id: z.string(),
  jurisdictionId: z.string(),
  connectorId: z.string(),
  taxYears: z.array(z.number().int()),
  status: IngestStatusSchema,
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime().nullable(),
  rowsLoaded: z.number().int().nonnegative(),
  filesProcessed: z.number().int().nonnegative(),
  /** Human-readable progress line, updated as the run advances. */
  message: z.string().nullable(),
  error: z.string().nullable(),
});

export type IngestRun = z.infer<typeof IngestRunSchema>;

export const StartIngestRequestSchema = z.object({
  jurisdictionId: z.string(),
  taxYears: z.array(z.number().int()).min(1),
  /** Re-download and reload even when the checksum is unchanged. */
  force: z.boolean().default(false),
});

export type StartIngestRequest = z.infer<typeof StartIngestRequestSchema>;

/**
 * Column mapping for a source file whose layout we cannot infer. Positional
 * layouts are keyed by column index; delimited files with headers resolve by
 * name and need no entry.
 */
export const ColumnLayoutSchema = z.record(
  z.string(),
  z.union([z.number().int().nonnegative(), z.string()]),
);

export type ColumnLayout = z.infer<typeof ColumnLayoutSchema>;
