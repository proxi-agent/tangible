import type { AssessmentNoticeFacts, NoticeCheck, ProtestStanding } from '@tangible/types';
import { deadlinesFor, observedDate } from './deadlines.js';
import { addDays, stamp } from './extensions.js';

/**
 * What a notice of appraised value starts, and how long it runs.
 *
 * Everything else in this package is about getting a return out. This is the
 * other half of the season, and it is the half that costs the most to get
 * wrong: the district answers, and the answer is final for the year unless
 * somebody protests it in time. A late rendition costs 10% of the taxes on the
 * property (22.28); a missed protest costs the whole difference between what
 * the district decided and what the property is worth, every year until the
 * next notice.
 *
 * Three clocks come off one piece of mail and they are not the same clock:
 *
 *   - **The protest window.** Tax Code 41.44 gives the later of May 15 and the
 *     thirtieth day after the notice was delivered. Delivery is presumed on the
 *     day it went in the mail (1.07), so the date on the notice is usually the
 *     date the clock started.
 *   - **The penalty waiver.** Where the district applied the 22.28 rendition
 *     penalty, 22.30(b) gives thirty days from receiving notice of it to ask
 *     for a waiver — and that one has no May 15 floor under it, so it can close
 *     weeks before the protest window does.
 *   - **The district's own printed date**, which is not a clock at all but is
 *     what the counter will enforce.
 *
 * Where the printed date and the statute disagree, the rule here is one rule in
 * both directions: **believe the shorter one, and say what the longer one is.**
 * A tool whose job is to not miss deadlines cannot pick the generous reading,
 * and the disagreement is nearly always diagnostic rather than legal — a
 * district printing a flat May 15 without counting thirty days, or a delivery
 * date on our side that is off by a week.
 */

/** 41.44's May 15, observed onto the next business day. */
function statutoryFloor(taxYear: number): string {
  const protest = deadlinesFor(taxYear).find((deadline) => deadline.key === 'protest');
  return protest?.date ?? observedDate(`${taxYear}-05-15`);
}

/**
 * When the protest window closes, and what that is worth saying about.
 *
 * Returns prose in every branch for the same reason {@link extensionStanding}
 * does: the branches that matter are the ones where two dates disagree, and a
 * date on its own cannot tell anybody which of the two it is or why.
 */
export function protestStanding(
  notice: AssessmentNoticeFacts,
  today: string,
  /**
   * Whether an ending is on file for this protest.
   *
   * Only ever narrows the sentence below. Without it a notice protested in May
   * still reads "the value is before the board" in November, which is the exact
   * claim `resolution.ts` exists to stop the record making.
   */
  resolved = false,
): ProtestStanding {
  const floor = statutoryFloor(notice.taxYear);
  // Delivery is what 41.44 counts from. The date printed on the notice stands
  // in for it because 1.07 presumes delivery on mailing — but where somebody
  // recorded the day it actually turned up, that is the better fact and it is
  // the one the district would be arguing against.
  const delivered = notice.deliveredOn ?? notice.noticedOn;
  const thirtyDays = observedDate(addDays(delivered, 30));
  const statutoryDeadline = thirtyDays > floor ? thirtyDays : floor;

  // Shorter wins. Where the notice prints nothing, the statute is all there is.
  const deadline =
    notice.printedDeadline !== null && notice.printedDeadline < statutoryDeadline
      ? notice.printedDeadline
      : statutoryDeadline;

  // 22.30(b) counts thirty days from receiving notice of the penalty, with no
  // May 15 under it. Null rather than a date where no penalty was applied,
  // because a waiver deadline for a penalty nobody imposed is a deadline that
  // would sit on a board being missed forever.
  const waiverDeadline = notice.renditionPenaltyApplied ? thirtyDays : null;

  // How the thirty days are described, said once so every sentence below can
  // tell a recorded fact from a presumption. Where nobody wrote down the day
  // the envelope turned up, 1.07 supplies one — and a presumption is
  // rebuttable, which is exactly why the reader has to know which it is.
  const from =
    notice.deliveredOn !== null
      ? `delivery on ${stamp(delivered)}`
      : `the ${stamp(delivered)} mailing date 1.07 presumes delivery on`;

  const base = { deadline, statutoryDeadline, printedDeadline: notice.printedDeadline, waiverDeadline };

  if (notice.status === 'void') {
    return { ...base, open: false, standing: 'Recorded in error. It starts no clock.' };
  }
  if (notice.status === 'superseded') {
    return {
      ...base,
      open: false,
      standing: 'Replaced by a later notice for this site and year. Work to the newer one.',
    };
  }
  if (notice.protestFiledOn !== null) {
    const late = notice.protestFiledOn > deadline;
    return {
      ...base,
      open: false,
      standing: late
        ? `Protested ${stamp(notice.protestFiledOn)}, after the ${stamp(deadline)} deadline. ` +
          'The board may refuse to hear it — 41.44 makes timeliness the condition of being ' +
          'entitled to a hearing at all.'
        : `Protested ${stamp(notice.protestFiledOn)}, inside the ${stamp(deadline)} deadline. ` +
          (resolved
            ? 'It has since been resolved.'
            : 'The value is before the board and is no longer settled for the year.'),
    };
  }

  const open = today <= deadline;
  const closed = open
    ? ''
    : ` The window closed ${stamp(deadline)}, and the value stands for ${notice.taxYear}.`;

  if (notice.printedDeadline === null) {
    return {
      ...base,
      open,
      standing:
        `No deadline is printed on our record of this notice. Under 41.44 the window runs to ` +
        `${stamp(statutoryDeadline)} — the later of ${stamp(floor)} and thirty days from ` +
        `${from}.${closed}`,
    };
  }

  if (notice.printedDeadline < statutoryDeadline) {
    // The common one, and the one worth money. Districts print the May 15
    // boilerplate on notices mailed late in April, which is a shorter window
    // than 41.44 actually gives — but arguing that at the counter is a fight,
    // and the fight is avoidable by filing on the printed date.
    const extra = Math.round(
      (Date.parse(`${statutoryDeadline}T00:00:00Z`) - Date.parse(`${notice.printedDeadline}T00:00:00Z`)) /
        86_400_000,
    );
    return {
      ...base,
      open,
      standing:
        `The notice prints ${stamp(notice.printedDeadline)}. 41.44 gives the later of ` +
        `${stamp(floor)} and thirty days from ${from}, which is ` +
        `${stamp(statutoryDeadline)} — ${extra} more ${extra === 1 ? 'day' : 'days'} than the ` +
        'notice admits to. They are real and they are days you would be arguing for. Work to the ' +
        `printed date.${closed}`,
    };
  }

  if (notice.printedDeadline > statutoryDeadline) {
    return {
      ...base,
      open,
      standing:
        `The notice prints ${stamp(notice.printedDeadline)}, later than the ` +
        `${stamp(statutoryDeadline)} that 41.44 gives from ${from}. ` +
        'That usually means it was delivered later than we recorded — check the postmark. Until ' +
        `it is checked, work to ${stamp(statutoryDeadline)}.${closed}`,
    };
  }

  return {
    ...base,
    open,
    standing:
      `The notice prints ${stamp(deadline)}, which is what 41.44 gives from ${from}.${closed}`,
  };
}

/**
 * The gap between the appraised value and the district's own schedule.
 *
 * Below this, the difference is the two of us rounding differently — partial
 * year conventions, an index factor applied at a different point — and a
 * protest costs more in time than the arithmetic recovers. Above it, the
 * district reached its number some other way than by applying its published
 * schedule to the cost we rendered, and the question is which way.
 */
const MATERIAL_FRACTION = 0.05;
const MATERIAL_DOLLARS = 2_500;

/** What a return looked like when it went out, for the notice to be read against. */
export interface FiledReturnFacts {
  filedOn: string;
  /** The deadline that return was actually working to, extension and all. */
  dueOn: string;
  confirmation: string | null;
  totalHistoricalCost: number;
  /** What the district's own published schedule produces from that cost. */
  scheduleValue: number;
}

/**
 * Reading the district's answer against what we sent it.
 *
 * Two questions, and only the second is the obvious one. The obvious one is
 * whether the value is too high. The other is whether the district was working
 * from our return at all — a rendition penalty on a return we can prove was
 * postmarked in time says it was not, and that is both an error to correct and
 * the reason the value may be wrong in the first place.
 */
export function checkNotice(
  notice: AssessmentNoticeFacts & { appraisedValue: number | null },
  filed: FiledReturnFacts | null,
  standing: ProtestStanding,
): NoticeCheck[] {
  const checks: NoticeCheck[] = [];

  if (notice.renditionPenaltyApplied) {
    if (filed === null) {
      checks.push({
        key: 'penalty-no-return',
        severity: 'warning',
        message:
          'The district applied the 22.28 rendition penalty and no return is recorded here for ' +
          'this site and year. If one went out, record it — the postmark is the whole of the ' +
          'argument. If none did, the penalty is what the statute provides for.',
      });
    } else if (filed.filedOn <= filed.dueOn) {
      checks.push({
        key: 'penalty-though-timely',
        severity: 'critical',
        message:
          `The district applied the 22.28 rendition penalty, but this return was sent ` +
          `${stamp(filed.filedOn)}, inside the ${stamp(filed.dueOn)} deadline` +
          `${filed.confirmation ? ` (${filed.confirmation})` : ''}. Both cannot be true. Under ` +
          `22.30 the chief appraiser shall waive the penalty on a showing of substantial ` +
          `compliance, and 22.30(b) allows thirty days from this notice to ask` +
          `${standing.waiverDeadline ? ` — ${stamp(standing.waiverDeadline)}` : ''}.`,
      });
    } else {
      checks.push({
        key: 'penalty-and-late',
        severity: 'warning',
        message:
          `The district applied the 22.28 rendition penalty, and this return was sent ` +
          `${stamp(filed.filedOn)}, after the ${stamp(filed.dueOn)} deadline. The penalty is ` +
          `correct on its face. A 22.30 waiver still needs good cause shown, and it has to be ` +
          `asked for by ${standing.waiverDeadline ? stamp(standing.waiverDeadline) : 'the thirtieth day after this notice'}.`,
      });
    }
  }

  if (notice.appraisedValue === null) {
    checks.push({
      key: 'no-value',
      severity: 'note',
      message: 'No appraised value is recorded on this notice, so there is nothing to compare.',
    });
    return checks;
  }

  if (filed === null || filed.scheduleValue <= 0) {
    checks.push({
      key: 'nothing-to-compare',
      severity: 'note',
      message:
        filed === null
          ? 'No return is recorded for this site and year, so there is nothing of ours to read ' +
            'this value against.'
          : 'No depreciation schedule was loaded for this district when the return went out, so ' +
            'there is no figure of ours to read this value against. The cost rendered was ' +
            `${dollars(filed.totalHistoricalCost)}.`,
    });
    return checks;
  }

  const gap = notice.appraisedValue - filed.scheduleValue;
  const fraction = Math.abs(gap) / filed.scheduleValue;
  const material = Math.abs(gap) >= MATERIAL_DOLLARS && fraction >= MATERIAL_FRACTION;

  if (gap > 0 && material) {
    checks.push({
      key: 'above-schedule',
      severity: 'warning',
      message:
        `The district appraised this at ${dollars(notice.appraisedValue)}, ` +
        `${dollars(gap)} above the ${dollars(filed.scheduleValue)} its own published schedule ` +
        `produces from the ${dollars(filed.totalHistoricalCost)} we rendered — ` +
        `${(fraction * 100).toFixed(0)}% high. That is an arithmetic argument rather than an ` +
        'opinion about value, which is the kind a board can check.',
    });
  } else if (gap < 0 && material) {
    checks.push({
      key: 'below-schedule',
      severity: 'note',
      message:
        `The district appraised this at ${dollars(notice.appraisedValue)}, ` +
        `${dollars(-gap)} below the ${dollars(filed.scheduleValue)} its own schedule would ` +
        'produce. There is nothing here to protest.',
    });
  } else {
    checks.push({
      key: 'on-schedule',
      severity: 'note',
      message:
        `The district appraised this at ${dollars(notice.appraisedValue)}, against ` +
        `${dollars(filed.scheduleValue)} from its own schedule. They agree to within ` +
        'rounding, so the return was read the way it was written.',
    });
  }

  return checks;
}

/** Whole dollars, which is the grain every figure on a notice is printed at. */
function dollars(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
