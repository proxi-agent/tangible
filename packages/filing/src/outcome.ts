import type { OutcomePhase, ResolutionStage, SettledVia, SiteOutcome } from '@tangible/types';
import { stamp } from './extensions.js';

/**
 * Where one site's year stands, told as a value story.
 *
 * Every module before this answers about one document: the return, the notice,
 * the protest, the ending, the motion. None of them answers the question the
 * engagement exists to answer — what did the year come to — because that
 * answer runs *across* the documents. The return went out at a cost; the
 * district answered with a value; the value was argued with or it was not; and
 * something stands on the roll today. This module walks that sequence once and
 * says where it stopped.
 *
 * Two rules keep it honest.
 *
 * The first is that cost and value never meet. `renderedCost` is historical
 * cost off Form 50-144 and everything after the notice is appraised value —
 * different quantities in different units, and a screen that subtracted one
 * from the other would be reporting a number that means nothing. The only
 * difference computed here is noticed against standing, which is the season's
 * work measured in the district's own units.
 *
 * The second is that an unprotested value is a settled one. 41.44's window
 * closes and the noticed value is the value for the year — as final as a board
 * order, reached by silence. A roll-up that treated only argued endings as
 * endings would report a quiet, correct year as unfinished work, which is
 * backwards: the quiet year is the one where the return did its job.
 */

export interface OutcomeNotice {
  noticedOn: string;
  /** What the district concluded. Null where the notice does not print it. */
  appraisedValue: number | null;
  protestFiledOn: string | null;
  /** Whether there is still time to protest. False once protested, too. */
  protestOpen: boolean;
  protestDeadline: string;
}

export interface OutcomeResolution {
  stage: ResolutionStage;
  resolvedOn: string;
  finalValue: number | null;
  appealOpen: boolean;
  appealDeadline: string | null;
}

/** A 25.25 motion that changed the roll after the year had otherwise ended. */
export interface OutcomeMotion {
  correctedValue: number;
  outcomeOn: string;
}

export interface OutcomeInput {
  locationId: string;
  label: string;
  accountId: string | null;
  renderedCost: number | null;
  filedOn: string | null;
  notice: OutcomeNotice | null;
  resolution: OutcomeResolution | null;
  motion: OutcomeMotion | null;
  /**
   * The jurisdiction's blended total tax rate, where one is on file — the
   * same rate the savings proposal dollarized with, so the promise and the
   * answer convert value the same way. Omitted or null, no estimate is made.
   */
  blendedTaxRate?: number | null;
  /**
   * The statutory exemption the district takes off this site's value before
   * taxing it — 11.145 in Texas, s. 196.183 in Florida — so the estimate is a
   * difference of two tax bills rather than a reduction in appraised value
   * priced as if every dollar of it were taxed. Omitted or null, none is
   * applied, which overstates the estimate for a site that ends the year under
   * the threshold.
   */
  exemptionAmount?: number | null;
}

export function siteOutcome(input: OutcomeInput): SiteOutcome {
  const { notice, motion } = input;

  const base = {
    locationId: input.locationId,
    label: input.label,
    accountId: input.accountId,
    renderedCost: input.renderedCost,
    filedOn: input.filedOn,
    noticedValue: notice?.appraisedValue ?? null,
    noticedOn: notice?.noticedOn ?? null,
  };

  const { phase, settledVia, standingValue, nextDeadline } = position(input);

  // A 25.25 motion is the one route back into a year that has ended, so where
  // one changed the roll it is the last word — it postdates whatever it
  // reopened by construction, because the routes it travels only open once the
  // protest window has gone.
  const corrected = motion !== null && phase === 'settled';
  const value = corrected ? motion.correctedValue : standingValue;
  const via: SettledVia | null = corrected ? 'motion' : settledVia;

  const reduction = base.noticedValue !== null && value !== null ? base.noticedValue - value : null;

  // Dollarized at the blended rate, sign kept — a value that went up costs
  // estimated dollars the same way one that came down saves them. The prose
  // below never states this figure: the standing sentence speaks in the
  // district's units, and the estimate is presented as one wherever it shows.
  const rate = input.blendedTaxRate ?? null;
  // Taxable value on each side, not the appraised value: the exemption comes
  // off both, so a site noticed at $130,000 and settled at $100,000 saves the
  // tax on $5,000, not on $30,000.
  const exemption = Math.max(0, input.exemptionAmount ?? 0);
  const taxable = (v: number) => Math.max(0, v - exemption);
  const estimatedTaxReduction =
    base.noticedValue !== null && value !== null && rate !== null
      ? (taxable(base.noticedValue) - taxable(value)) * rate
      : null;

  return {
    ...base,
    phase,
    standingValue: value,
    settledVia: via,
    final: phase === 'settled',
    reduction,
    blendedTaxRate: rate,
    estimatedTaxReduction,
    nextDeadline,
    standing: prose(input, phase, via, value, reduction, nextDeadline),
  };
}

interface Position {
  phase: OutcomePhase;
  settledVia: SettledVia | null;
  standingValue: number | null;
  nextDeadline: string | null;
}

function position(input: OutcomeInput): Position {
  const { notice, resolution } = input;

  if (notice === null) {
    return {
      phase: input.filedOn === null ? 'unfiled' : 'awaiting-notice',
      settledVia: null,
      standingValue: null,
      nextDeadline: null,
    };
  }

  if (resolution !== null) {
    // Withdrawn and dismissed determine nothing, so the noticed value stands —
    // reached the expensive way, but reached.
    const determined = resolution.stage === 'informal' || resolution.stage === 'arb';
    const value = determined ? resolution.finalValue : notice.appraisedValue;
    if (resolution.stage === 'arb' && resolution.appealOpen) {
      return {
        phase: 'appeal-window',
        settledVia: 'arb-order',
        standingValue: value,
        nextDeadline: resolution.appealDeadline,
      };
    }
    return {
      phase: 'settled',
      settledVia: VIA[resolution.stage],
      standingValue: value,
      nextDeadline: null,
    };
  }

  if (notice.protestFiledOn !== null) {
    // Protested and not yet resolved: the noticed value is a claim, not an
    // answer, so nothing stands yet.
    return { phase: 'protest-live', settledVia: null, standingValue: null, nextDeadline: null };
  }

  if (notice.protestOpen) {
    return {
      phase: 'protest-window',
      settledVia: null,
      standingValue: null,
      nextDeadline: notice.protestDeadline,
    };
  }

  // Nobody protested and the window has gone. The noticed value is the value.
  return {
    phase: 'settled',
    settledVia: 'unprotested',
    standingValue: notice.appraisedValue,
    nextDeadline: null,
  };
}

const VIA: Record<ResolutionStage, SettledVia> = {
  informal: 'agreement',
  arb: 'arb-order',
  withdrawn: 'withdrawn',
  dismissed: 'dismissed',
};

function prose(
  input: OutcomeInput,
  phase: OutcomePhase,
  via: SettledVia | null,
  value: number | null,
  reduction: number | null,
  nextDeadline: string | null,
): string {
  if (phase === 'unfiled') {
    return 'No return has gone out for this site and no notice has arrived. The year has not started here.';
  }
  if (phase === 'awaiting-notice') {
    return (
      `Rendered ${at(input.renderedCost)} on ${stamp(input.filedOn as string)}. ` +
      'The district has not answered yet — under 25.19 personal-property notices go out by May 1, ' +
      'and until one arrives the return is the only number on the table.'
    );
  }
  if (phase === 'protest-window') {
    return (
      `The district answered ${at((input.notice as OutcomeNotice).appraisedValue)} and the value can ` +
      `still be protested until ${stamp(nextDeadline as string)}. Nothing stands until that window closes ` +
      'or a protest ends.'
    );
  }
  if (phase === 'protest-live') {
    return (
      `Noticed at ${at((input.notice as OutcomeNotice).appraisedValue)} and protested on ` +
      `${stamp((input.notice as OutcomeNotice).protestFiledOn as string)}. The value is being argued, ` +
      'so the year has no standing number yet — only the district’s claim and ours.'
    );
  }
  if (phase === 'appeal-window') {
    return (
      `The board ordered ${at(value)}${took(reduction)}. That order is not the end of the road yet: ` +
      `42.21 runs to ${stamp(nextDeadline as string)}, and until it lapses the number can still move.`
    );
  }
  // Settled.
  if (via === 'motion') {
    return `The year settled and then a 25.25 motion moved the roll to ${at(value)}${took(reduction)}. That is the standing value now — the motion postdates everything else on this row.`;
  }
  if (via === 'agreement') {
    return `Settled by agreement with the chief appraiser at ${at(value)}${took(reduction)}. Final under 1.111(e) — nothing follows.`;
  }
  if (via === 'arb-order') {
    return `The board ordered ${at(value)}${took(reduction)} and the 42.21 window has lapsed. The order stands.`;
  }
  if (via === 'withdrawn') {
    return `The protest was withdrawn, so the noticed ${at(value)} stands. Nothing was determined — the value was conceded, not decided.`;
  }
  if (via === 'dismissed') {
    return `The protest was dismissed, so the noticed ${at(value)} stands as if nobody had protested at all.`;
  }
  return `Nobody protested and the window has gone. The noticed ${at(value)} is the value for the year — as final as a board order, reached by silence.`;
}

/** "$812,000", or the honest version where the notice printed nothing. */
function at(value: number | null): string {
  return value === null ? 'an unrecorded figure' : money(value);
}

function took(reduction: number | null): string {
  if (reduction === null || reduction === 0) return '';
  return reduction > 0
    ? `, ${money(reduction)} below the notice`
    : `, ${money(-reduction)} above the notice`;
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
