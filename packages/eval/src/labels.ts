import type { DetectionSignal, EvalLabel, EvalVerdict } from '@tangible/types';

/**
 * Turning review decisions into labels.
 *
 * Nothing here reaches a database. The harness takes rows in the shape
 * `finding_row_decisions` already stores and produces labels, because the
 * evaluation has to be runnable in three places that do not share a data
 * layer: a vitest run with no network, a CLI over an exported file, and the
 * firm's own dashboard reading live rows. One pure function serves all three.
 *
 * The interesting decision is which review outcomes count as evidence.
 * `accepted` and `rejected` are a reviewer's answer about whether the finding
 * was right, and both are labels. Everything else is not a verdict at all:
 *
 *   - `pending-client` means the row was forwarded, which is work rather than
 *     an opinion — many of the largest true findings sit here for weeks;
 *   - `deferred` means someone declined to decide today.
 *
 * Counting either as incorrect would punish the detectors for finding things
 * that take time to settle, and counting them as correct would flatter them.
 * They are carried through as `abstain` and reported separately, so a finding
 * whose rows are mostly parked shows up as thin evidence rather than as good or
 * bad precision.
 */

/** The disposition statuses the review queue writes. */
export type DecisionStatus = string;

export function verdictFor(status: DecisionStatus): EvalVerdict {
  if (status === 'accepted') return 'correct';
  if (status === 'rejected') return 'incorrect';
  return 'abstain';
}

/** One row as the decisions table stores it, with the run's context alongside. */
export interface DecisionRecord {
  rowKey: string;
  findingKey: string;
  assetId: string;
  engagementId: string;
  jurisdictionId: string | null;
  taxYear: number | null;
  status: DecisionStatus;
  decidedAt: string;
  decidedBy: string | null;
  decidedByAudience: 'firm' | 'client';
  confidenceScore: number | null;
  confidenceTier: 'high' | 'medium' | 'low' | null;
  signals: DetectionSignal[];
  decidedValue: number | null;
  decidedTaxAtRisk: number | null;
  rulesVersion: string | null;
}

export function labelFrom(record: DecisionRecord): EvalLabel {
  return {
    rowKey: record.rowKey,
    findingKey: record.findingKey,
    assetId: record.assetId,
    engagementId: record.engagementId,
    jurisdictionId: record.jurisdictionId,
    taxYear: record.taxYear,
    verdict: verdictFor(record.status),
    decidedAt: record.decidedAt,
    decidedBy: record.decidedBy,
    decidedByAudience: record.decidedByAudience,
    confidenceScore: record.confidenceScore,
    confidenceTier: record.confidenceTier,
    signals: record.signals,
    decidedValue: record.decidedValue,
    decidedTaxAtRisk: record.decidedTaxAtRisk,
    rulesVersion: record.rulesVersion,
  };
}

/**
 * The decisions table is append-only, so one row can carry a reviewer changing
 * their mind. The newest decision per row wins, and the earlier ones are
 * dropped rather than averaged: a reviewer who accepted a finding and then
 * rejected it has told us the finding was wrong, not that it was half right.
 *
 * Ties on the timestamp keep the later element, which is the order a
 * `created_at desc` query already delivers and the order an append-only table
 * grows in.
 */
export function newestPerRow(records: DecisionRecord[]): DecisionRecord[] {
  const byKey = new Map<string, DecisionRecord>();
  for (const record of records) {
    const key = `${record.engagementId}::${record.rowKey}`;
    const held = byKey.get(key);
    if (!held || record.decidedAt >= held.decidedAt) byKey.set(key, record);
  }
  return [...byKey.values()];
}

export function labelsFrom(records: DecisionRecord[]): EvalLabel[] {
  return newestPerRow(records).map(labelFrom);
}

/**
 * A client's own accept or reject is a real signal and a different one from the
 * firm's, and the harness keeps them apart rather than pooling them.
 *
 * A tax director rejecting a row is usually saying the position is wrong. A
 * client rejecting one is often saying they do not want to take it — the same
 * word for two different facts. Firm decisions are the default evidence, and
 * the split is exposed so the difference between the two populations can be
 * looked at rather than assumed away.
 */
export function firmLabels(labels: EvalLabel[]): EvalLabel[] {
  return labels.filter((label) => label.decidedByAudience === 'firm');
}
