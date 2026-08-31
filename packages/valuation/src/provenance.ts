import type { RuleProvenance } from '@tangible/types';
import { SCHEDULES } from './registry.js';

/**
 * Whether a rule is in effect on a given day, and why not when it is not.
 *
 * The incumbent failure mode this exists to prevent is a depreciation table
 * that went stale quietly. Nobody chooses to value 2027 property on the 2026
 * guide; it happens because the 2026 table is still sitting there working, and
 * arithmetic that runs is indistinguishable from arithmetic that is right.
 *
 * So staleness is computed, not remembered. `effectiveTo` on a district's
 * schedule is the day its own guide stops being the published one — for an
 * annual guide that is the end of the tax year it was issued for — and after
 * that day the schedule still computes and the app can say it should not.
 */
export function inEffect(rule: RuleProvenance, on: string): boolean {
  return staleReason(rule, on) === null;
}

export function staleReason(rule: RuleProvenance, on: string): string | null {
  const day = on.slice(0, 10);
  if (day < rule.effectiveFrom.slice(0, 10)) {
    return `Not in effect until ${rule.effectiveFrom.slice(0, 10)}.`;
  }
  if (rule.effectiveTo && day > rule.effectiveTo.slice(0, 10)) {
    return `Expired ${rule.effectiveTo.slice(0, 10)}. Check whether the district has published a newer one.`;
  }
  return null;
}

/**
 * Whether a rule claims to cover this jurisdiction and year.
 *
 * A null scope means "everywhere" or "every year", which is right for a statute
 * and wrong for a schedule — hence `RULE_SCOPE_REQUIRED` below, which the gate
 * uses to refuse a valuation rule that forgot to name its county.
 */
export function covers(
  rule: RuleProvenance,
  jurisdictionId: string | null,
  taxYear: number | null,
): boolean {
  if (rule.jurisdictions && jurisdictionId !== null) {
    if (!rule.jurisdictions.some((scope) => scopeMatches(scope, jurisdictionId))) return false;
  }
  if (rule.taxYears && taxYear !== null && !rule.taxYears.includes(taxYear)) return false;
  return true;
}

/**
 * A scope is either a jurisdiction id or a trailing wildcard on the state
 * segment: `tx-harris` or `tx-*`. The wildcard exists because most detector
 * rules rest on the Texas Tax Code and are correct in every Texas district,
 * while a depreciation table is correct in exactly one — and writing the
 * difference down is the point. Only a trailing `*` is honoured; a scope is a
 * short controlled string, not a pattern language.
 */
function scopeMatches(scope: string, jurisdictionId: string): boolean {
  if (scope === '*') return true;
  if (scope.endsWith('*')) return jurisdictionId.startsWith(scope.slice(0, -1));
  return scope === jurisdictionId;
}

/** Valuation rules must name their jurisdiction and year; statutes need not. */
export const RULE_SCOPE_REQUIRED = ['valuation', 'rate'] as const;

/** Every committed schedule's provenance, for the rules dashboard and the gate. */
export function scheduleProvenance(): RuleProvenance[] {
  return SCHEDULES.map((schedule) => schedule.provenance);
}

export function provenanceFor(jurisdictionId: string, taxYear: number): RuleProvenance | undefined {
  return SCHEDULES.find((s) => s.jurisdictionId === jurisdictionId && s.taxYear === taxYear)
    ?.provenance;
}
