import type { FilingBlocker, UnblockFacts } from '@tangible/types';

/**
 * Assemble what an unblock plan may argue from — deterministically.
 *
 * The board already computed the blockers and the operative deadline per
 * return; this narrows that view to exactly what the drafter needs and
 * nothing it must not have. Pure, so the selection rules are testable
 * without a season on file.
 */

/** The slice of a season-board row this assembly reads. */
export interface UnblockSource {
  label: string;
  accountId: string | null;
  status: 'filed' | 'ready' | 'blocked';
  dueOn: string;
  daysToDue: number;
  blockers: FilingBlocker[];
}

/** Why a plan cannot be drafted, or null when it can. */
export function unblockBlocker(returns: readonly UnblockSource[]): string | null {
  if (!returns.some((entry) => entry.status === 'blocked')) {
    return 'Nothing is blocked — every return owed is ready or filed.';
  }
  return null;
}

export function assembleUnblockFacts(
  clientName: string,
  taxYear: number,
  returns: readonly UnblockSource[],
): UnblockFacts {
  return {
    clientName,
    taxYear,
    // Blocked returns only — a ready return has no work to plan, and handing
    // its row to the drafter invites steps for problems nobody has. Tightest
    // deadline first, because that is the order the plan should read in.
    returns: returns
      .filter((entry) => entry.status === 'blocked')
      .sort((a, b) => a.daysToDue - b.daysToDue)
      .map((entry) => ({
        label: entry.label,
        accountId: entry.accountId,
        dueOn: entry.dueOn,
        daysToDue: entry.daysToDue,
        // Blocking only. Warnings are worth reading before signing, but a
        // plan that mixes "cannot file" with "worth a look" buries the work
        // that releases the return under the work that does not.
        blockers: entry.blockers
          .filter((blocker) => blocker.severity === 'blocking')
          .map((blocker) => ({
            key: blocker.key,
            message: blocker.message,
            resolution: blocker.resolution,
          })),
      })),
  };
}
