import type {
  FindingQueue,
  FindingRow,
  FindingRowDecision,
  QueueItem,
  SavingsReport,
} from '@tangible/types';

/**
 * The Top 25, and why a report needs one.
 *
 * A twelve-category report on a four-thousand-line register produces something
 * nobody works: eleven headings, each with hundreds of rows, each ranked
 * against its own siblings and against nothing else. The reader's first
 * question is not "how many ghost assets are there" — it is "what should I
 * spend this afternoon on", and the category list cannot answer it, because the
 * biggest row in the smallest category outranks most of the biggest one.
 *
 * So the queue is a single ordering across every finding, on expected recovery,
 * which is the one quantity that is comparable between a certain small thing
 * and an uncertain large one. Twenty-five at a time because that is a sitting;
 * the next twenty-five is offered when the first is done rather than paged
 * through, so finishing means something.
 */
export const QUEUE_SIZE = 25;

/**
 * No single finding type may take more than this share of one page.
 *
 * The reason is not fairness between detectors. It is that a register with
 * eight hundred disposed assets would fill every page of the queue with
 * disposals for the first thirty pages, and the client would never see the four
 * situs errors worth more than any of them. Diversity here is a hedge against
 * the ranking being wrong — which, with acceptance rates that are still
 * judgement rather than measurement, it partly is.
 *
 * Rows held back by the cap are not dropped. They are named, with their counts,
 * so a reader can see the queue chose an order rather than a subset.
 */
const MAX_SHARE = 0.4;

export interface QueueDecision {
  findingKey: string;
  assetId: string;
  status: FindingRowDecision['status'];
}

/**
 * Rank every row on the report, take a page, keep it mixed.
 *
 * A pure function of the published report and the decisions recorded against
 * it, rather than a stored field, for two reasons: a report published before
 * the queue existed still gets one, and the cap and the ordering stay testable
 * without standing up a database.
 */
export function topQueue(
  report: SavingsReport,
  options: { offset?: number; size?: number; decided?: readonly QueueDecision[] } = {},
): FindingQueue {
  const size = Math.max(1, options.size ?? QUEUE_SIZE);
  const offset = Math.max(0, options.offset ?? 0);
  const settled = new Set((options.decided ?? []).map((d) => `${d.findingKey}:${d.assetId}`));

  const byKey = new Map(report.findings.map((f) => [f.key, f]));
  const all: { row: FindingRow; recovery: number }[] = [];
  for (const finding of report.findings) {
    for (const row of finding.rows ?? []) {
      // A row worth nothing is not a piece of work. The kept copy of a
      // duplicate group is the clearest case: it is printed under its finding
      // because the group is unreadable without it, and it asks nothing.
      const recovery = row.expectedRecovery ?? 0;
      if (recovery <= 0) continue;
      all.push({ row, recovery });
    }
  }

  const remaining = all.filter(({ row }) => !settled.has(row.rowKey));
  const decided = all.length - remaining.length;
  remaining.sort(
    (a, b) => b.recovery - a.recovery || (b.row.valueRemoved ?? 0) - (a.row.valueRemoved ?? 0),
  );

  /**
   * The cap is applied over the whole ranked list rather than per page, so that
   * paging forward does not keep re-offering the same over-represented type it
   * just held back. What comes out is one long diversified ordering, and a page
   * is a window on it.
   */
  const cap = Math.max(1, Math.floor(size * MAX_SHARE));
  const ordered: typeof remaining = [];
  const heldOver: typeof remaining = [];
  const held = new Map<string, number>();
  let page: Map<string, number> = new Map();
  for (const entry of remaining) {
    if (ordered.length > 0 && ordered.length % size === 0) page = new Map();
    const key = entry.row.findingKey;
    const taken = page.get(key) ?? 0;
    if (taken >= cap) {
      heldOver.push(entry);
      held.set(key, (held.get(key) ?? 0) + 1);
      continue;
    }
    page.set(key, taken + 1);
    ordered.push(entry);
  }
  // Everything the cap deferred goes to the back rather than out of the queue:
  // a client who works the whole list still reaches every row.
  ordered.push(...heldOver);

  const items: QueueItem[] = ordered.slice(offset, offset + size).map((entry, index) => {
    const finding = byKey.get(entry.row.findingKey)!;
    return {
      rank: offset + index + 1,
      row: entry.row,
      findingTitle: finding.title,
      findingKind: finding.kind,
      findingQuestion: finding.question,
      basis: finding.basis,
    };
  });

  return {
    engagementId: report.engagementId,
    runId: null,
    publishedAt: null,
    items,
    offset,
    size,
    eligible: ordered.length,
    remainingRecovery: ordered.reduce((sum, entry) => sum + entry.recovery, 0),
    hasMore: offset + size < ordered.length,
    heldBack: [...held.entries()]
      .map(([findingKey, count]) => ({
        findingKey,
        findingTitle: byKey.get(findingKey)?.title ?? findingKey,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    decided,
    rateBasis: report.rateBasis,
    jurisdictionName: report.jurisdictionName,
  };
}
