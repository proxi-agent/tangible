import { z } from 'zod';

/**
 * The protest brief: the argument for one notice, assembled from the record.
 *
 * By the time a notice needs protesting, every fact the argument rests on is
 * already in the system — the rendered total the firm swore to, the value the
 * district answered with, the findings behind our number and how each was
 * decided, the penalty posture. Building the brief by hand means re-finding
 * all of it under a thirty-day clock. So the split here is the same one the
 * whole product runs on:
 *
 *   - **The facts are assembled deterministically** and frozen on the brief.
 *     No model touches a number. A brief read in November argues from the
 *     record as it stood when drafted, whatever has changed since.
 *   - **The prose is drafted by the model from those facts only**, told to
 *     cite nothing it was not given. Argument structure is what a model is
 *     for; arithmetic is not.
 *   - **The agent files nothing.** The brief is a draft for the person who
 *     will sign the protest, and recording that the protest went in stays the
 *     same hand-confirmed step it always was.
 */

/** One finding position carried into the brief, as it was decided. */
export const BriefPositionSchema = z.object({
  title: z.string(),
  /** How the engagement decided it. Null means claimed but never decided. */
  status: z.enum(['accepted', 'rejected', 'pending-client']).nullable(),
  /** Original cost of the assets involved — the scale of the position. */
  cost: z.number().nullable(),
  assetCount: z.number().int().nullable(),
});

export type BriefPosition = z.infer<typeof BriefPositionSchema>;

/**
 * Everything the drafted argument is allowed to rest on.
 *
 * Frozen on the brief row at draft time, for the same reason a filing freezes
 * its rendition: the brief has to be readable later as a statement about what
 * the record said *then*, not a claim that quietly updates itself.
 */
export const ProtestBriefFactsSchema = z.object({
  taxYear: z.number().int(),
  locationLabel: z.string(),
  accountId: z.string().nullable(),
  districtName: z.string().nullable(),

  /** The clock: when the notice is dated and when the window closes. */
  noticedOn: z.string(),
  protestDeadline: z.string(),

  /** The district's answer. */
  appraisedValue: z.number().nullable(),
  priorYearValue: z.number().nullable(),
  renditionPenaltyApplied: z.boolean().nullable(),
  /** 22.30(b)'s thirty days, where a penalty was applied. */
  waiverDeadline: z.string().nullable(),

  /** The return this notice answered, where one went out. */
  filed: z
    .object({
      filedOn: z.string(),
      totalHistoricalCost: z.number(),
      /** The value our schedules support — the number the protest asks for. */
      scheduleValue: z.number(),
      assetCount: z.number().int(),
    })
    .nullable(),

  /**
   * Noticed value minus our filed value, where both are known. Positive is
   * the over-assessment being argued; negative or zero means the district
   * came in at or under our own number and the brief should say so.
   */
  overAssessment: z.number().nullable(),

  /** The findings the engagement committed, with how each was decided. */
  positions: z.array(BriefPositionSchema),
});

export type ProtestBriefFacts = z.infer<typeof ProtestBriefFactsSchema>;

/** One ground of protest: a heading, the argument, and what backs it. */
export const BriefGroundSchema = z.object({
  heading: z.string(),
  argument: z.string(),
  /** Which of the supplied facts this ground rests on, in plain words. */
  support: z.string(),
});

export type BriefGround = z.infer<typeof BriefGroundSchema>;

/** What the model drafts. Prose only — every number must come from the facts. */
export const ProtestBriefSchema = z.object({
  /** Two or three sentences: what is being protested and what is asked for. */
  summary: z.string(),
  grounds: z.array(BriefGroundSchema),
  /**
   * The value the protest asks the board to set. Null where the facts give
   * no filed value to ask for — the model must not invent one.
   */
  valueRequested: z.number().nullable(),
  /** The 22.30 waiver request, where a rendition penalty was applied. */
  penaltyRequest: z.string().nullable(),
  /** What is still missing before a hearing — evidence to gather, questions open. */
  gaps: z.array(z.string()),
});

export type ProtestBrief = z.infer<typeof ProtestBriefSchema>;

/** A drafted brief as stored: the frozen facts, the draft, and its provenance. */
export const ProtestBriefRecordSchema = z.object({
  id: z.string(),
  noticeId: z.string(),
  engagementId: z.string(),
  facts: ProtestBriefFactsSchema,
  brief: ProtestBriefSchema,
  model: z.string().nullable(),
  createdAt: z.string(),
});

export type ProtestBriefRecord = z.infer<typeof ProtestBriefRecordSchema>;
