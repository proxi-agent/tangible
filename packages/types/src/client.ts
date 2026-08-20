import { z } from 'zod';
import { ClassificationStatsSchema } from './classification.js';
import { FarFileSchema } from './far.js';

/**
 * The workspace domain: clients, their locations, and engagements.
 *
 * This is the taxpayer side of the product — the companies whose fixed asset
 * registers we ingest — as opposed to the public-roll side, which lives in the
 * warehouse. A client is a real relationship, mutated by hand, so everything
 * here is Postgres-shaped application state, never warehouse data.
 */

export const CLIENT_STATUSES = ['prospect', 'active', 'archived'] as const;
export const ClientStatusSchema = z.enum(CLIENT_STATUSES);
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const ClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: ClientStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Client = z.infer<typeof ClientSchema>;

/** A client row as the list shows it, with enough context to pick one out. */
export const ClientListItemSchema = ClientSchema.extend({
  engagementCount: z.number().int().nonnegative(),
});

export type ClientListItem = z.infer<typeof ClientListItemSchema>;

/**
 * A physical situs. BPP is assessed where the property sits on January 1, so
 * locations are first-class rather than a free-text column on the client — the
 * same FAR splits across them, and each maps to its own account and rendition.
 */
export const ClientLocationSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  label: z.string(),
  addressLine1: z.string().nullable(),
  city: z.string().nullable(),
  stateCode: z.string().nullable(),
  zip: z.string().nullable(),
  /** Warehouse jurisdiction slug (e.g. `tx-harris`) once the situs is placed. */
  jurisdictionId: z.string().nullable(),
  notes: z.string().nullable(),
});

export type ClientLocation = z.infer<typeof ClientLocationSchema>;

/**
 * One tax season's worth of work for one client. The FAR files, mapped assets,
 * and (later) analyses and filings all hang off an engagement, so a new season
 * starts clean rather than mutating last year's record.
 */
export const EngagementSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  taxYear: z.number().int(),
  jurisdictionId: z.string().nullable(),
  /** The account on the public roll, once identified — the analysis baseline. */
  accountId: z.string().nullable(),
  /** SIC code; decides the machinery life. Falls back to the roll's business code. */
  sicCode: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type Engagement = z.infer<typeof EngagementSchema>;

/** Aggregates over an engagement's normalized assets, for the pipeline header. */
export const EngagementAssetStatsSchema = z.object({
  assetCount: z.number().int().nonnegative(),
  totalCost: z.number(),
  disposedCount: z.number().int().nonnegative(),
  /** Rows that normalized with at least one warning attached. */
  warningCount: z.number().int().nonnegative(),
  missingCostCount: z.number().int().nonnegative(),
  missingYearCount: z.number().int().nonnegative(),
});

export type EngagementAssetStats = z.infer<typeof EngagementAssetStatsSchema>;

export const ClientDetailSchema = z.object({
  client: ClientSchema,
  locations: z.array(ClientLocationSchema),
  engagements: z.array(EngagementSchema),
});

export type ClientDetail = z.infer<typeof ClientDetailSchema>;

export const EngagementDetailSchema = z.object({
  engagement: EngagementSchema,
  client: ClientSchema,
  files: z.array(FarFileSchema),
  stats: EngagementAssetStatsSchema,
  classification: ClassificationStatsSchema,
});

export type EngagementDetail = z.infer<typeof EngagementDetailSchema>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const CreateClientRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  status: ClientStatusSchema.default('prospect'),
  notes: z.string().trim().max(5000).optional(),
});

export type CreateClientRequest = z.infer<typeof CreateClientRequestSchema>;

export const UpdateClientRequestSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  status: ClientStatusSchema.optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export type UpdateClientRequest = z.infer<typeof UpdateClientRequestSchema>;

export const CreateLocationRequestSchema = z.object({
  label: z.string().trim().min(1).max(200),
  addressLine1: z.string().trim().max(300).optional(),
  city: z.string().trim().max(120).optional(),
  stateCode: z.string().trim().length(2).toUpperCase().optional(),
  zip: z.string().trim().max(10).optional(),
  jurisdictionId: z.string().trim().optional(),
  notes: z.string().trim().max(5000).optional(),
});

export type CreateLocationRequest = z.infer<typeof CreateLocationRequestSchema>;

export const CreateEngagementRequestSchema = z.object({
  taxYear: z.coerce.number().int().min(2000).max(2100),
  jurisdictionId: z.string().trim().optional(),
  notes: z.string().trim().max(5000).optional(),
});

export type CreateEngagementRequest = z.infer<typeof CreateEngagementRequestSchema>;

/**
 * Situs is often unknown when the engagement is opened and settled once the
 * register arrives, so the jurisdiction has to be editable after the fact —
 * nothing can be valued until it is set. Null clears it back to unknown.
 */
export const UpdateEngagementRequestSchema = z.object({
  jurisdictionId: z.string().trim().nullable().optional(),
  accountId: z.string().trim().nullable().optional(),
  sicCode: z.string().trim().max(10).nullable().optional(),
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export type UpdateEngagementRequest = z.infer<typeof UpdateEngagementRequestSchema>;
