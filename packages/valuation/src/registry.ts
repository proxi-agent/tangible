import { FL_DOR_2026 } from './schedules/fl-dor-2026.js';
import { TX_HARRIS_2026 } from './schedules/tx-harris-2026.js';
import type { DepreciationSchedule } from './types.js';

/**
 * Published schedules, by jurisdiction and tax year.
 *
 * One county and one state. Adding another is a data file and a line here, and
 * for much of Texas it is cheaper than that: several districts adopt HCAD's
 * tables outright, so they can point at this schedule until their own is
 * loaded — but only deliberately, never by falling back. A jurisdiction with
 * nothing published returns undefined, and the caller says so rather than
 * valuing a client's assets against another county's arithmetic.
 *
 * The one exception is a state that publishes a standard its counties appraise
 * against, which is Florida and is not Texas. That fallback is declared on the
 * schedule itself (`appliesStatewide`) rather than inferred from the id, so
 * "Dallas has no guide, use Harris's" stays impossible.
 */
export const SCHEDULES: readonly DepreciationSchedule[] = [TX_HARRIS_2026, FL_DOR_2026];

/**
 * The jurisdictions this app can actually value against, for the picker on an
 * engagement. Deliberately the schedule list rather than the warehouse's — a
 * county whose roll we ingest but whose schedules we have not loaded cannot
 * price anything, and offering it would promise a number that never arrives.
 */
export function scheduledJurisdictions(): { id: string; name: string; taxYears: number[] }[] {
  const byId = new Map<string, { id: string; name: string; taxYears: number[] }>();
  for (const schedule of SCHEDULES) {
    const entry = byId.get(schedule.jurisdictionId);
    if (entry) entry.taxYears.push(schedule.taxYear);
    else
      byId.set(schedule.jurisdictionId, {
        id: schedule.jurisdictionId,
        name: schedule.jurisdictionName,
        taxYears: [schedule.taxYear],
      });
  }
  return [...byId.values()]
    .map((entry) => ({ ...entry, taxYears: entry.taxYears.sort((a, b) => b - a) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The state segment of a jurisdiction id: `tx-harris` is `tx`, and `fl` is
 * `fl`. Ids are a short controlled string, not a pattern language.
 */
function stateOf(jurisdictionId: string): string {
  const dash = jurisdictionId.indexOf('-');
  return dash === -1 ? jurisdictionId : jurisdictionId.slice(0, dash);
}

export function scheduleFor(
  jurisdictionId: string,
  taxYear: number,
): DepreciationSchedule | undefined {
  let forJurisdiction = SCHEDULES.filter((s) => s.jurisdictionId === jurisdictionId);

  // A county with nothing of its own falls back to its state's standard, but
  // only where a state has declared one. See `appliesStatewide`.
  if (forJurisdiction.length === 0) {
    const state = stateOf(jurisdictionId);
    forJurisdiction = SCHEDULES.filter(
      (s) => s.appliesStatewide === true && s.jurisdictionId === state,
    );
  }
  if (forJurisdiction.length === 0) return undefined;

  const exact = forJurisdiction.find((s) => s.taxYear === taxYear);
  if (exact) return exact;

  // A year we have not loaded yet falls back to the most recent published one,
  // which is what an appraiser would do in January before the new guide is out.
  // The caller can tell it happened by comparing `taxYear` on the result.
  return forJurisdiction.reduce((newest, s) => (s.taxYear > newest.taxYear ? s : newest));
}
