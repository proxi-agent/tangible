/**
 * The error shape the handlers throw, on its own so that anything can throw it.
 *
 * It lived in `route.ts` until the request scope needed the viewer: `handle()`
 * has to know whether it is serving a client before it runs the body, which
 * means `route.ts` importing `viewer.ts`, which has always imported `HttpError`.
 * A two-module cycle in an ESM graph does not always fail — it fails on
 * whichever module happens to be evaluated second, which is the worst kind of
 * bug to leave lying in the request path. Splitting the leaf out ends it.
 *
 * `@/lib/route` still re-exports both, so nothing else had to move.
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
