import { z } from 'zod';

/* ── The operational floor ───────────────────────────────────────────────────
 *
 * What the firm needs to know about its own software, as opposed to about a
 * client's property. Two questions and nothing else:
 *
 *   - Is it running? — answered by a probe that writes down every sweep, so
 *     that silence becomes evidence instead of ambiguity.
 *   - What is broken? — answered by faults grouped into incidents, each one
 *     open until somebody says why it is closed.
 *
 * The shapes are deliberately small. An operations screen that grows into a
 * metrics product is a screen nobody reads during a filing season, and the only
 * job here is that a crash in a client's upload reaches the firm before the
 * client does.
 */

/** Which part of the system was working when it failed. */
export const INCIDENT_SURFACES = ['api', 'run', 'cron', 'probe'] as const;
export const IncidentSurfaceSchema = z.enum(INCIDENT_SURFACES);
export type IncidentSurface = (typeof INCIDENT_SURFACES)[number];

/** One dependency, asked whether it answers. */
export const HealthCheckSchema = z.object({
  /** 'database' | 'warehouse' | 'mail' | 'runs'. */
  name: z.string(),
  ok: z.boolean(),
  /** How long the check took. Slow is the shape most outages arrive in. */
  ms: z.number().int().nonnegative(),
  /** What it said — the row count it read, or the error it threw. */
  detail: z.string().nullable(),
});

export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export const HealthReportSchema = z.object({
  ok: z.boolean(),
  checkedAt: z.string(),
  ms: z.number().int().nonnegative(),
  checks: z.array(HealthCheckSchema),
});

export type HealthReport = z.infer<typeof HealthReportSchema>;

/**
 * A fault, as the operations screen shows it.
 *
 * `occurrences` is the count since this incident opened, not since the fault
 * was first written — a resolved incident that recurs is a new row, and the
 * count starting over is what says "this came back" rather than "this never
 * stopped".
 */
export const IncidentSchema = z.object({
  id: z.string(),
  surface: IncidentSurfaceSchema,
  label: z.string(),
  message: z.string(),
  detail: z.string().nullable(),
  occurrences: z.number().int().positive(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  /** When the firm was mailed. Null means nobody was told. */
  alertedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  resolvedBy: z.string().nullable(),
  resolution: z.string().nullable(),
  /** Whose work was interrupted, where the request knew. */
  client: z.object({ id: z.string(), name: z.string() }).nullable(),
  engagement: z.object({ id: z.string(), taxYear: z.number().int() }).nullable(),
  /** True when this fingerprint has been resolved before and returned. */
  recurred: z.boolean(),
});

export type Incident = z.infer<typeof IncidentSchema>;

/**
 * What the probes add up to.
 *
 * `silentForMinutes` is the one that matters and the one that is easy to miss:
 * it is not "the system is down", it is "nothing has checked", which during a
 * season is the same size of problem and reads as calm.
 */
export const ProbeSummarySchema = z.object({
  last: HealthReportSchema.nullable(),
  /** Minutes since the last sweep of any kind. Null when there has never been one. */
  silentForMinutes: z.number().nullable(),
  /** Sweeps in the last 24 hours, and how many of them passed. */
  windowCount: z.number().int().nonnegative(),
  windowOkCount: z.number().int().nonnegative(),
  /** The last sweep that passed, for "it was fine until". */
  lastOkAt: z.string().nullable(),
});

export type ProbeSummary = z.infer<typeof ProbeSummarySchema>;

/**
 * Whether an alert would actually reach anybody.
 *
 * On the screen because an alerting system nobody configured is worse than
 * none: it is the same silence, believed to be coverage.
 */
export const AlertingStatusSchema = z.object({
  mailConfigured: z.boolean(),
  recipients: z.array(z.string()),
  cronConfigured: z.boolean(),
  /** Alerts sent in the last hour, against the cap that stops a storm. */
  sentLastHour: z.number().int().nonnegative(),
  alertCap: z.number().int().positive(),
});

export type AlertingStatus = z.infer<typeof AlertingStatusSchema>;

export const OperationsViewSchema = z.object({
  open: z.array(IncidentSchema),
  /** Closed within the last fortnight, so a recurrence has context beside it. */
  resolved: z.array(IncidentSchema),
  probe: ProbeSummarySchema,
  alerting: AlertingStatusSchema,
});

export type OperationsView = z.infer<typeof OperationsViewSchema>;

export const ResolveIncidentSchema = z.object({
  /** Why it is closed. Required: a fault closed with no reason is a fault hidden. */
  resolution: z.string().trim().min(1).max(500),
});

export type ResolveIncidentInput = z.infer<typeof ResolveIncidentSchema>;
