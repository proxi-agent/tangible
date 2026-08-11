import {
  DEFAULT_MIN_YEARS_ON_ROLL,
  SEGMENT_KEYS,
  STATE_CLASS_GROUPS,
  type SegmentKey,
} from '@tangible/types';
import { lit, litList } from './sql.js';

const MIN_YEARS = lit(DEFAULT_MIN_YEARS_ON_ROLL);
const ADDRESSABLE_GROUPS = litList(['commercial', 'industrial']);

/**
 * SQL predicate for each segment, evaluated against the `series` CTE.
 *
 * Typed as a total record over `SegmentKey`, so adding a segment to the shared
 * types package fails the build here until a predicate is written for it. That
 * is the sync mechanism between the product vocabulary and the SQL.
 */
export const SEGMENT_PREDICATES: Readonly<Record<SegmentKey, string>> = {
  taxable: `is_taxable`,

  unfiled: `is_taxable AND NOT filed_latest_year AND NOT filing_unknown_latest_year`,

  // Never filed in any year on the roll. Years with an unknown filing flag do
  // not count as unfiled, so they break the "never" claim rather than support it.
  chronic_nonfiler: `
    is_taxable
    AND years_on_roll >= ${MIN_YEARS}
    AND years_unfiled = years_on_roll
  `,

  intermittent_nonfiler: `
    is_taxable
    AND years_on_roll >= 2
    AND years_unfiled >= years_on_roll / 2.0
    AND years_unfiled < years_on_roll
  `,

  filed_late: `is_taxable AND late_latest_year`,

  // Chronic non-filers on ordinary commercial/industrial property with no agent.
  // Dealers file monthly special-inventory declarations and utilities/pipelines
  // are valued separately, so neither is served by rendition automation.
  core_icp: `
    is_taxable
    AND years_on_roll >= ${MIN_YEARS}
    AND years_unfiled = years_on_roll
    AND state_class_group IN (${ADDRESSABLE_GROUPS})
    AND NOT has_agent
    AND NOT is_exempt
  `,

  // The signal segments are scoped to taxable accounts like every other
  // segment. A frozen value on an account below the exemption carries no tax
  // and no penalty, and counting those swamps the signal with noise — and makes
  // "share of taxable" exceed 100%.
  frozen_value: `is_taxable AND is_frozen AND years_on_roll >= ${MIN_YEARS}`,

  never_declines: `is_taxable AND never_declines AND NOT is_frozen AND years_on_roll >= ${MIN_YEARS}`,

  agent_represented: `is_taxable AND has_agent`,
};

export function segmentPredicate(segment: SegmentKey): string {
  return SEGMENT_PREDICATES[segment];
}

/** Conjunction of several segments; accounts must satisfy all of them. */
export function segmentsPredicate(segments: readonly SegmentKey[]): string | null {
  if (segments.length === 0) return null;
  return segments.map((s) => `(${SEGMENT_PREDICATES[s]})`).join(' AND ');
}

/**
 * SQL CASE that maps a raw Texas state class code onto its group. Applied at
 * ingest time so the grouping is stored, not recomputed on every query.
 */
export function stateClassGroupSql(column: string): string {
  const branches = Object.entries(STATE_CLASS_GROUPS).map(([group, prefixes]) => {
    const tests = prefixes.map((p) => `upper(trim(${column})) LIKE ${lit(`${p}%`)}`).join(' OR ');
    return `WHEN ${tests} THEN ${lit(group)}`;
  });
  return `CASE ${branches.join(' ')} ELSE NULL END`;
}

export const ALL_SEGMENTS: readonly SegmentKey[] = SEGMENT_KEYS;
