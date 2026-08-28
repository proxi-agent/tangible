import type { GoldenBasis, GoldenOutcome } from '@tangible/types';
import { appraise, scheduleFor, type AppraisalInput } from '@tangible/valuation';

/**
 * One asset, and the value a district's own arithmetic produces for it.
 *
 * This is the guard against the incumbent failure mode: a depreciation table
 * goes stale or gets a digit wrong, every return filed that season is wrong in
 * the same direction, and nothing in the software notices because the
 * arithmetic still runs. Unit tests over `appraise` do not catch it — they test
 * the multiplication, and the multiplication is not what breaks. What breaks is
 * the numbers it multiplies.
 *
 * `basis` says which of two very different guarantees a case carries, and the
 * difference is worth keeping visible:
 *
 *   `published-schedule` — the expectation was computed from the table we
 *     committed. It proves the table has not changed since a human last looked
 *     at it. It cannot prove the table was ever right, because a transcription
 *     error is in both the code and the expectation.
 *
 *   `assessment-notice` — the expectation is a figure the district actually
 *     assessed, off a real notice. This is the only kind that proves our
 *     reading of the guide matches the district's own. Every jurisdiction
 *     should acquire some, and the gate says so when one has none.
 */
export interface ValuationGolden {
  id: string;
  jurisdictionId: string;
  taxYear: number;
  basis: GoldenBasis;
  /** What the asset is, in a sentence a preparer would recognise. */
  description: string;
  input: AppraisalInput;
  expected: {
    indexFactor: number;
    /** 0–100, as the district publishes it. */
    percentGood: number;
    marketValue: number;
    atFloor: boolean;
  };
  /** Where the expectation came from — the guide page, or the notice. */
  citation: string;
}

/**
 * A dollar. Market values are rounded to whole dollars by the caller and the
 * schedules carry three decimal places, so anything inside a dollar is float
 * noise and anything outside it is a table that moved.
 */
const VALUE_TOLERANCE = 1;
/** Index factors and percent good are published exactly. These must match. */
const FACTOR_TOLERANCE = 1e-9;

export function runValuationGolden(golden: ValuationGolden): GoldenOutcome {
  const base = {
    id: golden.id,
    kind: 'valuation' as const,
    jurisdictionId: golden.jurisdictionId,
    taxYear: golden.taxYear,
  };

  const schedule = scheduleFor(golden.jurisdictionId, golden.taxYear);
  if (!schedule) {
    return {
      ...base,
      passed: false,
      detail: `No schedule published for ${golden.jurisdictionId} — the golden cannot run at all.`,
    };
  }
  if (schedule.taxYear !== golden.taxYear) {
    // `scheduleFor` falls back to the newest published year, which is right at
    // runtime and wrong here: a golden that silently graded itself against a
    // different year's tables would go green through exactly the drift it
    // exists to catch.
    return {
      ...base,
      passed: false,
      detail: `Asked for ${golden.taxYear} and got the ${schedule.taxYear} schedule. The ${golden.taxYear} tables have not been loaded.`,
    };
  }

  const result = appraise(golden.input, schedule);
  if (!result.ok) {
    return { ...base, passed: false, detail: `Could not value it: ${result.gap.detail}` };
  }

  const { indexFactor, percentGood, marketValue, atFloor } = result.value;
  const problems: string[] = [];
  if (Math.abs(indexFactor - golden.expected.indexFactor) > FACTOR_TOLERANCE) {
    problems.push(`index factor ${indexFactor}, expected ${golden.expected.indexFactor}`);
  }
  if (Math.abs(percentGood - golden.expected.percentGood) > FACTOR_TOLERANCE) {
    problems.push(`percent good ${percentGood}, expected ${golden.expected.percentGood}`);
  }
  if (Math.abs(marketValue - golden.expected.marketValue) > VALUE_TOLERANCE) {
    problems.push(
      `value $${Math.round(marketValue).toLocaleString('en-US')}, expected $${golden.expected.marketValue.toLocaleString('en-US')}`,
    );
  }
  if (atFloor !== golden.expected.atFloor) {
    problems.push(atFloor ? 'hit the schedule floor and should not have' : 'did not hit the floor and should have');
  }

  return {
    ...base,
    passed: problems.length === 0,
    detail:
      problems.length === 0
        ? `${golden.description}: ${golden.expected.marketValue.toLocaleString('en-US')} as expected.`
        : `${golden.description} — ${problems.join('; ')}.`,
  };
}

export function runValuationGoldens(goldens: readonly ValuationGolden[]): GoldenOutcome[] {
  return goldens.map(runValuationGolden);
}

/** Jurisdiction-years with goldens, and whether any of them came off a notice. */
export function valuationCoverage(
  goldens: readonly ValuationGolden[],
): { jurisdictionId: string; taxYear: number; cases: number; noticeBacked: number }[] {
  const byKey = new Map<string, { jurisdictionId: string; taxYear: number; cases: number; noticeBacked: number }>();
  for (const golden of goldens) {
    const key = `${golden.jurisdictionId}:${golden.taxYear}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = { jurisdictionId: golden.jurisdictionId, taxYear: golden.taxYear, cases: 0, noticeBacked: 0 };
      byKey.set(key, entry);
    }
    entry.cases += 1;
    if (golden.basis === 'assessment-notice') entry.noticeBacked += 1;
  }
  return [...byKey.values()].sort(
    (a, b) => a.jurisdictionId.localeCompare(b.jurisdictionId) || b.taxYear - a.taxYear,
  );
}
