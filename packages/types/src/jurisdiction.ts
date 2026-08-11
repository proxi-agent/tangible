import { z } from 'zod';

/**
 * A taxing jurisdiction whose public roll we ingest. Today that means Texas
 * county appraisal districts (CADs); the shape is deliberately generic so other
 * states can be added without a schema change.
 */
export const JurisdictionSchema = z.object({
  /** Stable slug used as the partition key everywhere: 'tx-harris'. */
  id: z.string().min(1),
  name: z.string().min(1),
  /** Appraisal district short name, e.g. 'HCAD'. */
  cadCode: z.string().min(1),
  state: z.string().length(2),
  county: z.string().min(1),
  /** FIPS county code, useful for joining against census/BLS data later. */
  fips: z.string().length(5).nullable().default(null),
  /** Which connector knows how to fetch this jurisdiction's files. */
  connectorId: z.string().min(1),
  /** Blended total rate across overlapping taxing units. */
  blendedTaxRate: z.number().positive(),
  /** Tax years we have loaded, ascending. */
  availableYears: z.array(z.number().int()).default([]),
  homepageUrl: z.string().url().nullable().default(null),
  dataPortalUrl: z.string().url().nullable().default(null),
  /**
   * What this district's public file does *not* contain. Districts publish
   * different fields, so a figure that is complete for one county can be a
   * floor for another — these notes travel with the data and are shown wherever
   * its numbers are.
   */
  dataNotes: z.array(z.string()).default([]),
});

export type Jurisdiction = z.infer<typeof JurisdictionSchema>;

export const JurisdictionSummarySchema = JurisdictionSchema.extend({
  accountCount: z.number().int().nonnegative(),
  latestYear: z.number().int().nullable(),
  lastIngestedAt: z.string().datetime().nullable(),
});

export type JurisdictionSummary = z.infer<typeof JurisdictionSummarySchema>;
