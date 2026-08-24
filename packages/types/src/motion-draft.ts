import { z } from 'zod';
import { CorrectionRouteKeySchema, OpenYearSourceSchema } from './filing.js';

/**
 * The 25.25 motion draft: the document between "this route is open" and "we
 * filed on this date".
 *
 * The open-years board computes what the statute leaves; the motions card
 * records what went to the district. The step in the middle — actually writing
 * the motion — was manual, and it is the step with the arithmetic in it: the
 * route's cite, the deadline it must beat, 25.25(d)'s one-third test, what the
 * route costs. Same split as every drafting agent here: the facts are
 * assembled and checked deterministically, the model does only the telling,
 * and the person files it and then records the filing through the same
 * `recordMotion` step as before.
 *
 * Two of the facts are the person's own, which no other agent has needed: the
 * value the firm claims is correct, and the ground of the error in the firm's
 * words. They are inputs because they are assertions — the record holds what
 * the district said, not what we believe it should have said — and they are
 * the same two fields `recordMotion` will store once the motion goes in.
 */

/** The route being invoked, as the outlook computed it. */
export const MotionDraftRouteSchema = z.object({
  key: CorrectionRouteKeySchema,
  /** How the subsection is cited, e.g. "25.25(c-1)". */
  cite: z.string(),
  label: z.string(),
  grounds: z.string(),
  /** The last day it can be filed, where the route has a date at all. */
  deadline: z.string().nullable(),
  /** What using it costs, where it costs anything. */
  cost: z.string().nullable(),
});

export type MotionDraftRoute = z.infer<typeof MotionDraftRouteSchema>;

/** A motion already brought on this account and year, as context for the new one. */
export const MotionDraftPriorSchema = z.object({
  filedOn: z.string(),
  /** The subsection the earlier motion was brought under. */
  route: CorrectionRouteKeySchema,
  /** Where it stands, in the record's own prose. */
  standing: z.string(),
});

export type MotionDraftPrior = z.infer<typeof MotionDraftPriorSchema>;

/** Everything the drafted motion is allowed to rest on. Frozen at draft time. */
export const MotionDraftFactsSchema = z.object({
  clientName: z.string(),
  /** The year being corrected — not the engagement's year. */
  taxYear: z.number().int(),
  label: z.string(),
  accountId: z.string().nullable(),
  districtName: z.string().nullable(),
  /** Where the year's row came from — a scan cannot rule out a settled year. */
  source: OpenYearSourceSchema,
  rolledValue: z.number().nullable(),
  /** What the firm asserts the value should be. */
  claimedValue: z.number(),
  /** Rolled minus claimed, where the roll is known. Assessed value, not tax. */
  reduction: z.number().nullable(),
  /** The error, in the firm's own words. */
  ground: z.string(),
  route: MotionDraftRouteSchema,
  /** The outlook's own prose for the year, caveats included. */
  yearStanding: z.string(),
  priorMotions: z.array(MotionDraftPriorSchema),
});

export type MotionDraftFacts = z.infer<typeof MotionDraftFactsSchema>;

/** What the model drafts. Prose only — every figure must come from the facts. */
export const CorrectionMotionDraftSchema = z.object({
  /** The document's own heading, naming the account, year, and subsection. */
  title: z.string(),
  /** The complete motion, ready for the signer's review. */
  body: z.string(),
  /** Firm-facing: what to confirm or gather before this is filed. */
  cautions: z.array(z.string()),
});

export type CorrectionMotionDraft = z.infer<typeof CorrectionMotionDraftSchema>;

/** A drafted motion as stored: frozen facts, the draft, and its provenance. */
export const MotionDraftRecordSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  /** The open-years (account, year) key the draft belongs to. */
  yearKey: z.string(),
  facts: MotionDraftFactsSchema,
  draft: CorrectionMotionDraftSchema,
  model: z.string().nullable(),
  createdAt: z.string(),
});

export type MotionDraftRecord = z.infer<typeof MotionDraftRecordSchema>;

/** What the person supplies: the route, the assertion, and the words. */
export const DraftMotionRequestSchema = z.object({
  yearKey: z.string().min(1),
  route: CorrectionRouteKeySchema,
  claimedValue: z.number().nonnegative(),
  ground: z.string().trim().min(1, 'Say what is wrong — the motion argues it.'),
});

export type DraftMotionRequest = z.infer<typeof DraftMotionRequestSchema>;
