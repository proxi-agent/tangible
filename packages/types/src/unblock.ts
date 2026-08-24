import { z } from 'zod';

/**
 * The unblock plan: what would release the blocked returns, and who has to act.
 *
 * A blocker already says what clears it — `FilingBlocker.resolution` is the
 * record gate's own sentence — but the season's remaining work is not one
 * sentence per defect. Half the blockers are cleared by the client (a signed
 * 50-162, a situs address, an answer about a site), and somebody has to turn
 * those into one email a controller will actually act on, while the deadline
 * pressure sits per return, not per blocker.
 *
 * Same discipline as the protest brief, which this deliberately copies:
 * the facts are assembled by code and frozen, the model drafts prose from
 * them and nothing else, and the person sends the email — the agent contacts
 * nobody.
 */

/** One blocker as the drafter is allowed to see it. */
export const UnblockBlockerSchema = z.object({
  key: z.string(),
  message: z.string(),
  /** The record gate's own statement of what clears it. The drafter's authority. */
  resolution: z.string(),
});

export type UnblockBlocker = z.infer<typeof UnblockBlockerSchema>;

/** One blocked return, with the deadline it is actually working to. */
export const UnblockReturnSchema = z.object({
  label: z.string(),
  accountId: z.string().nullable(),
  dueOn: z.string(),
  daysToDue: z.number().int(),
  blockers: z.array(UnblockBlockerSchema),
});

export type UnblockReturn = z.infer<typeof UnblockReturnSchema>;

/** Everything the drafted plan may rest on, frozen on the row at draft time. */
export const UnblockFactsSchema = z.object({
  clientName: z.string(),
  taxYear: z.number().int(),
  /** Blocked returns only, tightest deadline first. */
  returns: z.array(UnblockReturnSchema),
});

export type UnblockFacts = z.infer<typeof UnblockFactsSchema>;

/** One concrete step, owned by whoever can actually take it. */
export const UnblockStepSchema = z.object({
  returnLabel: z.string(),
  blockerKey: z.string(),
  /** 'firm' is work in this app or at the district; 'client' needs the client. */
  owner: z.enum(['firm', 'client']),
  action: z.string(),
});

export type UnblockStep = z.infer<typeof UnblockStepSchema>;

/** What the model drafts. Every step must trace to a supplied blocker. */
export const UnblockPlanSchema = z.object({
  /** Two or three sentences: what is blocked and what one afternoon clears. */
  summary: z.string(),
  steps: z.array(UnblockStepSchema),
  /**
   * The outreach covering every client-owned step, written for a controller,
   * not a tax agent. Null when nothing needs the client — inventing an email
   * with nothing to ask for is worse than none.
   */
  clientEmail: z
    .object({
      subject: z.string(),
      body: z.string(),
    })
    .nullable(),
  /** Anything the drafter judged worth saying that fits no step. */
  notes: z.array(z.string()),
});

export type UnblockPlan = z.infer<typeof UnblockPlanSchema>;

/** A drafted plan as stored: frozen facts, the draft, and its provenance. */
export const UnblockPlanRecordSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  facts: UnblockFactsSchema,
  plan: UnblockPlanSchema,
  model: z.string().nullable(),
  createdAt: z.string(),
});

export type UnblockPlanRecord = z.infer<typeof UnblockPlanRecordSchema>;
