import type {
  AssessmentNoticeFacts,
  NoticeCheck,
  ProtestResolutionFacts,
  ResolutionStanding,
} from '@tangible/types';
import { observedDate } from './deadlines.js';
import { addDays, stamp } from './extensions.js';

/**
 * How a protest ended, and whether anything follows it.
 *
 * `protest.ts` is about the clock a notice starts. This is the other end of the
 * same envelope, and it is the end the engagement is measured by. A protest
 * with no recorded ending leaves an engagement unable to answer either of the
 * two questions it exists to answer — what did the year come to, and what does
 * next year start from — because the only value on file is still the one the
 * district proposed before anybody argued with it.
 *
 * Four endings, and the difference between them is not bookkeeping:
 *
 *   - **Informal.** Settled with the chief appraiser. Under 1.111(e) an
 *     agreement between the owner's agent and the chief appraiser is final on
 *     any matter that could have been protested to the board or corrected under
 *     25.25. Final means final: no hearing, no order, no appeal. This is where
 *     most BPP protests actually end, and it is the ending with the fewest
 *     dates after it.
 *   - **ARB order.** A written order determining the protest under 41.47. That
 *     one *does* start a clock — 42.21(a) gives sixty days from receiving
 *     notice the order was entered to file suit, and 41A gives the same sixty
 *     days to demand binding arbitration instead where the property is
 *     appraised at $5,000,000 or less.
 *   - **Withdrawn** and **dismissed.** Nothing was determined. The value on the
 *     notice stands for the year, and saying so is the point of recording them
 *     at all: an unresolved protest looks like work in progress, and a
 *     withdrawn one looks like work in progress forever.
 *
 * Every figure here is assessed value. There is no tax rate anywhere in this
 * repo and a reduction quoted in tax dollars would need one, plus the rates of
 * every overlapping jurisdiction the account sits in.
 */

/** 42.21(a), and 41A.03's request for arbitration, both sixty days. */
const APPEAL_DAYS = 60;

/** 41A.01's ceiling for property other than a residence homestead. */
const ARBITRATION_CEILING = 5_000_000;

/**
 * What a resolution settles, and what it leaves open.
 *
 * The appeal deadline is measured from the order date because that is the only
 * date we hold. 42.21(a) actually counts from *receipt* of notice that the
 * order was entered, which is always the same day or later — so sixty days from
 * the order is the short reading, and this file takes the short reading for the
 * same reason `protestStanding` does. It says which one it took.
 */
export function resolutionStanding(
  resolution: ProtestResolutionFacts,
  today: string,
): ResolutionStanding {
  const { stage, resolvedOn, noticedValue, finalValue } = resolution;

  // The value that stands after this. For a withdrawal or a dismissal that is
  // the noticed value, unchanged, which is exactly the fact being recorded.
  const standingValue = finalValue ?? noticedValue;
  const reduction = noticedValue !== null && finalValue !== null ? noticedValue - finalValue : null;
  const reductionPct =
    reduction !== null && noticedValue !== null && noticedValue > 0
      ? reduction / noticedValue
      : null;

  const base = { reduction, reductionPct };

  if (resolution.status === 'void') {
    return {
      ...base,
      binding: false,
      appealDeadline: null,
      appealOpen: false,
      arbitrationEligible: null,
      standing: 'Recorded in error. It settles nothing.',
    };
  }
  if (resolution.status === 'superseded') {
    return {
      ...base,
      binding: false,
      appealDeadline: null,
      appealOpen: false,
      arbitrationEligible: null,
      standing: 'Replaced by a later record of how this protest ended. Work to the newer one.',
    };
  }

  const moved = reduction === null ? '' : ` ${describe(reduction, reductionPct)}`;

  if (stage === 'informal') {
    return {
      ...base,
      binding: true,
      appealDeadline: null,
      appealOpen: false,
      arbitrationEligible: null,
      standing:
        `Settled with the chief appraiser on ${stamp(resolvedOn)}.${moved} Under 1.111(e) an ` +
        `agreement between the owner's agent and the chief appraiser is final on any matter that ` +
        `could have been protested, so this closes ${resolution.taxYear} for this account. There ` +
        'is no board hearing after it and nothing to appeal from.',
    };
  }

  if (stage === 'withdrawn' || stage === 'dismissed') {
    const how =
      stage === 'withdrawn'
        ? `The protest was withdrawn on ${stamp(resolvedOn)}.`
        : `The board dismissed the protest on ${stamp(resolvedOn)}.`;
    return {
      ...base,
      binding: true,
      appealDeadline: null,
      appealOpen: false,
      arbitrationEligible: null,
      standing:
        `${how} Nothing was determined, so the ` +
        `${noticedValue === null ? 'value on the notice' : dollars(noticedValue)} stands for ` +
        `${resolution.taxYear}` +
        (stage === 'dismissed'
          ? ' — a dismissal is not a decision about value, and it forecloses the same appeals a ' +
            'decision would.'
          : '.'),
    };
  }

  // 41.47's written order. The one ending with anything after it.
  const appealDeadline = observedDate(addDays(resolvedOn, APPEAL_DAYS));
  const appealOpen = today <= appealDeadline;
  const arbitrationEligible = standingValue === null ? null : standingValue <= ARBITRATION_CEILING;

  const arbitration =
    arbitrationEligible === null
      ? ' No value is recorded here, so whether 41A arbitration is open cannot be answered.'
      : arbitrationEligible
        ? ` At ${dollars(standingValue as number)} the account is under 41A's $5,000,000 ceiling, ` +
          'so binding arbitration is available on the same sixty days and costs a deposit rather ' +
          'than a lawsuit.'
        : ` At ${dollars(standingValue as number)} the account is over 41A's $5,000,000 ceiling, ` +
          'so district court is the only route.';

  return {
    ...base,
    binding: !appealOpen,
    appealDeadline,
    appealOpen,
    arbitrationEligible,
    standing: appealOpen
      ? `The board's order is dated ${stamp(resolvedOn)}.${moved} 42.21(a) gives sixty days from ` +
        `receiving notice that the order was entered to file suit. Sixty days from the order ` +
        `itself is ${stamp(appealDeadline)}, and receipt is normally later than the order date — ` +
        `so this is the earliest the window can close, not the latest.${arbitration}`
      : `The board's order is dated ${stamp(resolvedOn)}.${moved} Sixty days from it ran out ` +
        `${stamp(appealDeadline)}. 42.21(a) counts from receipt rather than the order date, so a ` +
        `postmark or a certified mail card could still leave time — but on what is recorded here ` +
        `the value stands for ${resolution.taxYear}.`,
  };
}

/**
 * What about this ending is worth a second look.
 *
 * The one that earns its place is the penalty. A firm argues about value, wins,
 * and books the reduction — and the 22.28 penalty is 10% of the *taxes*, so it
 * follows the value down proportionally and survives. Getting rid of it takes a
 * separate request under 22.30 on a clock that closed thirty days after the
 * notice. Nothing else on the screen says so at the moment the value is being
 * celebrated, which is the moment it needs saying.
 */
export function checkResolution(
  resolution: ProtestResolutionFacts,
  notice: AssessmentNoticeFacts,
  standing: ResolutionStanding,
): NoticeCheck[] {
  const checks: NoticeCheck[] = [];
  if (resolution.status !== 'recorded') return checks;

  if (resolution.resolvedOn < notice.noticedOn) {
    checks.push({
      key: 'resolved-before-noticed',
      severity: 'warning',
      message:
        `This is dated ${stamp(resolution.resolvedOn)}, before the ` +
        `${stamp(notice.noticedOn)} notice it resolves. One of the two dates is wrong.`,
    });
  } else if (notice.protestFiledOn !== null && resolution.resolvedOn < notice.protestFiledOn) {
    checks.push({
      key: 'resolved-before-protest',
      severity: 'warning',
      message:
        `This is dated ${stamp(resolution.resolvedOn)}, before the protest went in on ` +
        `${stamp(notice.protestFiledOn)}. Check which date belongs to which act.`,
    });
  }

  // A 1.111(e) agreement genuinely can predate a protest — settling with the
  // chief appraiser is not conditioned on having filed one, and on a BPP
  // account it often happens over the phone. The other three cannot.
  if (notice.protestFiledOn === null && resolution.stage !== 'informal') {
    checks.push({
      key: 'resolution-without-protest',
      severity: 'warning',
      message:
        `A protest that was ${resolution.stage === 'arb' ? 'heard' : resolution.stage} has to have ` +
        'been filed first, and no protest date is recorded on this notice. Record the day the ' +
        'notice of protest went in — 41.44 makes that date the condition of a hearing at all.',
    });
  }

  if (resolution.stage === 'arb' && resolution.orderReference === null) {
    checks.push({
      key: 'order-unreferenced',
      severity: 'note',
      message:
        '41.47 requires the board to determine the protest by written order and deliver a copy. ' +
        'No order number is recorded here, and the order is what a 42.21 petition or a 41A ' +
        'arbitration request is filed against.',
    });
  }

  if (standing.reduction !== null && standing.reduction < 0) {
    checks.push({
      key: 'value-increased',
      severity: 'warning',
      message:
        `The value recorded here is ${dollars(-standing.reduction)} above the ` +
        `${dollars(resolution.noticedValue as number)} on the notice. That happens — 41.47 lets ` +
        'the board determine the value on the evidence rather than within the range the parties ' +
        'brought — but it is worth checking the figures were not transposed.',
    });
  } else if (standing.reduction === 0 && resolution.finalValue !== null) {
    checks.push({
      key: 'no-reduction',
      severity: 'note',
      message:
        `The value came out where the notice put it, at ${dollars(resolution.finalValue)}. The ` +
        'year is settled and there is nothing to carry, which is worth having on the record.',
    });
  } else if (resolution.finalValue !== null && resolution.noticedValue === null) {
    checks.push({
      key: 'reduction-unmeasurable',
      severity: 'note',
      message:
        'No appraised value was recorded on the notice, so what this settlement moved cannot be ' +
        'measured. The figure is worth adding by recording a corrected notice.',
    });
  }

  if (notice.renditionPenaltyApplied) {
    if (resolution.penaltyOutcome === 'waived') {
      checks.push({
        key: 'penalty-waived',
        severity: 'note',
        message:
          'The 22.28 rendition penalty was waived. Under 22.30(a) that is the chief appraiser ' +
          'acting on a showing of substantial compliance or good cause, and it is a separate ' +
          'determination from the value — keep the waiver in the file alongside the order.',
      });
    } else {
      checks.push({
        key: 'penalty-survives',
        severity: 'critical',
        message:
          resolution.penaltyOutcome === 'upheld'
            ? 'The 22.28 rendition penalty was upheld. It is 10% of the taxes on the property, so ' +
              'it follows any reduction down proportionally and is still owed on whatever value ' +
              'stands. 22.30 allows the chief appraiser to waive it, and 22.30(b) gave thirty ' +
              'days from the notice to ask.'
            : 'This notice applied the 22.28 rendition penalty and nothing here says what became ' +
              'of it. Arguing the value does not touch it: the penalty is 10% of the taxes, so a ' +
              'reduction shrinks it proportionally and leaves it owed. A 22.30 waiver is a ' +
              'separate request, and 22.30(b) gave thirty days from the notice to make it.',
      });
    }
  } else if (resolution.penaltyOutcome !== null) {
    checks.push({
      key: 'penalty-outcome-without-penalty',
      severity: 'note',
      message:
        `This records the rendition penalty as ${resolution.penaltyOutcome}, but the notice on ` +
        'file does not say one was applied. Either the notice needs correcting or the penalty ' +
        'belongs to a different year.',
    });
  }

  return checks;
}

/** What the resolution moved, as a phrase that can follow a date. */
function describe(reduction: number, pct: number | null): string {
  const share = pct === null ? '' : ` (${Math.abs(pct * 100).toFixed(0)}%)`;
  if (reduction > 0) return `It took ${dollars(reduction)}${share} off the appraised value.`;
  if (reduction < 0) return `It put ${dollars(-reduction)}${share} onto the appraised value.`;
  return 'The value did not move.';
}

/** Whole dollars, the grain every figure on a notice is printed at. */
function dollars(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
