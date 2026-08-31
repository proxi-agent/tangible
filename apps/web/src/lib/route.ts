import 'server-only';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { AccountQuerySchema, type AccountQuery } from '@tangible/types';
import { HttpError } from '@/lib/http';
import { withClientScope } from '@/lib/db-scope';
import { currentViewer } from '@/lib/viewer';

/**
 * Shared plumbing for the API route handlers.
 *
 * These endpoints are the same contract the NestJS app served; what changed is
 * only where they run. Validation is still the Zod schemas from
 * `@tangible/types`, so the browser and the server cannot drift.
 */

export { HttpError, notFound } from '@/lib/http';

/**
 * Run a handler and turn the failures a caller can cause into the right status.
 *
 * A bad query string is the caller's mistake: without this, a `.parse()` failure
 * escapes as a generic 500 and which field was wrong never reaches the client.
 *
 * It is also where tenancy stops being something each handler remembers. When
 * the viewer is a client, the body runs inside `withClientScope`, on a database
 * role that cannot reach another client's rows whatever the handler does with
 * the ids it was given. The `require*Scope` checks stay exactly as they were and
 * still do the useful work of turning a wrong id into a clean 404 — this is the
 * floor underneath them, not a replacement.
 *
 * Resolving the viewer here is free: it is memoized for the request and every
 * client-reachable route already calls one of the `require*` helpers, so the
 * lookup was happening anyway. For a firm request nothing happens at all.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    const viewer = await currentViewer();
    const clientId = viewer?.audience === 'client' ? viewer.clientId : null;
    return NextResponse.json(clientId ? await withClientScope(clientId, fn) : await fn());
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

    /**
     * A path parameter that is not a UUID is a wrong address, not a fault.
     *
     * Every id in this app is a uuid column, so `/clients/not-a-uuid` reaches
     * Postgres and comes back as 22P02 `invalid input syntax for type uuid`.
     * Untranslated that is a 500 carrying a database error message — the app
     * reporting itself broken, and leaking its schema, because someone edited
     * the address bar or followed a stale link. It is the same answer as an id
     * that is well-formed and simply gone.
     */
    if (isBadUuid(error)) {
      return NextResponse.json(
        { statusCode: 404, message: 'No record with that id.' },
        { status: 404 },
      );
    }

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

    /**
     * Anything reaching here is a fault rather than a caller error, and its
     * message was written for whoever reads the logs — a connection string, a
     * constraint name, a stack-shaped sentence from a driver. Deployed, that
     * goes to the log and the caller gets the fact that it failed; locally the
     * message is the whole point, so it still comes through.
     */
    console.error('[api]', error);
    return NextResponse.json(
      {
        statusCode: 500,
        message: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : message,
      },
      { status: 500 },
    );
  }
}

/**
 * Postgres 22P02 is `invalid_text_representation` — the class of error a
 * malformed uuid, enum or number produces when it is compared against a typed
 * column. postgres.js surfaces the SQLSTATE on the error object.
 */
function isBadUuid(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === '22P02' && /uuid/i.test(error instanceof Error ? error.message : '');
}

/**
 * What a failed form download should say.
 *
 * The three PDF routes each caught everything and answered 409, on the reading
 * that a form failing to build is the form refusing to print something
 * misleading. That is true of the fillers' own refusals — a tax year outside
 * the pinned revision's ladder, an appointment naming more sites than Step 2
 * has rows — and false of everything else that can throw on the way there.
 *
 * Two cases were being mislabelled. An `HttpError` already carries the right
 * status, so a request for an appointment that does not exist was answering
 * 409 instead of 404. And a blank Comptroller form missing from the deployment
 * throws `ENOENT`, which as a 409 reads as though the form had examined the
 * data and objected to it — sending whoever debugs it to look at the client's
 * numbers instead of at the build. That one is a 500, because it is.
 *
 * The envelope is `message`, not `error`: that is what the client's
 * `errorMessage` reads, and these routes were the only ones returning the
 * other shape — so their sentences reached the user as raw JSON.
 */
export function formFailure(error: unknown): Response {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { statusCode: error.status, message: error.message },
      { status: error.status },
    );
  }

  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOENT' || code === 'EACCES') {
    console.error('[form] the blank Comptroller form could not be read', error);
    return NextResponse.json(
      {
        statusCode: 500,
        message:
          'The blank Comptroller form is not available in this deployment, so the filled ' +
          'version cannot be produced. Nothing is wrong with the return itself.',
      },
      { status: 500 },
    );
  }

  const message = error instanceof Error ? error.message : 'Could not build the form.';
  return NextResponse.json({ statusCode: 409, message }, { status: 409 });
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
