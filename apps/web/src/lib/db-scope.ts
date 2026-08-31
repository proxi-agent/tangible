import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';
import { getClientDb, type Database } from '@tangible/db';
import { HttpError } from '@/lib/http';

/**
 * The database connection a request is entitled to, carried with the request.
 *
 * `require*Scope` in `viewer.ts` already checks that a client's request is
 * addressing its own data, and it does that carefully. What it cannot do is
 * guarantee it was called. Every client-reachable handler has to remember, and
 * so does every one written next year, and the failure mode of forgetting is
 * not an exception — it is another business's rows rendered into a page.
 *
 * So underneath it there is now a second answer, and this is how a request
 * reaches it: `handle()` wraps a client's request in `withClientScope`, which
 * opens a transaction on a role that does not bypass row-level security, names
 * the client in a setting the policies read, and puts that transaction where
 * `requireDb()` will find it. Every query the handler runs — through any of the
 * forty-odd lib functions, none of which had to change — runs inside it.
 *
 * The firm's own requests never enter a scope, and nothing about them changes.
 * They are supposed to read across clients.
 *
 * ## What this costs
 *
 * A client request holds one transaction open for its whole duration, which
 * holds back the transaction horizon and so delays vacuum a little. At the
 * scale this runs at — a handful of businesses, requests measured in hundreds
 * of milliseconds — that is not a real cost, and the alternative (setting the
 * value at session level and resetting it on the way out) leaves a connection
 * silently scoped to the wrong client if a handler throws between the two.
 * A transaction cannot leak that way: it either commits or it does not exist.
 */

const scope = new AsyncLocalStorage<Database>();

/**
 * Run `fn` against a connection that can only see `clientId`'s rows.
 *
 * `set_config(..., true)` is the transaction-local form, which is the whole
 * point — the setting cannot outlive the transaction and reach the next request
 * to borrow this pooled connection. It is set through a bind parameter rather
 * than interpolated, because `SET LOCAL` takes no parameters and the version
 * that does is worth using.
 */
export async function withClientScope<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
  let db: Database;
  try {
    db = getClientDb();
  } catch (error) {
    /**
     * Refusing is the only safe answer. The connection this would otherwise
     * fall back to is the one that bypasses every policy, so a missing variable
     * in production would turn the boundary off and leave the app looking
     * perfectly healthy.
     */
    throw new HttpError(
      503,
      error instanceof Error && error.message.includes('CLIENT_DATABASE_URL')
        ? 'The portal is not configured to enforce tenancy on this deployment, so it will not serve client data. CLIENT_DATABASE_URL is missing.'
        : 'The portal cannot reach the database.',
    );
  }

  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.client_id', ${clientId}, true)`);
    return scope.run(tx, fn);
  });
}

/** The scoped transaction, if this code is running inside one. */
export function currentScope(): Database | undefined {
  return scope.getStore();
}

/**
 * Run `fn` outside any client scope, on the firm's own connection.
 *
 * For the work that outlives the response: `after()` callbacks and the
 * detached notification sends. Two reasons, and either alone would be enough.
 * The transaction they inherit has already committed by the time they run, so
 * a query on it fails. And what they do is not the client's action — the
 * analysis engine writing four thousand valued assets, the notifier addressing
 * a row to the firm — it is the firm's machinery acting on the client's
 * request, and it runs with the firm's reach, exactly as the same work does
 * when the cron reaper picks it up instead.
 */
export function unscoped<T>(fn: () => T): T {
  return scope.exit(fn);
}
