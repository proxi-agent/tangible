import { FL_DOR_2026 } from './schedules/fl-dor-2026.js';
import { TX_BEXAR_2026 } from './schedules/tx-bexar-2026.js';
import { TX_COLLIN_2026 } from './schedules/tx-collin-2026.js';
import { TX_DALLAS_2026 } from './schedules/tx-dallas-2026.js';
import { TX_HARRIS_2026 } from './schedules/tx-harris-2026.js';
import { TX_TARRANT_2026 } from './schedules/tx-tarrant-2026.js';
import { TX_TRAVIS_2026 } from './schedules/tx-travis-2026.js';
import type { DepreciationSchedule, ScheduleStatus } from './types.js';

/**
 * Published schedules, by jurisdiction and tax year.
 *
 * Five Texas counties and one state — the metros where the unserved mid-market
 * actually sits. Adding another is a data file and a line here, and for much of
 * Texas it is cheaper than that: several districts adopt HCAD's tables outright,
 * so they can point at this schedule until their own is loaded — but only
 * deliberately, never by falling back. A jurisdiction with nothing published
 * returns undefined, and the caller says so rather than valuing a client's
 * assets against another county's arithmetic.
 *
 * The one exception is a state that publishes a standard its counties appraise
 * against, which is Florida and is not Texas. That fallback is declared on the
 * schedule itself (`appliesStatewide`) rather than inferred from the id, so
 * "Fort Bend has no guide, use Harris's" stays impossible — which is the rule
 * that made the other counties worth transcribing rather than aliasing. It was
 * worth it. The five disagree about nearly everything: furniture and fixtures
 * is eight years in Harris and Bexar, nine in Collin and ten in Dallas and
 * Tarrant; Dallas and Collin publish no percent good at all, only its product
 * with a cost index; Tarrant publishes percent good and no index; Bexar
 * publishes a calibrated conclusion with the trending already inside it and
 * heads its columns with a life-and-residual code rather than a life; Collin
 * publishes seven- and nine-year lives nobody else has and its own column for
 * vehicles; and the SIC-driven machinery life that is the largest lever on a
 * Harris County rendition exists in no other district here.
 *
 * Travis is in this list and values nothing. TCAD publishes no tables at all —
 * its reappraisal plan describes them in detail and prints none — so it is
 * registered `awaiting-transcription` and gaps on every asset. That is a
 * deliberate entry rather than an omission: an absent jurisdiction reads as
 * work not started, and this one is blocked on a district that has not
 * published, which is a different thing and worth being able to point at.
 */
export const SCHEDULES: readonly DepreciationSchedule[] = [
  TX_HARRIS_2026,
  TX_DALLAS_2026,
  TX_TARRANT_2026,
  TX_COLLIN_2026,
  TX_BEXAR_2026,
  TX_TRAVIS_2026,
  FL_DOR_2026,
];

/**
 * The jurisdictions this app can actually value against, for the picker on an
 * engagement. Deliberately the schedule list rather than the warehouse's — a
 * county whose roll we ingest but whose schedules we have not loaded cannot
 * price anything, and offering it would promise a number that never arrives.
 *
 * `status` is on each entry because Travis made the sentence above ambiguous. A
 * registered jurisdiction whose tables are not published is on this list and
 * cannot price anything either, and the two callers want opposite things from
 * it: the engagement picker should still offer it, because a Travis client owes
 * a return on the statutory date and printing one needs no schedule at all,
 * while the line that tells an operator whether a site will be valued must say
 * no. Aggregated across years as "committed if any year is", which is the
 * question a picker is asking.
 */
export interface ScheduledJurisdiction {
  id: string;
  name: string;
  taxYears: number[];
  status: ScheduleStatus;
}

export function scheduledJurisdictions(): ScheduledJurisdiction[] {
  const byId = new Map<string, ScheduledJurisdiction>();
  for (const schedule of SCHEDULES) {
    const entry = byId.get(schedule.jurisdictionId);
    if (entry) {
      entry.taxYears.push(schedule.taxYear);
      if (schedule.status === 'committed') entry.status = 'committed';
    } else
      byId.set(schedule.jurisdictionId, {
        id: schedule.jurisdictionId,
        name: schedule.jurisdictionName,
        taxYears: [schedule.taxYear],
        status: schedule.status,
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
