import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AccountQuerySchema, type AccountQuery } from '@tangible/types';

/**
 * Shared plumbing for the API route handlers.
 *
 * These endpoints are the same contract the NestJS app served; what changed is
 * only where they run. Validation is still the Zod schemas from
 * `@tangible/types`, so the browser and the server cannot drift.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFound(message: string): never {
  throw new HttpError(404, message);
}

/**
 * Run a handler and turn the failures a caller can cause into the right status.
 *
 * A bad query string is the caller's mistake: without this, a `.parse()` failure
 * escapes as a generic 500 and which field was wrong never reaches the client.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    return NextResponse.json(await fn());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        {
          statusCode: 400,
          error: 'Bad Request',
          message: 'Validation failed',
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    if (error instanceof HttpError) {
      return NextResponse.json(
        { statusCode: error.status, message: error.message },
        { status: error.status },
      );
    }

    const message = error instanceof Error ? error.message : String(error);

    if (isLockConflict(message)) {
      return NextResponse.json(
        {
          statusCode: 503,
          message:
            'An ingest is writing to the warehouse. DuckDB allows one writer or many ' +
            'readers, not both — the dashboard reconnects on its own once the run finishes.',
        },
        { status: 503 },
      );
    }

    console.error('[api]', message);
    return NextResponse.json({ statusCode: 500, message }, { status: 500 });
  }
}

/**
 * A local ingest holds the write lock for the minutes it runs. That is a
 * temporary, self-resolving condition, not a server fault, and DuckDB's own
 * message names a PID rather than saying so.
 */
export function isLockConflict(message: string): boolean {
  return /Could not set lock|Conflicting lock/i.test(message);
}

/** Flatten a query string into the plain object the Zod schemas expect. */
export function params(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/** Query strings deliver repeated params inconsistently; normalize to an array. */
export function toArray(value: unknown): string[] {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map(String);
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function parseAccountQuery(raw: Record<string, unknown>): AccountQuery {
  return AccountQuerySchema.parse({
    ...raw,
    segments: toArray(raw.segments),
    cities: toArray(raw.cities),
    stateClasses: toArray(raw.stateClasses),
    // `z.coerce.boolean()` treats any non-empty string as true, so map explicitly.
    hasAgent: raw.hasAgent === undefined ? undefined : raw.hasAgent === 'true',
    includeExempt: raw.includeExempt === 'true',
  });
}
