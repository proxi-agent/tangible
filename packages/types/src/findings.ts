import { z } from 'zod';
import { FindingEffectSchema, FindingEvidenceSchema, FindingKindSchema } from './savings.js';

/**
 * A committed finding set: what we told a client, on a date, and what we decided
 * to do about each line of it.
 *
 * The savings report and the register comparison are both derived on read, and
 * they stay that way. That is the right behaviour for a working view — settling
 * one more row in the classification queue should move the number immediately,
 * and a cached report that silently disagreed with the decisions under it would
 * be worse than no report. Nothing here replaces that.
 *
 * What derived-on-read cannot do is hold a decision. Three things need one:
 *
 *   - **A report handed to a prospect is a statement.** It went out on a date,
 *     with particular numbers, computed from a register as it stood that
 *     morning. Regenerating it next month produces a different document, and
 *     "what did we actually claim" stops being answerable — which matters most
 *     in exactly the case you would want it, when the district asks.
 *   - **A finding is a question to a client, and the answer has to live
 *     somewhere.** "Is this $96,000 of software separately stated on the
 *     invoice?" gets asked once. Re-deriving the report forgets that it was
 *     asked, forgets the answer, and asks again.
 *   - **Rejection is information.** A finding the client looked at and declined
 *     to pursue should not come back looking new next quarter, and the reason
 *     they declined is worth more than the finding was.
 *
 * So: committing is a deliberate act, distinct from viewing. It snapshots the
 * whole report and every finding in it, and it never happens as a side effect
 * of someone opening a page.
 *
 * **Dispositions outlive the sets they were made on.** This is the same shape as
 * the line-mapping work: the derived thing is disposable and the human decision
 * is not. A disposition is keyed on (engagement, source, finding key) rather
 * than on a finding row, so committing a fresh set after new assets land
 * replays every decision already made onto the findings that survived, and only
 * genuinely new findings arrive undecided.
 *
 * A disposition also records the figures it was decided against. Accepting a
 * $96,000 position is not consent to a $184,000 one, and a set that quietly
 * carried the old decision onto the new number would be putting words in the
 * client's mouth — so the carried decision arrives flagged instead.
 */

/** Which analysis produced a set. Also the namespace a disposition lives in. */
export const FINDING_SOURCES = [
  /** `analyzeSavings` over the classified register. */
  'savings',
  /** `compareRegister` over a mapped prior return. */
  'register-comparison',
] as const;

export const FindingSourceSchema = z.enum(FINDING_SOURCES);
export type FindingSource = (typeof FINDING_SOURCES)[number];

/**
 * What was decided about a finding. There is deliberately no `open` member:
 * undecided is the absence of a record, not a decision someone made, and
 * writing a row to say "nobody has looked at this yet" would make the two
 * indistinguishable a month later.
 */
export const FINDING_DISPOSITIONS = [
  /** We are taking this position. It belongs in the filing and in the fee. */
  'accepted',
  /** Looked at and dropped. The note is the part worth keeping. */
  'rejected',
  /** Asked; waiting on the client. The normal state of a screening finding. */
  'pending-client',
] as const;

export const FindingDispositionStatusSchema = z.enum(FINDING_DISPOSITIONS);
export type FindingDispositionStatus = (typeof FINDING_DISPOSITIONS)[number];

export const FindingDispositionSchema = z.object({
  status: FindingDispositionStatusSchema,
  note: z.string().nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().datetime(),
  /**
   * What the finding claimed when the decision was made. Kept so a decision
   * carried onto a later set can be checked against what it was made about,
   * rather than assumed to still apply.
   */
  decidedCost: z.number().nullable(),
  decidedValue: z.number().nullable(),
  /**
   * True when this decision was made against a different set and the numbers
   * have moved since. The decision still stands — it is the client's, not
   * ours to revoke — but it is shown as needing a second look.
   */
  isCarried: z.boolean(),
  hasMovedSinceDecision: z.boolean(),
});

export type FindingDisposition = z.infer<typeof FindingDispositionSchema>;

/**
 * One finding as committed. A near-copy of what the engine produced, kept as
 * rows rather than left inside the report blob because these are the things
 * that get decided about, listed, filtered and counted.
 */
export const StoredFindingSchema = z.object({
  id: z.string(),
  setId: z.string(),
  engagementId: z.string(),
  source: FindingSourceSchema,
  /** Stable across runs of the same analysis. What a disposition is keyed on. */
  key: z.string(),
  /** Position within the set, so a committed report reads back in its own order. */
  ordinal: z.number().int().nonnegative(),

  title: z.string(),
  kind: FindingKindSchema,
  effect: FindingEffectSchema,
  /** Original cost involved. Always a number, even where value is not. */
  cost: z.number(),
  /** Value effect on the district's tables. Null when nothing could price it. */
  value: z.number().nullable(),
  assetCount: z.number().int().nonnegative(),

  summary: z.string(),
  basis: z.string(),
  assumption: z.string().nullable(),

  /** Register rows behind the claim. */
  evidence: z.array(FindingEvidenceSchema),
  /** `ComparisonCell` snapshots — the return's side. Empty for savings findings. */
  cells: z.array(z.unknown()),

  disposition: FindingDispositionSchema.nullable(),
});

export type StoredFinding = z.infer<typeof StoredFindingSchema>;

/**
 * The headline the set is listed by. Each analysis answers a different question
 * — a savings report ends in an annual number, a comparison ends in the gap
 * between two positions — so the label travels with the figure instead of a
 * column called `total` meaning two things.
 */
export const FindingSetHeadlineSchema = z.object({
  label: z.string(),
  value: z.number().nullable(),
  caveat: z.string().nullable(),
});

export type FindingSetHeadline = z.infer<typeof FindingSetHeadlineSchema>;

export const FindingSetSummarySchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  source: FindingSourceSchema,
  /** The return a comparison was run against. Null for a savings set. */
  priorDocumentId: z.string().nullable(),
  taxYear: z.number().int(),
  label: z.string().nullable(),
  committedBy: z.string().nullable(),
  committedAt: z.string().datetime(),

  findingCount: z.number().int().nonnegative(),
  savingCount: z.number().int().nonnegative(),
  exposureCount: z.number().int().nonnegative(),
  decidedCount: z.number().int().nonnegative(),
  totalCost: z.number(),
  totalValue: z.number().nullable(),
  headline: FindingSetHeadlineSchema,

  /**
   * True when the register, the classifications or the return's mapping have
   * moved since this was committed. Not an error and not a reason to hide the
   * set — a statement made in March is still what was said in March — but a
   * reader deciding whether to send it needs to know it is behind.
   */
  isStale: z.boolean(),
});

export type FindingSetSummary = z.infer<typeof FindingSetSummarySchema>;

export const FindingSetSchema = FindingSetSummarySchema.extend({
  findings: z.array(StoredFindingSchema),
  /**
   * The whole report exactly as the engine produced it — `SavingsReport` or
   * `RegisterComparison`. The findings are the part that gets worked; this is
   * the part that makes the document reproducible, including the coverage
   * caveats and the schedule year, which are what a total means nothing
   * without.
   */
  report: z.unknown(),
});

export type FindingSet = z.infer<typeof FindingSetSchema>;

export const CommitFindingsRequestSchema = z.object({
  source: FindingSourceSchema,
  /** Required for a comparison, rejected for a savings set. */
  priorDocumentId: z.string().uuid().nullable().optional(),
  /** A name for this run — "sent to Dana, 14 March". Optional and free text. */
  label: z.string().trim().max(200).nullable().optional(),
});

export type CommitFindingsRequest = z.infer<typeof CommitFindingsRequestSchema>;

export const UpdateFindingDispositionRequestSchema = z.object({
  /** Null clears the decision back to undecided, which deletes the record. */
  status: FindingDispositionStatusSchema.nullable(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export type UpdateFindingDispositionRequest = z.infer<typeof UpdateFindingDispositionRequestSchema>;

/**
 * What a decision returns. The set travels with the row because the header's
 * decided count moves on every one of these, and re-fetching the whole set to
 * learn that one number went up by one is a round trip for nothing.
 */
export const FindingDecisionResultSchema = z.object({
  finding: StoredFindingSchema,
  set: FindingSetSummarySchema,
});

export type FindingDecisionResult = z.infer<typeof FindingDecisionResultSchema>;

/* ── Decisions at the row ──────────────────────────────────────────────────── */

/**
 * What was decided about one asset under one finding.
 *
 * The category disposition above answers "are we taking this position at all".
 * This answers the question a controller actually has, which is narrower and
 * more useful: *these eleven of your forty disposed assets are genuinely gone,
 * these three were sold in March and belong on the return, and I do not
 * recognise the rest.* A category-level accept cannot say that, and a report
 * that cannot say it is one the client has to re-do in a spreadsheet.
 *
 * Stored append-only. `decidedAt` is the newest record's; a reversal writes a
 * second record rather than editing this one, and `revisions` says how many
 * times the row has been turned over — which is worth seeing, because a row
 * that has been accepted, rejected and accepted again is a row somebody is
 * unsure about.
 */
export const FindingRowDecisionSchema = z.object({
  status: FindingDispositionStatusSchema,
  note: z.string().nullable(),
  decidedBy: z.string().nullable(),
  /** 'firm' | 'client'. The reviewer filter, and the first thing a firm asks. */
  decidedByAudience: z.string().nullable(),
  decidedAt: z.string().datetime(),
  /** What the row claimed at the moment of the decision. */
  decidedValue: z.number().nullable(),
  decidedTaxAtRisk: z.number().nullable(),
  /** How many decisions this row has had, this one included. */
  revisions: z.number().int().positive(),
  /**
   * True when the row's value has moved since it was decided. The decision
   * stands — it was the client's to make — but accepting $12,000 is not consent
   * to the $40,000 the same row claims after a new register lands.
   */
  hasMovedSinceDecision: z.boolean(),
});

export type FindingRowDecision = z.infer<typeof FindingRowDecisionSchema>;

/**
 * One decision, or several at once.
 *
 * Bulk because that is how the work is actually done: a reviewer filters to
 * high-confidence disposals over $10,000 and accepts the twenty rows in front
 * of them in one gesture. Sending twenty requests to do that would make the
 * page slower than the spreadsheet it replaces, and would let the batch land
 * half-applied.
 *
 * A null status clears the rows back to undecided — which, being append-only,
 * is itself a record rather than a deletion.
 */
export const DecideFindingRowsRequestSchema = z.object({
  findingKey: z.string(),
  source: FindingSourceSchema.default('savings'),
  assetIds: z.array(z.string().uuid()).min(1).max(1000),
  status: FindingDispositionStatusSchema.nullable(),
  note: z.string().trim().max(2000).nullable().optional(),
});

export type DecideFindingRowsRequest = z.infer<typeof DecideFindingRowsRequestSchema>;

/* ── Reviewing rows ────────────────────────────────────────────────────────── */

/**
 * The nine filters, as one object.
 *
 * They are applied on the server, not in the browser, for a reason that is not
 * performance: an uncapped population is the whole point of per-asset rows, and
 * a register of any size means the filtered view has to be computed where the
 * rows are. The client sends what it wants and gets back a page plus the totals
 * *for the whole filtered set*, so the number at the top of the screen always
 * describes the rows the filter selected rather than the ones that fit on it.
 *
 * Every list filter is "any of", and an empty list means no constraint — never
 * "match nothing", which would make a freshly-loaded page show an empty table.
 */
export const FindingRowFiltersSchema = z.object({
  confidence: z.array(z.enum(['high', 'medium', 'low'])).default([]),
  /** Site ids. The literal 'unplaced' selects rows with no site. */
  locations: z.array(z.string()).default([]),
  costCenters: z.array(z.string()).default([]),
  /** Classification keys — the asset class filter. */
  categories: z.array(z.string()).default([]),
  acquiredFrom: z.number().int().nullable().default(null),
  acquiredTo: z.number().int().nullable().default(null),
  costMin: z.number().nullable().default(null),
  costMax: z.number().nullable().default(null),
  /** 'any' | 'present' | 'absent' — whether the row can be tied to a document. */
  evidence: z.enum(['any', 'present', 'absent']).default('any'),
  /** Disposition, with 'undecided' for the rows nobody has answered. */
  dispositions: z
    .array(z.enum(['accepted', 'rejected', 'pending-client', 'undecided']))
    .default([]),
  /** Who decided. Free text, matched exactly against `decidedBy`. */
  reviewers: z.array(z.string()).default([]),
  /** Kept from the old page: description, tag, or year. */
  query: z.string().default(''),
});

export type FindingRowFilters = z.infer<typeof FindingRowFiltersSchema>;

/** A row with whatever has been decided about it. */
export const ReviewableRowSchema = z.object({
  row: z.unknown(),
  decision: FindingRowDecisionSchema.nullable(),
});

export type ReviewableRow = {
  row: import('./savings.js').FindingRow;
  decision: FindingRowDecision | null;
};

/**
 * What the filter bar offers, drawn from the rows themselves.
 *
 * Facets come from the finding's whole population rather than from the current
 * filter, so the options do not disappear as you narrow — a controller who
 * filters to Houston and then wants Dallas should not have to clear the filter
 * to find out Dallas exists.
 */
export interface FindingRowFacets {
  locations: { id: string; label: string; count: number }[];
  costCenters: { value: string; count: number }[];
  categories: { key: string; label: string; count: number }[];
  reviewers: { value: string; count: number }[];
  acquired: { min: number; max: number } | null;
  cost: { min: number; max: number } | null;
  confidence: { high: number; medium: number; low: number };
  dispositions: { accepted: number; rejected: number; 'pending-client': number; undecided: number };
}

export interface FindingRowTotals {
  rows: number;
  originalCost: number;
  /** Null-safe sums: a row that could not be priced contributes nothing. */
  valueRemoved: number;
  taxAtRisk: number;
  /** Rows the filter matched that carry no price at all. */
  unpricedRows: number;
}

/** One page of rows, with everything the screen around them needs. */
export interface FindingRowPage {
  engagementId: string;
  findingKey: string;
  title: string;
  kind: 'measured' | 'modeled' | 'screening';
  summary: string;
  basis: string;
  assumption: string | null;
  question: string | null;
  /** The published run these rows came from, and when it was published. */
  runId: string | null;
  publishedAt: string | null;
  blendedTaxRate: number;
  /**
   * Where that rate came from, carried through so the client's own screen can
   * say it. The rate is half of every tax figure on the page and is, for now,
   * usually a county-wide stand-in rather than this account's units — an
   * approximation that runs *above* the true rate for most accounts, and so
   * cannot be printed without a label.
   */
  rateSource: import('./savings.js').SavingsReport['rateSource'];
  jurisdictionName: string | null;
  detection: import('./savings.js').DetectionBasis[];
  confidenceMix: { high: number; medium: number; low: number };
  facets: FindingRowFacets;
  /**
   * The filter as the server read it, echoed back.
   *
   * Anything unparseable in the query string is dropped rather than rejected,
   * so the client's idea of the filter and the server's can differ by one
   * silently discarded parameter. Returning what was actually applied lets the
   * screen — and the workbook, which prints it — describe the list it is
   * showing rather than the list it asked for.
   */
  appliedFilters: FindingRowFilters;
  /** The finding's whole population, however the filter is set. */
  population: FindingRowTotals;
  /** What the current filter selected — the numbers printed above the table. */
  filtered: FindingRowTotals;
  rows: ReviewableRow[];
  offset: number;
  limit: number;
}
