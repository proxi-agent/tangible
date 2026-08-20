import type { FindingDisposition, FindingDispositionStatus } from '@tangible/types';

/**
 * Replaying a decision onto a finding that has been recomputed.
 *
 * A disposition is keyed on the finding's key, not on the row it was made
 * against, so it survives re-analysis. That is the whole point of storing it —
 * and it is also where a stored decision could start lying, because "the client
 * accepted this" was said about a specific claim of a specific size. The
 * decision is theirs and stands until they change it; what this adds is that a
 * carried decision arrives labelled with whether the thing it was made about is
 * still the thing in front of you.
 */

/** A stored decision, as it comes off the row. */
export interface DispositionRecord {
  status: FindingDispositionStatus;
  note: string | null;
  decidedBy: string | null;
  decidedAt: Date | string;
  decidedCost: number | null;
  decidedValue: number | null;
  decidedSetId: string | null;
}

export function resolveDisposition(
  finding: { setId: string; cost: number; value: number | null },
  record: DispositionRecord | undefined | null,
): FindingDisposition | null {
  if (!record) return null;
  return {
    status: record.status,
    note: record.note,
    decidedBy: record.decidedBy,
    decidedAt:
      typeof record.decidedAt === 'string' ? record.decidedAt : record.decidedAt.toISOString(),
    decidedCost: record.decidedCost,
    decidedValue: record.decidedValue,
    // A decision made on a set that is not this one was carried here. Note that
    // `null` counts as carried: a decision whose originating set has since been
    // deleted certainly was not made on this one.
    isCarried: record.decidedSetId !== finding.setId,
    hasMovedSinceDecision:
      hasMoved(record.decidedCost, finding.cost) || hasMoved(record.decidedValue, finding.value),
  };
}

/**
 * Whether a figure has moved enough to be worth a second look.
 *
 * One percent, floored at a dollar. An exact-equality test would flag every
 * carried decision forever, because a register that gained a single row moves
 * almost every total by a few cents — and a flag that is always on is one
 * nobody reads. Crossing between "priced" and "not priced" is always a move,
 * in either direction: a finding that has just become measurable is a
 * different claim from one that could not be measured, even where the decision
 * about it might not change.
 */
export function hasMoved(before: number | null, after: number | null): boolean {
  if (before === null && after === null) return false;
  if (before === null || after === null) return true;
  return Math.abs(after - before) > Math.max(1, Math.abs(before) * 0.01);
}

/** Index stored decisions by the key they were made against. */
export function byKey<T extends { key: string }>(records: T[]): Map<string, T> {
  return new Map(records.map((record) => [record.key, record]));
}
