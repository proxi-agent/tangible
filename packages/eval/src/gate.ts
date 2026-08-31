import type { GateResult, GoldenOutcome, RuleStatus } from '@tangible/types';
import { DETECTOR_RULES, DETECTOR_RULE_KEYS, ruleFor } from '@tangible/savings';
import { RATE_TABLES, SCHEDULES, covers, staleReason } from '@tangible/valuation';
import {
  runValuationGoldens,
  valuationCoverage,
  type ValuationGolden,
} from './valuation-goldens.js';
import { detectorsCovered, runDetectorGoldens, type DetectorGolden } from './detector-goldens.js';
import { FL_2026_VALUATION_GOLDENS } from './goldens/fl-2026-valuation.js';
import { TX_BEXAR_2026_VALUATION_GOLDENS } from './goldens/tx-bexar-2026-valuation.js';
import { TX_COLLIN_2026_VALUATION_GOLDENS } from './goldens/tx-collin-2026-valuation.js';
import { TX_DALLAS_2026_VALUATION_GOLDENS } from './goldens/tx-dallas-2026-valuation.js';
import { TX_TARRANT_2026_VALUATION_GOLDENS } from './goldens/tx-tarrant-2026-valuation.js';
import { TX_HARRIS_2026_VALUATION_GOLDENS } from './goldens/tx-harris-2026-valuation.js';
import { DETECTOR_GOLDENS } from './goldens/detectors.js';
import {
  ACKNOWLEDGED_FAILURES,
  UNAPPROVED_ALLOWED,
  type AcknowledgedFailure,
} from './goldens/baseline.js';

/**
 * The one thing that has to be true before a rule change reaches a customer.
 *
 * It runs the goldens, and then it asks the questions a reviewer would have to
 * remember to ask: is every rule in the repository still in effect, does every
 * one of them name who approved it, does each detector have a case that pins
 * its behaviour, and does each jurisdiction we value property in have a golden
 * taken from a real assessment notice rather than from our own reading of the
 * published table.
 *
 * The last two are warnings rather than failures, and the distinction is
 * deliberate. A failing golden means the software changed behaviour — that
 * blocks. A missing golden means we never wrote one — that is a gap in the
 * suite, and turning it into a block on day one would mean the gate is red
 * before it has ever been green, which is how gates get switched off. They are
 * printed on every run and they are how the suite grows.
 */

export interface GateInput {
  /** The day the gate is being run on. Passed in so the run is reproducible. */
  today: string;
  valuationGoldens?: readonly ValuationGolden[];
  detectorGoldens?: readonly DetectorGolden[];
  acknowledged?: readonly AcknowledgedFailure[];
  unapprovedAllowed?: readonly string[];
}

export const ALL_VALUATION_GOLDENS: readonly ValuationGolden[] = [
  ...TX_HARRIS_2026_VALUATION_GOLDENS,
  ...TX_DALLAS_2026_VALUATION_GOLDENS,
  ...TX_TARRANT_2026_VALUATION_GOLDENS,
  ...TX_COLLIN_2026_VALUATION_GOLDENS,
  ...TX_BEXAR_2026_VALUATION_GOLDENS,
  ...FL_2026_VALUATION_GOLDENS,
];

export function runGate(input: GateInput): GateResult {
  const valuationGoldens = input.valuationGoldens ?? ALL_VALUATION_GOLDENS;
  const detectorGoldens = input.detectorGoldens ?? DETECTOR_GOLDENS;
  const acknowledged = input.acknowledged ?? ACKNOWLEDGED_FAILURES;
  const unapprovedAllowed = new Set(input.unapprovedAllowed ?? UNAPPROVED_ALLOWED);

  const outcomes: GoldenOutcome[] = [
    ...runValuationGoldens(valuationGoldens),
    ...runDetectorGoldens(detectorGoldens).map((result) => result.outcome),
  ];

  const failures: string[] = [];
  const warnings: string[] = [];

  const failedIds = new Set(outcomes.filter((o) => !o.passed).map((o) => o.id));
  const excused = new Set<string>();
  for (const entry of acknowledged) {
    if (failedIds.has(entry.id)) {
      excused.add(entry.id);
      warnings.push(
        `${entry.id} is failing and acknowledged by ${entry.acknowledgedBy} on ${entry.acknowledgedAt}: ${entry.reason}`,
      );
    } else {
      /**
       * A stale acknowledgement is a failure in its own right. Somebody fixed
       * the case and left the exemption in place, and the next regression in
       * the same golden would go through unnoticed.
       */
      failures.push(
        `${entry.id} is acknowledged as failing but passes. Remove the acknowledgement so the case can guard itself again.`,
      );
    }
  }

  for (const outcome of outcomes) {
    if (outcome.passed || excused.has(outcome.id)) continue;
    failures.push(outcome.detail);
  }

  for (const problem of rulesRepositoryProblems(input.today, unapprovedAllowed)) {
    if (problem.blocking) failures.push(problem.message);
    else warnings.push(problem.message);
  }

  const covered = detectorsCovered(detectorGoldens);
  const uncovered = DETECTOR_RULE_KEYS.filter((key) => !covered.has(key));
  if (uncovered.length > 0) {
    warnings.push(
      `No golden exercises ${uncovered.join(', ')}. Each one is a detector whose behaviour nothing in the repo pins down.`,
    );
  }

  for (const row of valuationCoverage(valuationGoldens)) {
    if (row.noticeBacked === 0) {
      warnings.push(
        `${row.jurisdictionId} ${row.taxYear} has ${row.cases} golden${row.cases === 1 ? '' : 's'} and none of them is taken from an assessment notice. The suite proves our arithmetic is unchanged, not that it matches the district's.`,
      );
    }
  }

  for (const schedule of SCHEDULES) {
    const hasGolden = valuationGoldens.some(
      (golden) =>
        golden.jurisdictionId === schedule.jurisdictionId && golden.taxYear === schedule.taxYear,
    );
    if (hasGolden) continue;
    /**
     * A schedule whose tables have not been transcribed yet has no numbers to
     * pin, so demanding a golden for it would be demanding a test of an empty
     * table — and the only way to satisfy it would be to invent cells. That is
     * the exact failure this gate exists to prevent, so it warns instead, and
     * names the document somebody has to read. The block returns the moment the
     * tables land, because the status changes with them.
     */
    if (schedule.status === 'awaiting-transcription') {
      warnings.push(
        `${schedule.jurisdictionId} ${schedule.taxYear} is registered with no tables transcribed yet, so nothing values against it and no golden can pin it. Still to read: ${schedule.awaiting?.document ?? 'the published guide'}.`,
      );
      continue;
    }
    failures.push(
      `${schedule.jurisdictionId} ${schedule.taxYear} has a depreciation schedule and no golden. A table nothing checks is the failure mode this harness exists for.`,
    );
  }

  for (const table of RATE_TABLES) {
    if (table.status === 'awaiting-adoption') {
      /**
       * Not a failure and not a gap in the suite. Texas units adopt their rates
       * through the late summer and autumn (Tex. Tax Code 26.05), so for most
       * of a tax year the year's rates do not exist yet. The entry is here so
       * that the product refuses to price the year rather than reaching for the
       * prior year's column sitting beside it in the same file.
       */
      warnings.push(
        `${table.jurisdictionId} ${table.taxYear} rates are not adopted yet, so nothing prices against that year. ${table.awaiting?.expected ?? ''}`.trim(),
      );
      continue;
    }
    if (Object.keys(table.units).length === 0) {
      failures.push(
        `${table.jurisdictionId} ${table.taxYear} is marked adopted and holds no units. Every account in it would price at a rate of zero, which reads as a client who owes nothing.`,
      );
    }
  }

  return {
    ok: failures.length === 0,
    ranAt: input.today,
    goldensRun: outcomes.length,
    goldensFailed: outcomes.filter((o) => !o.passed).length,
    failures,
    warnings,
    outcomes,
  };
}

interface RuleProblem {
  blocking: boolean;
  message: string;
}

/**
 * Everything the repository itself can be wrong about, independently of whether
 * the arithmetic works.
 */
function rulesRepositoryProblems(today: string, unapprovedAllowed: Set<string>): RuleProblem[] {
  const problems: RuleProblem[] = [];
  const seen = new Map<string, string>();
  /**
   * Collected rather than reported one by one. Fifteen identical lines is a
   * wall a person scrolls past; one line with a count is a number that is
   * supposed to go down.
   */
  const outstanding: string[] = [];

  for (const status of ruleStatuses(today)) {
    const rule = status.provenance;

    const duplicate = seen.get(rule.ruleId);
    if (duplicate) {
      problems.push({
        blocking: true,
        message: `Two rules both claim the id ${rule.ruleId} (${duplicate} and ${rule.title}). An id is how a finding cites its authority, so it has to be unique.`,
      });
    }
    seen.set(rule.ruleId, rule.title);

    if (rule.citation.trim().length === 0) {
      problems.push({
        blocking: true,
        message: `${rule.ruleId} carries no citation. Every position we put in front of a district names its authority.`,
      });
    }

    if (status.kind !== 'detector' && !rule.jurisdictions) {
      problems.push({
        blocking: true,
        message: `${rule.ruleId} is a depreciation schedule with no jurisdiction scope. A district's table is correct in exactly one district.`,
      });
    }

    if (!rule.approvedBy) {
      if (unapprovedAllowed.has(rule.ruleId)) outstanding.push(rule.ruleId);
      else {
        problems.push({
          blocking: true,
          message: `${rule.ruleId} has not been approved by anyone. Add an approver, or put it on the outstanding-approval list with a reason, an owner and a date.`,
        });
      }
    }

    /**
     * Rate tables are excluded here because `runGate` already reports the only
     * rate staleness that means anything — a year nobody has adopted — and in
     * the words a reader can act on. Repeating it as `ruleId — reason` would be
     * the same warning twice.
     */
    if (status.staleReason && status.kind !== 'rate') {
      /**
       * A schedule out of its window blocks; a statute out of reach does not.
       * Valuing 2027 property on the 2026 table produces a wrong number
       * silently, which is the thing this whole phase is about. A detector
       * rule whose window has closed simply stops applying, and the engine
       * already declines to raise it.
       */
      problems.push({
        blocking: status.kind === 'valuation',
        message: `${rule.ruleId} — ${status.staleReason}`,
      });
    }
  }

  if (outstanding.length > 0) {
    problems.push({
      blocking: false,
      message: `${outstanding.length} rule${outstanding.length === 1 ? '' : 's'} still awaiting approval: ${outstanding.join(', ')}. Each is on the outstanding-approval list with a reason and an owner, so none blocks, and clearing the list is the release criterion for a paid engagement.`,
    });
  }

  for (const key of DETECTOR_RULE_KEYS) {
    if (!ruleFor(key)) {
      problems.push({
        blocking: true,
        message: `The ${key} detector has no rule in the repository, so a finding it raises would cite nothing.`,
      });
    }
  }

  return problems;
}

/**
 * The whole repository in one list, valuation tables and detectors together,
 * with the derived facts the dashboard reads: whether it is in effect today,
 * and how many goldens stand behind it.
 */
export function ruleStatuses(today: string, goldens?: readonly ValuationGolden[]): RuleStatus[] {
  const valuationGoldens = goldens ?? ALL_VALUATION_GOLDENS;
  const statuses: RuleStatus[] = [];

  for (const schedule of SCHEDULES) {
    const rule = schedule.provenance;
    const count = valuationGoldens.filter(
      (golden) =>
        golden.jurisdictionId === schedule.jurisdictionId && golden.taxYear === schedule.taxYear,
    ).length;
    statuses.push({
      provenance: rule,
      kind: 'valuation',
      goldenCount: count,
      labelCount: 0,
      inEffect: staleReason(rule, today) === null,
      staleReason: staleReason(rule, today),
    });
  }

  /**
   * Rate tables carry no golden count. The cases that pin them live in
   * `@tangible/valuation` as unit tests over real Harris accounts rather than
   * in this harness, because a rate golden would be the same arithmetic twice:
   * there is no published worked example to check against, the way an
   * assessment notice checks a depreciation table. What the gate does check
   * here is everything else it checks of a rule — a citation, a jurisdiction
   * scope, a year, and an approver.
   */
  for (const table of RATE_TABLES) {
    statuses.push({
      provenance: table.provenance,
      kind: 'rate',
      goldenCount: 0,
      labelCount: 0,
      inEffect: table.status === 'adopted',
      /**
       * The status, not the calendar. A 2025 rate table is out of its effective
       * window today and that is not a defect — prior years are what a 25.25
       * correction and a late protest are about. What would be a defect is a
       * year whose rates nobody has adopted being priced anyway.
       */
      staleReason:
        table.status === 'adopted' ? null : `Rates for ${table.taxYear} are not adopted yet.`,
    });
  }

  const covered = detectorsCovered(DETECTOR_GOLDENS);
  for (const rule of DETECTOR_RULES) {
    const key = rule.ruleId.replace(/^detector:/, '');
    statuses.push({
      provenance: rule,
      kind: 'detector',
      goldenCount: covered.has(key) ? 1 : 0,
      labelCount: 0,
      inEffect: staleReason(rule, today) === null,
      staleReason: staleReason(rule, today),
    });
  }

  return statuses;
}

/** Which rule, if any, claims a given jurisdiction and year. For the dashboard. */
export function rulesCovering(
  today: string,
  jurisdictionId: string | null,
  taxYear: number | null,
): RuleStatus[] {
  return ruleStatuses(today).filter((status) => covers(status.provenance, jurisdictionId, taxYear));
}
