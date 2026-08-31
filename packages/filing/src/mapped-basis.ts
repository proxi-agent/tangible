import { isComparable, isMixed, lineMappingLabel } from '@tangible/classification';
import type { ClassificationStatus, RenditionScheduleKey } from '@tangible/types';

/**
 * What the client actually reported, expressed in our categories.
 *
 * The output of extraction is the form's grain — schedule, the filer's wording,
 * year acquired. The output of mapping is our grain — category, year — and this
 * is the crossing. It is the basis every comparison against the register starts
 * from, which makes one property matter more than anything else here:
 *
 * **It reconciles.** `placedTotal + unplacedTotal` is always the whole reported
 * total, and every dollar that could not be placed says why it could not. A
 * rollup that silently dropped the lines it could not read would produce a
 * "they under-reported by $400,000" finding out of nothing but our own gaps, and
 * that finding would look exactly like a real one.
 */

export interface MappableLine {
  schedule: RenditionScheduleKey | (string & {});
  type: string;
  yearAcquired: number | null;
  historicalCost: number | null;
  goodFaithEstimate: number | null;
  categoryKey: string | null;
  mappingStatus: ClassificationStatus | (string & {}) | null;
}

/** Cost when the filer used cost, estimate when they used the estimate. Never both. */
function lineValue(line: MappableLine): number | null {
  return line.historicalCost ?? line.goodFaithEstimate ?? null;
}

export interface PlacedBucket {
  categoryKey: string;
  yearAcquired: number | null;
  reported: number;
  lineCount: number;
  /** The filer's own wordings that landed here, so a bucket can be argued with. */
  wordings: string[];
}

/** Why a dollar of reported cost is not comparable, in the filer's own words. */
export const UNPLACED_REASONS = [
  /** The wording blends categories the form printed as one number. */
  'blended',
  /** Queued for a reviewer — nothing is measured off an unsettled reading. */
  'needs-review',
  /** No reading at all: blank wording, or the model declined. */
  'unmapped',
  /** Correctly reported, but not the client's own property to compare. */
  'excluded',
] as const;

export type UnplacedReason = (typeof UNPLACED_REASONS)[number];

export interface UnplacedBucket {
  reason: UnplacedReason;
  categoryKey: string | null;
  label: string;
  reported: number;
  lineCount: number;
  wordings: string[];
}

export interface MappedBasis {
  placed: PlacedBucket[];
  unplaced: UnplacedBucket[];
  placedTotal: number;
  unplacedTotal: number;
  /** Every dollar read off the form, placed or not. Ties back to the footing check. */
  reportedTotal: number;
}

const EXCLUDED_PREFIX = 'excluded-';

function reasonFor(line: MappableLine): UnplacedReason {
  if (line.mappingStatus === 'needs-review') return 'needs-review';
  if (isMixed(line.categoryKey)) return 'blended';
  if (line.categoryKey === null) return 'unmapped';
  return 'excluded';
}

const UNPLACED_LABELS: Record<UnplacedReason, string> = {
  blended: 'Blended wording — the form printed it as one number',
  'needs-review': 'Waiting on a reviewer',
  unmapped: 'No reading — nothing to compare against',
  excluded: 'Not the client’s own property',
};

/**
 * Roll mapped lines to (category, year), keeping what would not go.
 *
 * Excluded categories are deliberately *not* placed. A Schedule F line is real
 * reported cost and belongs in the reconciled total, but the lessor owns it —
 * comparing it against the client's register would manufacture a discrepancy the
 * size of every copier they rent.
 */
export function rollupMapped(lines: readonly MappableLine[]): MappedBasis {
  const placed = new Map<string, PlacedBucket>();
  const unplaced = new Map<string, UnplacedBucket>();
  let placedTotal = 0;
  let unplacedTotal = 0;

  for (const line of lines) {
    const value = lineValue(line);
    if (value === null) continue;
    const wording = line.type.trim();

    const comparable =
      isComparable({
        categoryKey: line.categoryKey,
        status: (line.mappingStatus ?? 'needs-review') as ClassificationStatus,
      }) && !line.categoryKey?.startsWith(EXCLUDED_PREFIX);

    if (comparable) {
      const key = `${line.categoryKey}|${line.yearAcquired ?? '~'}`;
      const bucket = placed.get(key);
      if (bucket) {
        bucket.reported += value;
        bucket.lineCount += 1;
        if (wording && !bucket.wordings.includes(wording)) bucket.wordings.push(wording);
      } else {
        placed.set(key, {
          categoryKey: line.categoryKey!,
          yearAcquired: line.yearAcquired,
          reported: value,
          lineCount: 1,
          wordings: wording ? [wording] : [],
        });
      }
      placedTotal += value;
      continue;
    }

    const reason = reasonFor(line);
    const key = `${reason}|${line.categoryKey ?? '~'}`;
    const bucket = unplaced.get(key);
    if (bucket) {
      bucket.reported += value;
      bucket.lineCount += 1;
      if (wording && !bucket.wordings.includes(wording)) bucket.wordings.push(wording);
    } else {
      unplaced.set(key, {
        reason,
        categoryKey: line.categoryKey,
        label:
          reason === 'excluded' && line.categoryKey
            ? lineMappingLabel(line.categoryKey)
            : UNPLACED_LABELS[reason],
        reported: value,
        lineCount: 1,
        wordings: wording ? [wording] : [],
      });
    }
    unplacedTotal += value;
  }

  const byYearThenCategory = (a: PlacedBucket, b: PlacedBucket) =>
    (b.yearAcquired ?? 0) - (a.yearAcquired ?? 0) || a.categoryKey.localeCompare(b.categoryKey);

  return {
    placed: [...placed.values()].sort(byYearThenCategory),
    unplaced: [...unplaced.values()].sort((a, b) => b.reported - a.reported),
    placedTotal,
    unplacedTotal,
    reportedTotal: placedTotal + unplacedTotal,
  };
}
