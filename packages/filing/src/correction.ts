import type {
  AssessmentNoticeFacts,
  CorrectionOutlook,
  CorrectionRoute,
  ProtestResolutionFacts,
} from '@tangible/types';
import { stamp } from './extensions.js';

/**
 * What is left after the protest window shuts.
 *
 * 25.25(a) says the appraisal roll may not be changed. The rest of 25.25 is the
 * list of times it may, and for a business personal property practice that list
 * is not a footnote — it is the answer to the first question a new client asks,
 * which is whether anything can be done about the years already gone. A firm
 * that only knows about Chapter 41 can sell one protest a year. A firm that
 * knows 25.25 can look at a fixed asset register in September and still have
 * somewhere to take what it finds.
 *
 * Three routes, and they are not interchangeable:
 *
 *   - **25.25(c)** — five preceding years, for clerical errors, multiple
 *     appraisals, an ownership error, or *the inclusion of property that does
 *     not exist in the form or at the location described in the appraisal
 *     roll*. That last one is this product's whole thesis written into statute:
 *     a register carrying assets that were scrapped, sold or moved years ago
 *     puts property on a roll that does not exist at that location. No
 *     threshold, no penalty, and — this is the part that surprises people —
 *     25.25(l) says a (c) motion may be filed *regardless* of whether the owner
 *     protested that year. Winning a protest does not spend it.
 *   - **25.25(c-1)** — the personal property route, and the one this app is
 *     usually reaching for. It corrects an inaccuracy in the appraised value of
 *     tangible personal property caused by an error or omission in a rendition
 *     filed under Chapter 22. Current year plus the two before it. No
 *     threshold, no penalty — and four bars, every one of which this app
 *     already knows the answer to.
 *   - **25.25(d)** — the general one. Any time before the taxes go delinquent,
 *     but the value has to be more than one-third over correct, and correcting
 *     it costs a 10% late-correction penalty on the taxes computed at the
 *     corrected value. The expensive route, and the shortest one.
 *
 * The order matters when presenting them: (c) and (c-1) cost nothing, so (d) is
 * a last resort rather than a first suggestion. And none of this is offered
 * while a protest is still available, because a protest is cheaper than all
 * three and pointing at 25.25 first would push a firm off the free route.
 */

/** 25.25(c): "changes in the appraisal roll for any of the five preceding years". */
const C_YEARS = 5;

/** 25.25(c-1): "the current tax year and ... either of the two preceding tax years". */
const C1_YEARS = 2;

/** 25.25(d)(2), for property that is not a residence homestead. Every BPP account. */
const D_THRESHOLD = 1 / 3;

/**
 * Which routes are still open for a year, and what shut the ones that are not.
 *
 * `resolution` is how the protest ended, where it did. It is load-bearing: two
 * of the four endings bar the paid routes and two of them do not, and the
 * difference is worth real money. A protest that was *withdrawn* left nothing
 * determined on the merits and no written agreement behind it, so 25.25(c-1) is
 * still there. A protest that settled informally is a written agreement with
 * the district under 1.111(e), and that closes (c-1) and (d) both.
 */
export function correctionOutlook(
  notice: AssessmentNoticeFacts,
  resolution: ProtestResolutionFacts | null,
  /**
   * What the district has on the roll for this year.
   *
   * Passed in rather than read off the notice because only 25.25(d) needs it,
   * and because the same question gets asked of a year whose only paper is an
   * uploaded prior notice rather than one we typed off the envelope.
   */
  rolledValue: number | null,
  today: string,
): CorrectionOutlook {
  const year = notice.taxYear;
  const settled = resolution !== null && resolution.status === 'recorded' ? resolution : null;

  // 25.25(c-1)(4) and (d-1)(2): the value was established by written agreement
  // between the owner's agent and the district. That is what a 1.111(e)
  // settlement is, which is why the ending with the least paperwork is also the
  // one that closes the most doors.
  const agreed = settled?.stage === 'informal';

  // 25.25(c-1)(2) and (d-1)(1): a protest was brought, a hearing was held in
  // which the owner offered evidence or argument, and the board determined it
  // on the merits. A recorded ARB order is all three.
  const determined = settled?.stage === 'arb';

  // 25.25(c-1)(1). 22.28 is the penalty for a *delinquent* report, so a notice
  // that applied one is the district's own statement that both limbs of this
  // bar are met — the rendition was not filed on time, and a penalty followed.
  const penalised = notice.renditionPenaltyApplied === true;

  const routes = [
    routeC(year, today),
    routeC1(year, today, { agreed, determined, penalised }),
    routeD(year, today, rolledValue, { agreed, determined }),
  ];

  const open = routes.filter((route) => route.open);

  return {
    taxYear: year,
    open: open.length > 0,
    routes,
    standing: describe(year, routes, open, { agreed, determined, penalised }),
  };
}

function routeC(year: number, today: string): CorrectionRoute {
  // "Any of the five preceding years" counts back from the year the motion is
  // made, so a year stays reachable through the end of the fifth year after it.
  const deadline = `${year + C_YEARS}-12-31`;
  return {
    key: 'c',
    cite: '25.25(c)',
    label: 'Property that is not there, counted twice, or not ours',
    open: today <= deadline,
    deadline,
    grounds:
      'A clerical error, the same property appraised twice, an ownership error, or property ' +
      'included on the roll that does not exist in the form or at the location described. On a ' +
      'BPP account the third is the common one: a register still carrying assets that were ' +
      'scrapped, sold, or moved to another site puts property on this roll that is not there.',
    threshold: null,
    cost: null,
    // 25.25(l), in full: a motion may be filed under (c) regardless of whether
    // the owner protested that year. Nothing an engagement does spends it.
    barred: null,
  };
}

function routeC1(
  year: number,
  today: string,
  bars: { agreed: boolean; determined: boolean; penalised: boolean },
): CorrectionRoute {
  const deadline = `${year + C1_YEARS}-12-31`;
  const expired = today > deadline;
  const barred = bars.agreed
    ? 'The value for this year was established by agreement with the district. 25.25(c-1)(4) ' +
      'closes this route where that happened, and 1.111(e) makes the agreement final in its own ' +
      'right — the price of settling informally is that this year cannot be reopened.'
    : bars.determined
      ? 'The board heard this protest and determined it on the merits. 25.25(c-1)(2) closes this ' +
        'route where that happened. The bar is written to require that the owner offered evidence ' +
        'or argument at the hearing, so an order entered without the owner appearing is arguably ' +
        'outside it — but that is an argument to have with the district, not an assumption to file on.'
      : bars.penalised
        ? 'This notice applied the 22.28 rendition penalty. 25.25(c-1)(1) closes this route for a ' +
          'year in which the rendition was late and a penalty was assessed, and 22.28 is the ' +
          'penalty for a delinquent report — so the penalty did not just cost 10% of the taxes, it ' +
          'took away the way back.'
        : expired
          ? `The current year and the two before it is all 25.25(c-1) reaches, and ${year} ran out ` +
            `${stamp(deadline)}.`
          : null;

  return {
    key: 'c-1',
    cite: '25.25(c-1)',
    label: 'A rendition that was wrong',
    open: !expired && barred === null,
    deadline,
    grounds:
      'An inaccuracy in the appraised value of tangible personal property that resulted from an ' +
      'error or omission in a rendition or property report filed under Chapter 22. It does not ' +
      'ask how far off the value was and it carries no penalty, which makes it the first route to ' +
      'reach for on a BPP account.',
    threshold: null,
    cost: null,
    barred,
  };
}

function routeD(
  year: number,
  today: string,
  rolledValue: number | null,
  bars: { agreed: boolean; determined: boolean },
): CorrectionRoute {
  // 31.02(a): taxes are delinquent if not paid before February 1 of the year
  // following the year imposed, and (d) runs to the day before that. 31.04 can
  // postpone the delinquency date where the bill went out late, which moves
  // this with it — the prose says so rather than guessing at it here.
  const deadline = `${year + 1}-01-31`;
  const expired = today > deadline;

  // (d) is written against the *correct* value, not the rolled one: the rolled
  // value has to exceed correct by more than a third. So the correct value has
  // to come in under three quarters of what is on the roll, and that is a
  // figure somebody can check a register against.
  const ceiling = rolledValue === null ? null : rolledValue * 0.75;

  const barred = bars.agreed
    ? 'The value was established by written agreement with the district, which 25.25(d-1)(2) ' +
      'closes this route for.'
    : bars.determined
      ? 'The board determined this protest on the merits, which 25.25(d-1)(1) closes this route for.'
      : expired
        ? `This runs only until the taxes go delinquent, which was ${stamp(deadline)} for ${year}.`
        : null;

  return {
    key: 'd',
    cite: '25.25(d)',
    label: 'A value more than a third too high',
    open: !expired && barred === null,
    deadline,
    grounds:
      'Any error that produced an incorrect appraised value — but only where the value on the ' +
      'roll exceeds the correct value by more than one-third, this being property that is not a ' +
      'residence homestead. ' +
      (ceiling === null
        ? 'No value is recorded on this notice, so how far under the roll the correct figure has ' +
          'to come cannot be worked out here.'
        : `Against the ${dollars(rolledValue as number)} on this notice that means the defensible ` +
          `value has to be below ${dollars(ceiling)}. Above that, the route does not open however ` +
          'wrong the number is.'),
    threshold: D_THRESHOLD,
    cost:
      'A late-correction penalty of 10% of the taxes calculated on the corrected value, under ' +
      '25.25(d-1). It is secured by the 32.01 tax lien like any other tax. Worth checking the ' +
      'arithmetic before filing: a correction that saves less than that penalty costs money.',
    barred,
  };
}

/** The year's answer, above the routes rather than inside one of them. */
function describe(
  year: number,
  routes: CorrectionRoute[],
  open: CorrectionRoute[],
  bars: { agreed: boolean; determined: boolean; penalised: boolean },
): string {
  if (open.length === 0) {
    const dates = routes
      .map((route) => route.deadline)
      .filter((date): date is string => date !== null)
      .sort();
    const last = dates.at(-1);
    return (
      `Nothing under 25.25 is open for ${year} any more` +
      (last === undefined ? '.' : `; the last of the three ran out ${stamp(last)}.`) +
      ' 25.25(a) is the default and it says the roll does not change.'
    );
  }

  const cites = open.map((route) => route.cite);
  const free = open.filter((route) => route.cost === null);
  const lead =
    `${year} is closed to protest, but not to correction: ${list(cites)} ` +
    `${cites.length === 1 ? 'is' : 'are'} still available.`;

  // Why a route is *shut* is the part worth carrying up here. It is the
  // sentence that explains a decision somebody already made, and it is the one
  // a firm needs before it settles the next protest the same way.
  const closed = bars.agreed
    ? ' Settling informally closed (c-1) and (d) for this year — a 1.111(e) agreement is final, ' +
      'and 25.25 will not reopen a value the owner agreed to.'
    : bars.determined
      ? ' The board determining this protest closed (c-1) and (d) for this year. It did not touch ' +
        '(c): 25.25(l) says that route survives a protest.'
      : bars.penalised
        ? ' The 22.28 penalty on this notice closed (c-1) for this year, which is the second and ' +
          'larger cost of a late rendition.'
        : '';

  const order =
    free.length > 0 && open.length > free.length
      ? ` Take ${list(free.map((route) => route.cite))} first — ${
          free.length === 1 ? 'it costs' : 'they cost'
        } nothing, where (d) carries a 10% late-correction penalty.`
      : '';

  return lead + closed + order;
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) ?? ''}`;
}

function dollars(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
