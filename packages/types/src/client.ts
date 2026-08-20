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
  /**
   * This site's account on the public roll. The district opens one per business
   * location, so it belongs to the site and not to the season's engagement.
   */
  accountId: z.string().nullable(),
  notes: z.string().nullable(),
});

export type ClientLocation = z.infer<typeof ClientLocationSchema>;

/**
 * One of the places a register says its property sits, and where we have put it.
 *
 * A `location` column is the only thing most fixed asset registers carry about
 * situs, and it is the client's own shorthand — "Houston Plant", "Bldg 4",
 * "WH-2". That text is evidence, not an answer: a {@link ClientLocation} is our
 * reading of it, with the address the district actually needs. Grouping by the
 * text is therefore the unit an operator works in, because resolving a site
 * means saying once what a thousand rows meant.
 *
 * Every count here is over property still held. Disposed rows are reported
 * separately and never counted in, because they are not on any return — but
 * they are still placed along with their group, since they sat somewhere too.
 */
export const EngagementSiteSchema = z.object({
  /** The register's words. Null groups the rows whose location cell was blank. */
  text: z.string().nullable(),
  assetCount: z.number().int().nonnegative(),
  disposedCount: z.number().int().nonnegative(),
  totalCost: z.number(),
  /** Where this group's assets actually sit. Two entries means it was split. */
  placements: z.array(
    z.object({
      locationId: z.string(),
      label: z.string(),
      assetCount: z.number().int().nonnegative(),
    }),
  ),
  /** Held assets in this group with no location resolved yet. */
  unplacedCount: z.number().int().nonnegative(),
});

export type EngagementSite = z.infer<typeof EngagementSiteSchema>;

/**
 * One return this engagement owes: a placed site, and the property standing on
 * it.
 *
 * A rendition is a statement about one account, and a district opens one
 * account per business location, so the unit of filing is the situs and not the
 * season's engagement. Everything upstream — the register, its classification,
 * the valuation, the savings report — is engagement-wide and stays that way,
 * because the client hired us once for a year's work. Only the paper splits.
 *
 * A site with no property held on it is not a return. Nothing would go on the
 * form, and filing an empty rendition on an account the client no longer
 * occupies invites a district to keep assessing it.
 */
export const EngagementReturnSchema = z.object({
  locationId: z.string(),
  label: z.string(),
  /** The site's roll account. Null means the filing cannot cite one yet. */
  accountId: z.string().nullable(),
  /** The site's own county where it names one, else the engagement's. */
  jurisdictionId: z.string().nullable(),
  /** The situs as the form prints it. Empty until the address is filled in. */
  addressLines: z.array(z.string()),
  /** Property held at this site. Disposed rows are on no return at all. */
  assetCount: z.number().int().nonnegative(),
  totalCost: z.number(),
});

export type EngagementReturn = z.infer<typeof EngagementReturnSchema>;

/**
 * Every return an engagement owes, and the property that is on none of them.
 *
 * The unplaced count is reported alongside rather than folded into a return,
 * because which of the two it means is exactly what nobody knows yet. With a
 * single site there is only one answer and the rendition takes it; with two,
 * guessing would file one taxing unit's property in another's.
 */
export const EngagementReturnsSchema = z.object({
  returns: z.array(EngagementReturnSchema),
  unplacedCount: z.number().int().nonnegative(),
  unplacedCost: z.number(),
});

export type EngagementReturns = z.infer<typeof EngagementReturnsSchema>;

/**
 * The facts Form 50-144 asks for that a fixed asset register does not carry.
 *
 * Held once per client rather than per filing: a taxpayer has one identity on
 * the roll and one address its notices go to, and retyping them each season is
 * how a wrong one gets sworn to. Every field is nullable — a half-filled
 * profile is the ordinary state of a new client, and the form is already built
 * to name what is missing instead of printing a blank.
 */
export const ClientFilingProfileSchema = z.object({
  clientId: z.string(),
  /** The owner as it appears on the roll. Null falls back to the client's name. */
  ownerName: z.string().nullable(),
  mailingAddressLine1: z.string().nullable(),
  mailingAddressLine2: z.string().nullable(),
  mailingCity: z.string().nullable(),
  mailingStateCode: z.string().nullable(),
  mailingZip: z.string().nullable(),
  /** What the business does, in the owner's words. Not the SIC code restated. */
  businessDescription: z.string().nullable(),
  /** ISO date of the Form 50-162 appointment. Without one an agent cannot sign. */
  agentAppointmentDate: z.string().nullable(),
  signerTitle: z.string().nullable(),
});

export type ClientFilingProfile = z.infer<typeof ClientFilingProfileSchema>;

/**
 * One tax season's worth of work for one client. The FAR files, mapped assets,
 * and (later) analyses and filings all hang off an engagement, so a new season
 * starts clean rather than mutating last year's record.
 */
export const EngagementSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  taxYear: z.number().int(),
  /** The county this season is for, and the default for its sites. */
  jurisdictionId: z.string().nullable(),
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
  /** Null until somebody has filled any of it in. */
  filingProfile: ClientFilingProfileSchema.nullable(),
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
  accountId: z.string().trim().max(60).optional(),
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
  sicCode: z.string().trim().max(10).nullable().optional(),
  taxYear: z.coerce.number().int().min(2000).max(2100).optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export type UpdateEngagementRequest = z.infer<typeof UpdateEngagementRequestSchema>;

/**
 * A box on the filing profile form. Blank means unknown, so it lands as null
 * rather than as the empty string — the form's omissions turn on the
 * difference, and a mailing address of one space is not an address. Applied
 * before the inner check so clearing a two-letter state code is allowed to
 * leave it empty rather than failing the length rule.
 */
const box = <T extends z.ZodType<string>>(inner: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    inner.nullable(),
  );

/**
 * Upsert of a client's filing profile. Sent whole rather than as a patch: the
 * screen is one form and saves as one, and clearing a box means the answer is
 * unknown again.
 */
export const UpdateFilingProfileRequestSchema = z.object({
  ownerName: box(z.string().trim().max(200)),
  mailingAddressLine1: box(z.string().trim().max(300)),
  mailingAddressLine2: box(z.string().trim().max(300)),
  mailingCity: box(z.string().trim().max(120)),
  mailingStateCode: box(z.string().trim().length(2).toUpperCase()),
  mailingZip: box(z.string().trim().max(10)),
  businessDescription: box(z.string().trim().max(2000)),
  agentAppointmentDate: box(
    z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use an ISO date, like 2026-01-15.'),
  ),
  signerTitle: box(z.string().trim().max(120)),
});

export type UpdateFilingProfileRequest = z.infer<typeof UpdateFilingProfileRequestSchema>;

/**
 * Editing a location after the fact, which is the normal case: a site is first
 * recorded as a label somebody recognises, and the address the district needs
 * gets filled in later. PATCH rather than PUT because a location is a row in a
 * list, edited in place, not a screen that saves as one.
 */
export const UpdateLocationRequestSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  addressLine1: box(z.string().trim().max(300)).optional(),
  city: box(z.string().trim().max(120)).optional(),
  stateCode: box(z.string().trim().length(2).toUpperCase()).optional(),
  zip: box(z.string().trim().max(10)).optional(),
  jurisdictionId: box(z.string().trim().max(100)).optional(),
  accountId: box(z.string().trim().max(60)).optional(),
  notes: box(z.string().trim().max(5000)).optional(),
});

export type UpdateLocationRequest = z.infer<typeof UpdateLocationRequestSchema>;

/**
 * Place every asset a register filed under one location string.
 *
 * The unit is the string, not the asset: a register names its sites a handful
 * of times across thousands of rows, and asking an operator to place rows one
 * by one would be asking them to do by hand what the file already told us.
 *
 * This writes to the durable asset rather than to the version, so a placement
 * outlives the register it was read from and applies to every engagement that
 * asset appears in. That is correct — a lathe is in one building, whatever
 * season we are filing — but it does mean placing from one engagement moves
 * the asset for all of them.
 */
export const PlaceSiteRequestSchema = z.object({
  /** Null targets the rows whose location cell was blank. */
  text: z.string().nullable(),
  locationId: z.string().min(1),
});

export type PlaceSiteRequest = z.infer<typeof PlaceSiteRequestSchema>;
