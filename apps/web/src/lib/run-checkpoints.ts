import 'server-only';
import { and, eq } from 'drizzle-orm';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The resume log for a run, and the rules about what may go in it.
 *
 * `executeRun` used to be all-or-nothing. An attempt that ran out of wall clock
 * left nothing behind, the reaper requeued it, and the next attempt re-read the
 * roll and re-matched every asset from scratch before hitting the same wall in
 * the same place. Three of those and the run was `failed` — so a register too
 * big to analyse in one invocation could not be analysed at all, and retrying
 * was pure cost. Each stage now writes its result the moment it has one, and
 * the next attempt skips whatever is already there.
 *
 * The whole thing turns on one question, asked per stage: **is recomputing this
 * more expensive than storing it, and does it survive JSON?** Both halves have
 * to be yes.
 *
 * What is stored, and why:
 *
 *   - `roll` — the district's own position on these accounts. A DuckDB scan
 *     over the parquet roll, which is the slowest single thing a run does and
 *     the one least affected by anything in Postgres. Small output.
 *   - `evidence` — every register line matched against every uploaded source
 *     export. Cost grows as assets × export rows, so this is the stage that
 *     actually gets worse as a client sends more.
 *   - `invoices`, `acceptance`, `prior` — moderate queries, tiny results. In
 *     mainly because they are free to include once the machinery exists.
 *   - `report` — the finished analysis. The most valuable row here by far: with
 *     it, a resumed attempt skips reading *and* valuing and goes straight to
 *     publishing.
 *   - `set` — the finding set id, written inside the set's own transaction
 *     rather than through this file. See `WriteFindingSet.checkpoint`.
 *
 * What is deliberately **not** stored:
 *
 *   - **The fitted detection model.** `DetectionModelFit.coefficients` is a
 *     `Map`, and `JSON.stringify` turns a Map into `{}` without complaining.
 *     A resumed run would score every detector against no coefficients at all
 *     and publish a confident, wrong report. Its own type says "not serialized
 *     — rebuilt from labels each time", and that is load-bearing. Refitting it
 *     costs one query.
 *   - **The asset rows.** The largest object in a run by an order of magnitude,
 *     and one indexed query to rebuild. Storing it would trade the cheapest
 *     stage for the biggest payload.
 *   - Everything else in `loadSavingsInputs` that is a single lookup or a pure
 *     function: the engagement, the sites, the schedule, the county-wide rate.
 *
 * The rule for adding one: if the value contains a `Map`, a `Set`, a `Date`, or
 * an `undefined` that means something different from absent, it does not go in
 * here until it is reshaped. Nothing validates that at runtime — a payload is
 * read back with a cast, exactly as `finding_sets.report` is — so the check
 * happens when the stage is added, which is what this comment is for.
 */
export type CheckpointStage =
  | 'roll'
  | 'evidence'
  | 'invoices'
  | 'acceptance'
  | 'signal-lifts'
  | 'prior'
  | 'report'
  | 'set';

/**
 * Every payload is wrapped in `{ v }` rather than stored bare.
 *
 * Three of these stages legitimately return `null` — no roll position, no prior
 * filing — and a bare `null` payload is two different facts written the same
 * way: the stage ran and found nothing, or it never ran. It is also the one
 * value whose trip through drizzle into a `not null` jsonb column is genuinely
 * ambiguous, since a driver mapping JS `null` to SQL NULL would fail the
 * constraint instead of storing the JSON scalar. An object sidesteps both: the
 * row's existence means the stage finished, and `v` says what it returned.
 */
interface Envelope<T> {
  v: T;
}

/**
 * Read a stage's result, or compute and record it.
 *
 * The signature is deliberately the shape of a memo function, because the
 * calling code should not have to be arranged around resumability. Passing no
 * checkpoint at all gives `passthrough` below, which is what every derived-on-
 * read caller of `loadSavingsInputs` uses — the screen path does not change.
 */
export interface StageStore {
  <T>(stage: CheckpointStage, compute: () => Promise<T>): Promise<T>;
}

/** No resume log: compute everything, record nothing. The screens' path. */
export const passthrough: StageStore = (_stage, compute) => compute();

/**
 * A store bound to one run and one fingerprint.
 *
 * A write records the fingerprint it was computed under, and a read only
 * accepts a row that still matches. Stale rows are left rather than deleted —
 * `discardCheckpoints` clears them in one statement when the runner notices the
 * fingerprint moved, and a stale row that is never read harms nothing.
 *
 * A failed write is swallowed for the same reason `advance` swallows: the work
 * is done and correct, and losing the ability to skip it next time is not worth
 * failing a run over. A failed *read* is not swallowed — silently recomputing
 * would turn a broken resume log into a run that mysteriously never finishes.
 */
export function checkpointsFor(runId: string, fingerprint: string): StageStore {
  return async <T>(stage: CheckpointStage, compute: () => Promise<T>): Promise<T> => {
    const db = requireDb();
    const [found] = await db
      .select({ payload: schema.runCheckpoints.payload })
      .from(schema.runCheckpoints)
      .where(
        and(
          eq(schema.runCheckpoints.runId, runId),
          eq(schema.runCheckpoints.stage, stage),
          eq(schema.runCheckpoints.fingerprint, fingerprint),
        ),
      );
    if (found) return (found.payload as Envelope<T>).v;

    const value = await compute();
    try {
      await db
        .insert(schema.runCheckpoints)
        .values({ runId, stage, fingerprint, payload: { v: value } })
        /**
         * Two workers on the same run is supposed to be impossible — the claim
         * is a conditional update — but "supposed to be" is not a constraint,
         * and the loser of that race writing the same stage twice should not
         * take a run down. Last write wins; both computed the same thing.
         */
        .onConflictDoUpdate({
          target: [schema.runCheckpoints.runId, schema.runCheckpoints.stage],
          set: { fingerprint, payload: { v: value }, createdAt: new Date() },
        });
    } catch (error) {
      console.error('[runs] could not record checkpoint', runId, stage, error);
    }
    return value;
  };
}

/** Everything this run has finished, for deciding what a resumed attempt skips. */
export async function completedStages(
  runId: string,
  fingerprint: string,
): Promise<Set<CheckpointStage>> {
  const db = requireDb();
  const rows = await db
    .select({ stage: schema.runCheckpoints.stage })
    .from(schema.runCheckpoints)
    .where(
      and(
        eq(schema.runCheckpoints.runId, runId),
        eq(schema.runCheckpoints.fingerprint, fingerprint),
      ),
    );
  return new Set(rows.map((row) => row.stage as CheckpointStage));
}

/** One stage's stored result, or null. For the two the runner reads directly. */
export async function readCheckpoint<T>(
  runId: string,
  stage: CheckpointStage,
  fingerprint: string,
): Promise<{ value: T } | null> {
  const db = requireDb();
  const [found] = await db
    .select({ payload: schema.runCheckpoints.payload })
    .from(schema.runCheckpoints)
    .where(
      and(
        eq(schema.runCheckpoints.runId, runId),
        eq(schema.runCheckpoints.stage, stage),
        eq(schema.runCheckpoints.fingerprint, fingerprint),
      ),
    );
  return found ? { value: (found.payload as Envelope<T>).v } : null;
}

/** Record a stage the runner drives itself, rather than through the store. */
export async function writeCheckpoint(
  runId: string,
  stage: CheckpointStage,
  fingerprint: string,
  payload: unknown,
): Promise<void> {
  try {
    const db = requireDb();
    await db
      .insert(schema.runCheckpoints)
      .values({ runId, stage, fingerprint, payload: { v: payload } })
      .onConflictDoUpdate({
        target: [schema.runCheckpoints.runId, schema.runCheckpoints.stage],
        set: { fingerprint, payload: { v: payload }, createdAt: new Date() },
      });
  } catch (error) {
    console.error('[runs] could not record checkpoint', runId, stage, error);
  }
}

/**
 * Throw the log away, because the ground moved.
 *
 * Called when the fingerprint the run recorded no longer matches the inputs.
 * Everything here was computed against data the client has since replaced, and
 * a report assembled half from each would be the worst kind of wrong: internally
 * plausible, and describing a register that never existed.
 */
export async function discardCheckpoints(runId: string): Promise<void> {
  const db = requireDb();
  await db.delete(schema.runCheckpoints).where(eq(schema.runCheckpoints.runId, runId));
}
