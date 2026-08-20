import { TX_HARRIS_2026 } from './schedules/tx-harris-2026.js';
import type { DepreciationSchedule } from './types.js';

/**
 * Published schedules, by jurisdiction and tax year.
 *
 * One county so far. Adding another is a data file and a line here, and for
 * much of Texas it is cheaper than that: several districts adopt HCAD's tables
 * outright, so they can point at this schedule until their own is loaded — but
 * only deliberately, never by falling back. A jurisdiction with nothing
 * published returns undefined, and the caller says so rather than valuing a
 * client's assets against another county's arithmetic.
 */
export const SCHEDULES: readonly DepreciationSchedule[] = [TX_HARRIS_2026];

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

export function scheduleFor(
  jurisdictionId: string,
  taxYear: number,
): DepreciationSchedule | undefined {
  const forJurisdiction = SCHEDULES.filter((s) => s.jurisdictionId === jurisdictionId);
  if (forJurisdiction.length === 0) return undefined;

  const exact = forJurisdiction.find((s) => s.taxYear === taxYear);
  if (exact) return exact;

  // A year we have not loaded yet falls back to the most recent published one,
  // which is what an appraiser would do in January before the new guide is out.
  // The caller can tell it happened by comparing `taxYear` on the result.
  return forJurisdiction.reduce((newest, s) => (s.taxYear > newest.taxYear ? s : newest));
}
