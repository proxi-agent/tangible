import { z } from 'zod';
import { ClientStatusSchema } from './client.js';

/**
 * Opening the next season across the book.
 *
 * A season ends and every client who was worked this year needs an engagement
 * for the next one. Done by hand that is one typed year per client — and two
 * quiet losses, because `jurisdictionId` and `sicCode` live on the engagement:
 * the county default and the code that decides the machinery schedule for
 * every asset both start over blank. The rollover copies them from the season
 * being left, and everything durable — sites, assets, the filing profile, the
 * appointment, the filed record the carry-forward reads — already belongs to
 * the client and needs no copying at all.
 *
 * The plan is computed before anything is created and shown as the answer:
 * who rolls, who already has next year open, who is archived and stays
 * behind. Running it creates engagements for the ready rows only, so running
 * it twice creates nothing the second time.
 */

export const ROLLOVER_STANDINGS = ['ready', 'already-open', 'archived'] as const;
export const RolloverStandingSchema = z.enum(ROLLOVER_STANDINGS);
export type RolloverStanding = (typeof ROLLOVER_STANDINGS)[number];

/** One client's place in the rollover. */
export const RolloverClientSchema = z.object({
  clientId: z.string(),
  clientName: z.string(),
  clientStatus: ClientStatusSchema,
  /** The engagement being rolled from — the newest one on the season's year. */
  sourceEngagementId: z.string(),
  /** Carried onto the new engagement, because losing them is silent. */
  jurisdictionId: z.string().nullable(),
  sicCode: z.string().nullable(),
  standing: RolloverStandingSchema,
  /** The next year's engagement, where one already exists. */
  openEngagementId: z.string().nullable(),
});

export type RolloverClient = z.infer<typeof RolloverClientSchema>;

/** Who rolls from one season into the next, computed before anything is created. */
export const RolloverPlanSchema = z.object({
  fromYear: z.number().int(),
  toYear: z.number().int(),
  clients: z.array(RolloverClientSchema),
  readyCount: z.number().int().nonnegative(),
  alreadyOpenCount: z.number().int().nonnegative(),
  archivedCount: z.number().int().nonnegative(),
});

export type RolloverPlan = z.infer<typeof RolloverPlanSchema>;

/** What running the rollover did, with the plan as it stands after. */
export const RolloverResultSchema = z.object({
  createdCount: z.number().int().nonnegative(),
  plan: RolloverPlanSchema,
});

export type RolloverResult = z.infer<typeof RolloverResultSchema>;

export const RunRolloverRequestSchema = z.object({
  fromYear: z.number().int().min(2000).max(2100),
});

export type RunRolloverRequest = z.infer<typeof RunRolloverRequestSchema>;
