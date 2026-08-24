import type { ClientStatus, RolloverClient, RolloverPlan } from '@tangible/types';

/**
 * Who rolls from one season into the next.
 *
 * Pure over what the caller read: every client with at least one engagement on
 * the season being left, with all of that client's engagements alongside so
 * the two questions this has to answer are answerable from its arguments —
 * which engagement to copy from, and whether next year is already open.
 *
 * The source is the *newest-created* engagement on the year. Two engagements
 * on one client and year is the duplicate trap the practice board already
 * warns about, and when it happens the newer one is the one somebody opened
 * on purpose with the settings they meant.
 *
 * An archived client stays behind but stays on the plan — a rollover that
 * silently dropped a client would read as a bug the first January someone
 * archived a client in December, and the row is the answer to "where did
 * they go".
 */

export interface RolloverEngagement {
  id: string;
  taxYear: number;
  jurisdictionId: string | null;
  sicCode: string | null;
  /** ISO timestamp, used only to pick the newest of a duplicated year. */
  createdAt: string;
}

export interface RolloverSource {
  clientId: string;
  clientName: string;
  clientStatus: ClientStatus;
  engagements: RolloverEngagement[];
}

export function planRollover(fromYear: number, sources: RolloverSource[]): RolloverPlan {
  const toYear = fromYear + 1;
  const clients: RolloverClient[] = sources
    .filter((source) => source.engagements.some((entry) => entry.taxYear === fromYear))
    .map((source) => {
      const from = source.engagements
        .filter((entry) => entry.taxYear === fromYear)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] as RolloverEngagement;
      const open = source.engagements.find((entry) => entry.taxYear === toYear) ?? null;
      const standing: RolloverClient['standing'] =
        open !== null ? 'already-open' : source.clientStatus === 'archived' ? 'archived' : 'ready';
      return {
        clientId: source.clientId,
        clientName: source.clientName,
        clientStatus: source.clientStatus,
        sourceEngagementId: from.id,
        jurisdictionId: from.jurisdictionId,
        sicCode: from.sicCode,
        standing,
        openEngagementId: open?.id ?? null,
      };
    })
    .sort((a, b) => a.clientName.localeCompare(b.clientName));

  return {
    fromYear,
    toYear,
    clients,
    readyCount: clients.filter((entry) => entry.standing === 'ready').length,
    alreadyOpenCount: clients.filter((entry) => entry.standing === 'already-open').length,
    archivedCount: clients.filter((entry) => entry.standing === 'archived').length,
  };
}
