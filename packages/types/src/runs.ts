import { z } from 'zod';

/**
 * An analysis run: the job that turns a register into a report, and the record
 * that the report was ever published.
 *
 * Until now the savings report was derived on read. That was the right shape
 * for a firm-side screen — settle one more row in the review queue and the
 * number moves immediately — and it is the wrong shape the moment a business
 * outside the firm is looking at it. Three things the doc asks for are the same
 * missing piece seen from three angles: a customer who is emailed when their
 * report is ready, a number that can be quoted back to us eighteen months
 * later, and an analysis that does not have to finish inside an HTTP request.
 * All three need the run to be a row.
 *
 * The run does not replace the derived report. The firm keeps reading the live
 * one; the client reads the last published run. That is deliberate — a report
 * that changes under the reader between two visits is fine for the preparer who
 * caused the change and indefensible for the taxpayer who did not.
 */

export const RUN_STATUSES = [
  /** Accepted, not yet picked up. */
  'queued',
  /** A worker holds it. See `step` for where it is. */
  'running',
  /** Finished, and visible to the client. `publishedAt` and `setId` are set. */
  'published',
  /** Finished badly. `error` says how, in words the firm can act on. */
  'failed',
] as const;
export const RunStatusSchema = z.enum(RUN_STATUSES);
export type RunStatus = (typeof RUN_STATUSES)[number];

/**
 * Where a running job has got to.
 *
 * These are the customer's words, not the pipeline's. "Reading your register"
 * is what loading the asset graph looks like from the other side, and a
 * progress line that says `classify` teaches a business nothing except that we
 * did not think about them. The order here is the order they happen in, and the
 * portal renders it as a sequence with the current one lit.
 *
 * Three steps, not five, because three is how many boundaries the work actually
 * has today: the inputs are read, they are valued and examined in one pass, and
 * the result is written. Valuation and detection are deliberately the same walk
 * in `analyzeSavings` — the leakage rollup is accumulated alongside the findings
 * so the two can never disagree — so splitting them here would be a progress
 * bar describing a pipeline that does not exist. When ingest and classification
 * move into the run, `reading` is where they land and this list grows.
 */
export const RUN_STEPS = ['reading', 'valuing', 'publishing'] as const;
export const RunStepSchema = z.enum(RUN_STEPS);
export type RunStep = (typeof RUN_STEPS)[number];

export const RUN_STEP_LABEL: Record<RunStep, string> = {
  reading: 'Reading your register',
  valuing: 'Valuing it on the district’s schedules',
  publishing: 'Preparing your report',
};

/** Why the run exists. Decides whether finishing it sends an email. */
export const RUN_TRIGGERS = [
  /** A client sent files and the drop kicked this off. They are expecting mail. */
  'upload',
  /** A preparer asked for it from the workspace. */
  'manual',
  /** The inputs moved under a published report and it was refreshed. */
  'refresh',
] as const;
export const RunTriggerSchema = z.enum(RUN_TRIGGERS);
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/**
 * What the run was computed *with*, frozen onto the row.
 *
 * The input fingerprint says the client's data has not moved. These say our
 * side has not moved either — and they are the half that a fingerprint over the
 * register can never catch. A detector whose threshold changed, or a district
 * that published a new depreciation guide, produces a different report from
 * identical inputs, and without these the difference is unexplainable.
 */
export const RunBasisSchema = z.object({
  /**
   * Which release of the detectors ran. Hand-bumped in @tangible/savings when
   * a detector's behaviour changes — an automatic hash of the source would move
   * on a comment and teach people to ignore it.
   */
  rulesVersion: z.string(),
  /**
   * The depreciation schedule actually applied, as jurisdiction and year. Not
   * the engagement's year: a district that has not published the current guide
   * falls back to its most recent one, and the report is only reproducible if
   * it records which one it really used.
   */
  scheduleVersion: z.string().nullable(),
});

export type RunBasis = z.infer<typeof RunBasisSchema>;

export const AnalysisRunSchema = z.object({
  id: z.string(),
  engagementId: z.string(),
  taxYear: z.number().int(),
  status: RunStatusSchema,
  trigger: RunTriggerSchema,
  /** Null unless the status is `running`. */
  step: RunStepSchema.nullable(),

  /**
   * The finding set this run committed. Null until it publishes — and null
   * forever on a run that failed, which is why the report is read through the
   * set rather than stored on the run.
   */
  setId: z.string().nullable(),

  /** Null until the worker has read the inputs. See RunBasisSchema. */
  inputFingerprint: z.string().nullable(),
  rulesVersion: z.string().nullable(),
  scheduleVersion: z.string().nullable(),

  /** Null on a run nobody but the system asked for. */
  requestedBy: z.string().nullable(),
  requestedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  failedAt: z.string().datetime().nullable(),
  /** Written for the firm, never shown to the client. */
  error: z.string().nullable(),
  /** How many times a worker has picked this up. Bounded; see the runner. */
  attempts: z.number().int().nonnegative(),
});

export type AnalysisRun = z.infer<typeof AnalysisRunSchema>;

/**
 * What the client wing shows about a run in flight.
 *
 * A separate, thinner shape on purpose: `error` and `attempts` are the firm's
 * business, and a taxpayer reading "attempt 3 of 3" learns only that something
 * is wrong in a way they cannot act on.
 */
export const RunProgressSchema = z.object({
  runId: z.string(),
  status: RunStatusSchema,
  step: RunStepSchema.nullable(),
  requestedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
});

export type RunProgress = z.infer<typeof RunProgressSchema>;

export const RequestRunSchema = z.object({
  trigger: RunTriggerSchema.default('manual'),
});

export type RequestRunRequest = z.infer<typeof RequestRunSchema>;
