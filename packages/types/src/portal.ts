import { z } from 'zod';

/**
 * Who a signed-in person is, and therefore what they may see.
 *
 * The app has two audiences and one login. The firm works every client; a
 * business works only itself. Until now that distinction did not exist — one
 * allowlist admitted the firm, and the client wing asked the reader to pick a
 * business out of a dropdown. This is the type that replaces the dropdown.
 *
 * The two roles are not a hierarchy with the firm at the top. A firm viewer is
 * not a super-user of the portal, and a client admin is not a junior preparer:
 * they are different products that happen to share a deployment, and the gate
 * treats them as different products.
 */

export const VIEWER_AUDIENCES = ['firm', 'client'] as const;
export const ViewerAudienceSchema = z.enum(VIEWER_AUDIENCES);
export type ViewerAudience = (typeof VIEWER_AUDIENCES)[number];

/**
 * What a client-side person may do, inside their own business.
 *
 * Deliberately two values and not a permission matrix. The only acts the portal
 * offers are reading the report, sending files, and answering a question — and
 * the meaningful split is between someone who may speak for the business and
 * someone who may only read what was said. A controller forwarding a report to
 * their CFO should be able to do so without handing over the ability to answer
 * a question that becomes a tax position.
 */
export const PORTAL_ROLES = [
  /** Reads the report, sends registers, answers the questions we ask. */
  'admin',
  /** Reads the report. Cannot upload, cannot answer. */
  'viewer',
] as const;
export const PortalRoleSchema = z.enum(PORTAL_ROLES);
export type PortalRole = (typeof PORTAL_ROLES)[number];

/**
 * The resolved identity behind a request, after the gate has admitted it.
 *
 * A firm viewer carries no `clientId` — not null-as-unknown, but null meaning
 * "every client", which is why the scope helpers branch on `audience` rather
 * than on whether the id is present. A client viewer always carries one; a
 * client row that resolved to no business is a misconfiguration and is refused
 * at the gate rather than defaulting to something.
 */
export const ViewerSchema = z.object({
  email: z.string(),
  audience: ViewerAudienceSchema,
  /** The business this person speaks for. Null for the firm. */
  clientId: z.string().nullable(),
  clientName: z.string().nullable(),
  /** Null for the firm, which has no portal role. */
  role: PortalRoleSchema.nullable(),
});

export type Viewer = z.infer<typeof ViewerSchema>;

/** One person granted access to one business's portal. */
export const PortalUserSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  clientName: z.string().nullable(),
  email: z.string(),
  role: PortalRoleSchema,
  /**
   * Null until the person has actually signed in. An access grant is written
   * against an email address before any account exists, so this is the record
   * that somebody claimed it — and which auth identity did.
   */
  claimedAt: z.string().datetime().nullable(),
  invitedBy: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export type PortalUser = z.infer<typeof PortalUserSchema>;

export const GrantPortalAccessSchema = z.object({
  email: z.string().trim().min(1, 'An email address is required.').email(),
  role: PortalRoleSchema.default('admin'),
});

export type GrantPortalAccessRequest = z.infer<typeof GrantPortalAccessSchema>;

export const UpdatePortalAccessSchema = z.object({ role: PortalRoleSchema });
export type UpdatePortalAccessRequest = z.infer<typeof UpdatePortalAccessSchema>;

/**
 * The client's own settings for their portal.
 *
 * One setting today, and it is the one the product doc asks for: the confidence
 * floor beneath which finding rows are not shown by default. It belongs to the
 * client rather than to a browser because it is a statement about how they want
 * to work — a controller who only wants to see positions their auditor would
 * not blink at should not have to re-say that on their phone, and a colleague
 * opening the same report should see the same report.
 *
 * A floor narrows a *view*. It never changes a total: the report still says
 * what the whole population is, and the filter bar still says what it is
 * hiding. A setting that quietly showed a smaller number than the truth would
 * be a worse product than no setting.
 */
export const PortalSettingsSchema = z.object({
  clientId: z.string(),
  confidenceFloor: z.enum(['high', 'medium', 'low']),
  updatedBy: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

export type PortalSettings = z.infer<typeof PortalSettingsSchema>;

export const UpdatePortalSettingsSchema = z.object({
  confidenceFloor: z.enum(['high', 'medium', 'low']),
});

export type UpdatePortalSettingsRequest = z.infer<typeof UpdatePortalSettingsSchema>;

/**
 * Where one of a business's returns stands, told to the business.
 *
 * The client wing's twin of {@link SeasonReturn}, and deliberately not that type
 * narrowed. The firm's board answers "can this go out today", which is a
 * question about our own record: it carries blockers, warning counts, drift
 * against the draft, and a readiness verdict. None of that is a fact about the
 * taxpayer's position — it is our working state, and a business reading
 * "blocked: no Form 50-162 on file with this district" learns only that
 * something they have never heard of is wrong somewhere.
 *
 * So this type is built from a different set of facts: dates the statute fixes,
 * documents that actually went somewhere, and answers that actually came back.
 * Every field here is something the taxpayer could confirm from their own post
 * or by ringing the district, which is the test for whether it belongs.
 */
export const ClientReturnSchema = z.object({
  locationId: z.string(),
  label: z.string(),
  /** The district's own number for this account, which is how they file it. */
  accountId: z.string().nullable(),
  districtName: z.string().nullable(),

  /**
   * The date this return is working to, and how long is left.
   *
   * Per return, because an extension under 22.23(b) is per account: one site's
   * request buys that site until May 15 and says nothing about the one next
   * door. `statutoryDueOn` travels beside it so a May date is legible as a
   * moved April one rather than as the deadline this always had.
   */
  dueOn: z.string(),
  statutoryDueOn: z.string(),
  daysToDue: z.number().int(),
  /**
   * The extension moving that date, where one is in force.
   *
   * Only the three facts a taxpayer's own position turns on — that it was
   * asked for, what it bought, and whether it stands. The request's `reason`
   * and the district's `answerNote` stay on the firm's side: the first is our
   * words, and the second is correspondence we should hand over deliberately
   * rather than publish on a status page.
   */
  extension: z
    .object({ requestedOn: z.string(), extendedTo: z.string(), answeredOn: z.string().nullable() })
    .nullable(),

  /**
   * The return that went out, where one has. Null reads exactly as it says: not
   * filed yet. It is never a claim that anything is wrong, and never a promise
   * that nothing is.
   */
  filed: z
    .object({
      filedOn: z.string(),
      method: z.string(),
      /** Certified article number or e-file receipt — what proves it went. */
      confirmation: z.string().nullable(),
      /** What was sworn to: the cost reported and the property it covered. */
      totalHistoricalCost: z.number(),
      assetCount: z.number().int().nonnegative(),
      /** Whether we signed it as their agent under Form 50-162. */
      filedByAgent: z.boolean(),
    })
    .nullable(),

  /**
   * What the district came back with, where it has.
   *
   * The 22.28 penalty is here because it is money on the taxpayer's own bill,
   * and `waiverDeadline` with it: 22.30(b) gives thirty days from the notice to
   * ask for it back, with no May 15 floor under it, so it is routinely the
   * first clock in the season to close and the one nobody is watching.
   */
  notice: z
    .object({
      noticedOn: z.string(),
      appraisedValue: z.number().nullable(),
      priorYearValue: z.number().nullable(),
      renditionPenaltyApplied: z.boolean().nullable(),
      protestDeadline: z.string(),
      waiverDeadline: z.string().nullable(),
      /** Whether there is still time to protest. False once one is filed. */
      protestOpen: z.boolean(),
      protestFiledOn: z.string().nullable(),
    })
    .nullable(),

  /**
   * How it ended, where it has ended.
   *
   * `noticedValue` is carried rather than read back off the notice so the two
   * figures on screen are the pair that was frozen together. What is withheld
   * is the resolution's `checks` — our own second-look list about an ending we
   * agreed to, which is a firm judgment and not a fact about the account.
   */
  resolution: z
    .object({
      stage: z.string(),
      resolvedOn: z.string(),
      noticedValue: z.number().nullable(),
      finalValue: z.number().nullable(),
      penaltyOutcome: z.string().nullable(),
    })
    .nullable(),
});

export type ClientReturn = z.infer<typeof ClientReturnSchema>;

/**
 * Every return a business owes for one year, and where each one stands.
 *
 * The third of the four questions the client wing exists to answer — did you
 * get my files, what do you still need from me, is my return going out on time,
 * what did it save me — and the last of them to get a page. Until it existed a
 * business could read what we thought their property was worth and could not
 * find out whether anything had been filed for them.
 *
 * Nothing on it is computed from a draft. The firm's board builds a rendition
 * per site to decide readiness; this one reports frozen filings, recorded
 * notices and statutory dates, so the figures a business reads here are the
 * figures on documents that exist. A return not yet filed carries no value at
 * all rather than a preview of one — what a draft would say today is a working
 * number, and printing it beside a real filed one would put two different kinds
 * of claim in the same column.
 */
export const ClientFilingStatementSchema = z.object({
  engagementId: z.string(),
  taxYear: z.number().int(),
  /** The statutory calendar for the year, before anybody asks for anything. */
  statutoryDueOn: z.string(),
  extendedDueOn: z.string(),

  returns: z.array(ClientReturnSchema),

  /**
   * Property on the register that is not yet on any return, because its
   * location is unresolved.
   *
   * Reported rather than left off. A page listing returns that total less than
   * the register, with nothing to say about the difference, understates by
   * omission — and where this is non-zero the missing fact is one only the
   * business has, so it will already be a question on their Questions page.
   */
  unplacedCount: z.number().int().nonnegative(),
  unplacedCost: z.number(),
});

export type ClientFilingStatement = z.infer<typeof ClientFilingStatementSchema>;

/**
 * How far along a business is, and therefore how much of the portal exists.
 *
 * The client wing has always drawn all six of its pages at once, which is right
 * for a business mid-season and wrong for the one that signed in an hour after
 * we opened their file. That reader is shown a report with nothing in it, a
 * ranked queue with nothing to rank, a return with no dates and a results page
 * whose whole content is that nothing has come back — five dead ends around the
 * one thing they can actually do, which is send us their books. The five are not
 * broken; each says honestly that it is empty. But a product whose first
 * impression is five honest emptinesses reads as a product that lost something.
 *
 * So the wing opens at the width of the record. This is that measurement, and it
 * is deliberately counts rather than a verdict: the same numbers decide which
 * nav items exist and can be read on screen, and a boolean that turned out wrong
 * would be undebuggable from the outside.
 *
 * **It is not an access control.** Every page it hides is a page the reader may
 * still address directly, and every one of them is scoped by
 * `requireEngagementScope` exactly as before. Hiding a link narrows a menu; the
 * gate that decides what a business may read is the proxy allowlist and the
 * handlers, and neither is consulted here.
 */
export const PORTAL_STAGES = [
  /** Nothing has arrived. The only thing that can happen is a drop. */
  'documents',
  /** Files are in and being read; no report has been published yet. */
  'processing',
  /** A report exists, so the rest of the wing has something to be about. */
  'ready',
] as const;
export const PortalStageNameSchema = z.enum(PORTAL_STAGES);
export type PortalStageName = (typeof PORTAL_STAGES)[number];

export const PortalStageSchema = z.object({
  engagementId: z.string(),
  stage: PortalStageNameSchema,
  /** Files the business has sent for this season, whatever became of them. */
  documentsReceived: z.number().int().nonnegative(),
  /** Property actually read out of them. Zero with files present means a drop nobody could parse. */
  assetsRead: z.number().int().nonnegative(),
  /** A run has been published — the report page has a report to show. */
  reportPublished: z.boolean(),
  /** A run is queued or running, which is what the progress card is for. */
  runInFlight: z.boolean(),
  /**
   * Questions waiting on this business. Gates the Questions page on its own,
   * at any stage: a mapping ask can be the very first thing that happens to a
   * drop, and it is exactly the thing a client must be shown early.
   */
  openQuestions: z.number().int().nonnegative(),
  /** Sites with property on them, which is what a return is per. */
  returnsOwed: z.number().int().nonnegative(),
  /** Positions claimed with a district. Until one exists nothing can have come back. */
  claimsMade: z.number().int().nonnegative(),
});

export type PortalStage = z.infer<typeof PortalStageSchema>;

/**
 * The stage of a business with no season open at all.
 *
 * Not an error and not a loading state: a client can be granted access before
 * the firm opens their year, and the honest answer for them is the same as for
 * a season with nothing in it — there is one thing to do, and it is to send us
 * something.
 */
export function emptyPortalStage(engagementId: string): PortalStage {
  return {
    engagementId,
    stage: 'documents',
    documentsReceived: 0,
    assetsRead: 0,
    reportPublished: false,
    runInFlight: false,
    openQuestions: 0,
    returnsOwed: 0,
    claimsMade: 0,
  };
}
