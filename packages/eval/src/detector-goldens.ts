import type { GoldenOutcome } from '@tangible/types';
import { analyzeSavings, type SavingsInput } from '@tangible/savings';
import { scheduleFor } from '@tangible/valuation';

/**
 * A small register, and the findings that must and must not come off it.
 *
 * This is the gate the phase is really about. Six new detectors landed in phase
 * 3, and a false positive in front of a tax director costs the engagement — so
 * each one needs a case that says "this asset is a finding, that one is not,
 * and here is why", fixed in the repo before its threshold gets tuned.
 *
 * `mustNotFlag` is doing at least as much work as `mustFlag`, and it is the
 * half a hand-written test suite always skips. Loosening a threshold makes the
 * flagged cases pass more easily; the only thing standing between that and a
 * report full of noise is a named asset that a reviewer decided is fine.
 *
 * Recall is meaningful here and nowhere else in this harness: the fixture
 * declares the full expected set by hand, so a detector that stops firing shows
 * up as a missed case rather than as silence.
 */

export interface ExpectedRow {
  assetId: string;
  findingKey: string;
  /** Why a person says this is or is not a finding. Printed on failure. */
  reason: string;
  /**
   * A floor on the row's confidence, where the case is about the score rather
   * than the flag. Screening findings deliberately sit low, so most cases leave
   * this unset — asserting a number that is meant to be judgement would freeze
   * the judgement.
   */
  minConfidence?: number;
  maxConfidence?: number;
}

export interface DetectorGolden {
  id: string;
  description: string;
  /** Everything `analyzeSavings` needs except the schedule, which is resolved. */
  input: Omit<SavingsInput, 'schedule'>;
  mustFlag: ExpectedRow[];
  mustNotFlag: ExpectedRow[];
}

export interface DetectorGoldenResult {
  outcome: GoldenOutcome;
  /** Of the rows that had to be found, how many were. */
  recall: { expected: number; found: number };
  /** Of the rows that had to stay quiet, how many did. */
  quiet: { expected: number; held: number };
}

export function runDetectorGolden(golden: DetectorGolden): DetectorGoldenResult {
  const jurisdictionId = golden.input.jurisdictionId;
  const schedule = jurisdictionId ? (scheduleFor(jurisdictionId, golden.input.taxYear) ?? null) : null;
  const report = analyzeSavings({ ...golden.input, schedule });

  const flagged = new Map<string, { confidence: number }>();
  for (const finding of report.findings) {
    for (const row of finding.rows) {
      flagged.set(`${finding.key}::${row.assetId}`, { confidence: row.confidence.score });
    }
  }

  const problems: string[] = [];
  let found = 0;
  for (const expected of golden.mustFlag) {
    const hit = flagged.get(`${expected.findingKey}::${expected.assetId}`);
    if (!hit) {
      problems.push(`${expected.findingKey} missed ${expected.assetId} — ${expected.reason}`);
      continue;
    }
    found += 1;
    if (expected.minConfidence !== undefined && hit.confidence < expected.minConfidence) {
      problems.push(
        `${expected.findingKey} on ${expected.assetId} scored ${hit.confidence}, below the ${expected.minConfidence} this case requires`,
      );
    }
    if (expected.maxConfidence !== undefined && hit.confidence > expected.maxConfidence) {
      problems.push(
        `${expected.findingKey} on ${expected.assetId} scored ${hit.confidence}, above the ${expected.maxConfidence} this case allows — a screening lead is being sold as a position`,
      );
    }
  }

  let held = 0;
  for (const forbidden of golden.mustNotFlag) {
    if (flagged.has(`${forbidden.findingKey}::${forbidden.assetId}`)) {
      problems.push(
        `${forbidden.findingKey} fired on ${forbidden.assetId}, which is a false positive — ${forbidden.reason}`,
      );
    } else {
      held += 1;
    }
  }

  return {
    outcome: {
      id: golden.id,
      kind: 'detector',
      jurisdictionId,
      taxYear: golden.input.taxYear,
      passed: problems.length === 0,
      detail:
        problems.length === 0
          ? `${golden.description}: ${golden.mustFlag.length} found, ${golden.mustNotFlag.length} correctly left alone.`
          : `${golden.description} — ${problems.join('; ')}.`,
    },
    recall: { expected: golden.mustFlag.length, found },
    quiet: { expected: golden.mustNotFlag.length, held },
  };
}

export function runDetectorGoldens(goldens: readonly DetectorGolden[]): DetectorGoldenResult[] {
  return goldens.map(runDetectorGolden);
}

/** Which detectors any golden actually exercises. The gate names the rest. */
export function detectorsCovered(goldens: readonly DetectorGolden[]): Set<string> {
  const keys = new Set<string>();
  for (const golden of goldens) {
    for (const row of golden.mustFlag) keys.add(row.findingKey);
    for (const row of golden.mustNotFlag) keys.add(row.findingKey);
  }
  return keys;
}
