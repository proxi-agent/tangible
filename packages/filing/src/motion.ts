import type {
  CorrectionMotionFacts,
  CorrectionMotionOutcome,
  CorrectionMotionStanding,
  NoticeCheck,
} from '@tangible/types';
import { routeDeadline } from './correction.js';
import { addDays, stamp } from './extensions.js';

/**
 * A 25.25 motion after it has been filed.
 *
 * `correction.ts` answers whether a year can be reopened. This is the other end
 * of the same act, and it holds three things that screen does not.
 *
 * **What the motion spent.** 25.25(c-1)(3) closes (c-1) for a property and year
 * once a previous motion *under this section* was agreed to, determined, or
 * forfeited. Until a motion could be recorded that bar was permanently false,
 * and the outlook was quietly telling firms a route was open that their own
 * earlier filing had shut. Note the two halves of that: a (d) motion spends
 * (c-1), and a *withdrawn* motion spends nothing, because withdrawal is not in
 * the subsection's list.
 *
 * **What the motion did not buy.** 25.26(a) is blunt — the pendency of a motion
 * does not affect the delinquency date. (b) then requires the taxes on the
 * undisputed portion to be paid before that date or the owner forfeits the
 * right to a final determination. A motion can therefore be right, timely, and
 * dead, because a bill went unpaid in January. On an old year reached under
 * (c) the date is years past and the question is archaeological rather than
 * scheduling: was it paid then.
 *
 * **When anybody has to do anything.** 25.25(e) entitles the filer to a hearing
 * on request, and puts an outer bound on scheduling it: the 90th day after the
 * board approves the appraisal records for a motion filed January through
 * August, or the 90th day after the request for one filed September through
 * December. Only the second is computable from what a firm holds — records
 * approval is the district's own date under 41.12 — and the difference is worth
 * saying out loud, because it means a motion filed in February does not get a
 * February hearing. It gets one in the autumn, after the records are approved.
 *
 * Every figure here is assessed value. There is no tax rate in this repo, and
 * 25.26's "amount of taxes due on the undisputed portion" is a number the
 * collector computes, not one this can.
 */

/** 25.25(g): sixty days from notice of the board's determination to sue to compel. */
const SUIT_DAYS = 60;

/** 25.25(e): written notice of the hearing at least fifteen days before it. */
const NOTICE_DAYS = 15;

/** 25.25(e)'s outer bound on scheduling, from whichever event starts it. */
const SCHEDULE_DAYS = 90;

/**
 * The endings that spend 25.25(c-1) for the property and year, under (c-1)(3).
 *
 * Three of the four. A forfeiture is on the list even though it determines
 * nothing about value, which makes it the worst outcome available: the year is
 * no better and (c-1) is gone.
 */
const SPENDS_C1: CorrectionMotionOutcome[] = ['agreed', 'determined', 'forfeited'];

/** The endings 25.25(g) gives sixty days to sue on. */
const APPEALABLE: CorrectionMotionOutcome[] = ['determined', 'forfeited'];

export function motionStanding(
  motion: CorrectionMotionFacts,
  today: string,
): CorrectionMotionStanding {
  const { subjectTaxYear: year, filedOn, outcome, outcomeOn } = motion;

  // 25.26(b) counts to the delinquency date for the year under motion, which is
  // the same date 25.25(d) runs to and is computed in one place for that reason.
  const prepaymentDeadline = routeDeadline('d', year);
  const prepaymentMet =
    motion.undisputedTaxPaidOn === null ? null : motion.undisputedTaxPaidOn <= prepaymentDeadline;

  const reduction =
    motion.rolledValue !== null && motion.correctedValue !== null
      ? motion.rolledValue - motion.correctedValue
      : null;

  const base = {
    prepaymentDeadline,
    prepaymentMet,
    reduction,
  };

  if (motion.status === 'void') {
    return {
      ...base,
      live: false,
      hearingDueBy: null,
      hearingNoticeDueBy: null,
      suitDeadline: null,
      suitOpen: false,
      barsAnother: false,
      standing:
        'Recorded in error. It spends nothing — 25.25(c-1)(3) is about a motion that was filed, ' +
        'and voiding this record is a statement that no motion was.',
    };
  }
  if (motion.status === 'superseded') {
    return {
      ...base,
      live: false,
      hearingDueBy: null,
      hearingNoticeDueBy: null,
      suitDeadline: null,
      suitOpen: false,
      barsAnother: false,
      standing: 'Replaced by a later record of this motion. Work to the newer one.',
    };
  }

  const hearingDueBy = scheduleBound(filedOn);
  const hearingNoticeDueBy =
    motion.hearingScheduledFor === null ? null : addDays(motion.hearingScheduledFor, -NOTICE_DAYS);

  const suitDeadline =
    outcome !== null && APPEALABLE.includes(outcome) && outcomeOn !== null
      ? addDays(outcomeOn, SUIT_DAYS)
      : null;
  const suitOpen = suitDeadline !== null && today <= suitDeadline;

  const barsAnother = outcome !== null && SPENDS_C1.includes(outcome);

  return {
    ...base,
    live: outcome === null,
    hearingDueBy,
    hearingNoticeDueBy,
    suitDeadline,
    suitOpen,
    barsAnother,
    standing: describe(motion, today, {
      hearingDueBy,
      suitDeadline,
      suitOpen,
      prepaymentDeadline,
      prepaymentMet,
      reduction,
    }),
  };
}

/**
 * 25.25(e)'s ninety days, where they can be counted from what a firm holds.
 *
 * A motion filed September through December counts from the request, which goes
 * in with the motion. One filed January through August counts from the day the
 * board approves the appraisal records — 41.12 puts that at July 20 in the
 * ordinary case, but it is the district's date and not ours, so this returns
 * null rather than assuming it. The prose says which case it is in.
 */
function scheduleBound(filedOn: string): string | null {
  const month = Number(filedOn.slice(5, 7));
  return month >= 9 ? addDays(filedOn, SCHEDULE_DAYS) : null;
}

type Computed = {
  hearingDueBy: string | null;
  suitDeadline: string | null;
  suitOpen: boolean;
  prepaymentDeadline: string;
  prepaymentMet: boolean | null;
  reduction: number | null;
};

function describe(motion: CorrectionMotionFacts, today: string, c: Computed): string {
  const cite = `25.25(${motion.route})`;
  const head = `Filed under ${cite} on ${stamp(motion.filedOn)} against ${motion.subjectTaxYear}.`;

  if (motion.outcome === null) {
    const schedule =
      c.hearingDueBy !== null
        ? ` 25.25(e) entitles the filer to a hearing on request and puts the outer bound on ` +
          `scheduling it at ${stamp(c.hearingDueBy)}, ninety days from the request.`
        : ' 25.25(e) entitles the filer to a hearing on request, but for a motion filed before ' +
          'September the ninety days run from the day the board approves the appraisal records, ' +
          'not from the filing. That date is the district’s — under 41.12 it is usually late ' +
          'July — so a motion filed in the spring is heard in the autumn, and no date can be put ' +
          'on it here.';
    return head + schedule + payment(motion, today, c) + hearingNote(motion);
  }

  if (motion.outcome === 'withdrawn') {
    return (
      `${head} Withdrawn ${stamp(motion.outcomeOn ?? motion.filedOn)}. Nothing was determined and ` +
      'nothing was agreed, so 25.25(c-1)(3) does not bite — withdrawal is not on its list, and ' +
      '(c-1) is exactly where it was before the motion went in.'
    );
  }

  if (motion.outcome === 'agreed') {
    return (
      `${head} The chief appraiser agreed to the correction on ` +
      `${stamp(motion.outcomeOn ?? motion.filedOn)}.${moved(c.reduction)} There is no board order ` +
      'behind it and nothing to appeal from. It does close 25.25(c-1) for this property and year ' +
      'under (c-1)(3) — an agreed correction is on that list — so this year has one fewer route ' +
      'than it looks like it has.'
    );
  }

  if (motion.outcome === 'forfeited') {
    return (
      `${head} The board found the right to a final determination forfeited on ` +
      `${stamp(motion.outcomeOn ?? motion.filedOn)}, which under 25.26(b) means the taxes on the ` +
      'undisputed portion were not paid before the delinquency date. Nothing was determined about ' +
      'value, and 25.25(c-1)(3) closes (c-1) for this year anyway: a forfeiture is on its list. ' +
      '25.25(g) gives sixty days from notice of that finding to sue to compel the change, and ' +
      `sixty days from the finding itself is ${stamp(c.suitDeadline ?? motion.filedOn)}.`
    );
  }

  // Determined. The only ending with both a value and an appeal behind it.
  return (
    `${head} The board determined the motion on ${stamp(motion.outcomeOn ?? motion.filedOn)}.` +
    `${moved(c.reduction)} 25.25(g) gives sixty days from receiving notice of the determination to ` +
    'file suit to compel the board to order the change. Sixty days from the determination itself ' +
    `is ${stamp(c.suitDeadline ?? motion.filedOn)}, and receipt is normally later — so that is the ` +
    `earliest the window can close, not the latest.${
      c.suitOpen ? '' : ' On what is recorded here it has passed.'
    } The determination also closes 25.25(c-1) for this property and year under (c-1)(3).`
  );
}

/** The 25.26 sentence, which reads differently depending on where the date sits. */
function payment(motion: CorrectionMotionFacts, today: string, c: Computed): string {
  if (c.prepaymentMet === true) {
    return (
      ` The taxes on the undisputed portion were paid ${stamp(motion.undisputedTaxPaidOn as string)}` +
      `, inside 25.26(b)'s deadline of ${stamp(c.prepaymentDeadline)}, so the right to a final ` +
      'determination is not in question.'
    );
  }
  if (c.prepaymentMet === false) {
    return (
      ` The taxes on the undisputed portion were not paid until ` +
      `${stamp(motion.undisputedTaxPaidOn as string)}, after 25.26(b)'s deadline of ` +
      `${stamp(c.prepaymentDeadline)}. On the face of it the right to a final determination is ` +
      'forfeited. 25.26(d) is the only way back and it wants an oath of inability to pay.'
    );
  }
  const past = today > c.prepaymentDeadline;
  return (
    ` Nothing is recorded about the 25.26 payment. It is the condition of a final determination ` +
    `and it fell due ${stamp(c.prepaymentDeadline)}` +
    (past
      ? ', which has passed — find out whether the undisputed taxes for the year were paid before ' +
        'going any further, because if they were not the motion cannot be finally determined ' +
        'however good it is.'
      : '. Filing the motion does not move it: 25.26(a) says the pendency of a motion does not ' +
        'affect the delinquency date.')
  );
}

/** What the board has scheduled, where it has scheduled anything. */
function hearingNote(motion: CorrectionMotionFacts): string {
  if (motion.hearingScheduledFor === null) return '';
  return ` A hearing is set for ${stamp(motion.hearingScheduledFor)}.`;
}

function moved(reduction: number | null): string {
  if (reduction === null) return '';
  if (reduction > 0) return ` It took ${dollars(reduction)} off the roll.`;
  if (reduction === 0) return ' The value on the roll did not change.';
  return ` The value on the roll went up by ${dollars(-reduction)}.`;
}

/**
 * What about this motion is worth a second look.
 *
 * The one that earns its place is the first: a motion filed after its own route
 * shut. It happens because the three routes have three deadlines in three
 * different years and the shortest is the one people remember — and the
 * district will not always say so, because a motion out of time is refused
 * quietly and the year goes by.
 */
export function checkMotion(motion: CorrectionMotionFacts, today: string): NoticeCheck[] {
  const checks: NoticeCheck[] = [];
  if (motion.status !== 'recorded') return checks;

  const deadline = routeDeadline(motion.route, motion.subjectTaxYear);
  if (motion.filedOn > deadline) {
    checks.push({
      key: 'motion-out-of-time',
      severity: 'warning',
      message:
        `25.25(${motion.route}) for ${motion.subjectTaxYear} ran out ${stamp(deadline)}, and this ` +
        `went in ${stamp(motion.filedOn)}. Check the filing date against the route: the three ` +
        'subsections have three deadlines in three different years, and a motion out of time is ' +
        'usually refused without an explanation.',
    });
  }

  if (
    motion.route === 'd' &&
    motion.rolledValue !== null &&
    motion.claimedValue !== null &&
    motion.claimedValue > motion.rolledValue * 0.75
  ) {
    checks.push({
      key: 'motion-under-threshold',
      severity: 'warning',
      message:
        `25.25(d) opens only where the roll exceeds the correct value by more than a third. ` +
        `Against ${dollars(motion.rolledValue)} on the roll that puts the ceiling at ` +
        `${dollars(motion.rolledValue * 0.75)}, and this motion claims ` +
        `${dollars(motion.claimedValue)}. On those numbers the route is not available — and ` +
        '25.25(c) or (c-1), where either is still open, costs nothing and has no threshold.',
    });
  }

  if (motion.outcome === null && motion.undisputedTaxPaidOn === null) {
    const due = routeDeadline('d', motion.subjectTaxYear);
    if (today > due) {
      checks.push({
        key: 'motion-payment-unknown',
        severity: 'warning',
        message:
          `25.26(b) makes payment of the taxes on the undisputed portion before ` +
          `${stamp(due)} the condition of a final determination, and nothing is recorded about ` +
          'it. Ask the collector before the hearing rather than at it: the board can find the ' +
          'right forfeited, and a forfeiture still closes (c-1) for the year under (c-1)(3).',
      });
    }
  }

  if (motion.hearingScheduledFor !== null && motion.hearingNoticedOn !== null) {
    const due = addDays(motion.hearingScheduledFor, -NOTICE_DAYS);
    if (motion.hearingNoticedOn > due) {
      checks.push({
        key: 'motion-short-notice',
        severity: 'warning',
        message:
          `25.25(e) requires written notice of the hearing not later than fifteen days before it. ` +
          `The hearing is set for ${stamp(motion.hearingScheduledFor)}, so notice was due by ` +
          `${stamp(due)} and went out ${stamp(motion.hearingNoticedOn)}. Short notice is grounds ` +
          'to ask for a postponement, and asking is cheaper than arguing about it afterwards.',
      });
    }
  }

  if (
    motion.outcome === null &&
    motion.hearingScheduledFor !== null &&
    today > motion.hearingScheduledFor
  ) {
    checks.push({
      key: 'motion-hearing-passed',
      severity: 'note',
      message:
        `The hearing was ${stamp(motion.hearingScheduledFor)} and no outcome is recorded. If the ` +
        'board determined it, 25.25(g)’s sixty days to sue are already running.',
    });
  }

  if (motion.outcome === 'determined' && motion.orderReference === null) {
    checks.push({
      key: 'motion-order-missing',
      severity: 'note',
      message:
        'A determined motion produced a board order and no reference is recorded. A 25.25(g) suit ' +
        'is filed against that order, so the number is worth having before the sixty days run.',
    });
  }

  if (motion.outcomeOn !== null && motion.outcomeOn < motion.filedOn) {
    checks.push({
      key: 'motion-ended-before-filed',
      severity: 'warning',
      message:
        `This ended ${stamp(motion.outcomeOn)}, before it was filed on ${stamp(motion.filedOn)}. ` +
        'One of the two dates is wrong.',
    });
  }

  return checks;
}

function dollars(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
