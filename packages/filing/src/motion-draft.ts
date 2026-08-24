import type {
  CorrectionRoute,
  CorrectionRouteKey,
  MotionDraftFacts,
  OpenYear,
} from '@tangible/types';

/**
 * The checks that stand between an open year and a drafted motion.
 *
 * The open-years board already answers whether a route is open in general.
 * What it cannot answer — because it does not know what value the firm will
 * claim — is whether the route is open for *this* motion. 25.25(d) is the
 * whole reason: the route reaches only an appraisal that exceeds the correct
 * value by more than a third, so a (d) motion is not checkable until the firm
 * has said what the correct value is. That test lives here, computed the way
 * (d) is written — as a fraction of the correct value, not of the rolled one.
 *
 * Everything refused here is refused before a model runs, so a blocked draft
 * costs nothing and explains itself.
 */

/** 25.25(d): the error must exceed one-third of the correct value. */
const D_THRESHOLD = 1 / 3;

/** Why a motion cannot be drafted for this year and route, or null when it can. */
export function motionDraftBlocker(
  year: OpenYear,
  routeKey: CorrectionRouteKey,
  claimedValue: number,
): string | null {
  const route = year.outlook.routes.find((entry) => entry.key === routeKey);
  if (!route) {
    return `The outlook for ${year.taxYear} does not compute a ${routeKey} route.`;
  }
  if (!route.open) {
    return route.barred ?? `${route.cite} has closed for ${year.taxYear}.`;
  }
  if (year.rolledValue !== null && claimedValue >= year.rolledValue) {
    return (
      `The claimed value must be below the ${money(year.rolledValue)} on the roll — ` +
      'a correction that does not lower the value corrects nothing this motion can argue.'
    );
  }
  if (routeKey === 'd') {
    if (year.rolledValue === null) {
      return (
        '25.25(d) reaches only a value more than a third over the correct one, and no ' +
        'rolled value is on file to measure that against. Record the notice first.'
      );
    }
    // As (d) is written: the error over the *correct* value, not the rolled one.
    const error = year.rolledValue - claimedValue;
    if (claimedValue === 0 ? false : error / claimedValue <= D_THRESHOLD) {
      return (
        `25.25(d) needs the roll to exceed the correct value by more than a third; ` +
        `${money(year.rolledValue)} over a claimed ${money(claimedValue)} is ` +
        `${Math.round((error / claimedValue) * 100)}%, which does not reach it.`
      );
    }
  }
  return null;
}

/**
 * The facts the drafter argues from, frozen at draft time.
 *
 * Assumes the blocker returned null. Carries the outlook's own prose for the
 * year because that is where the caveats live — an uploaded year's routes are
 * computed without knowing whether the year was settled on the phone, and the
 * draft's cautions have to be able to say so.
 */
export function assembleMotionDraftFacts(
  clientName: string,
  year: OpenYear,
  routeKey: CorrectionRouteKey,
  claimedValue: number,
  ground: string,
): MotionDraftFacts {
  const route = year.outlook.routes.find((entry) => entry.key === routeKey) as CorrectionRoute;
  return {
    clientName,
    taxYear: year.taxYear,
    label: year.label,
    accountId: year.accountId,
    districtName: year.districtName,
    source: year.source,
    rolledValue: year.rolledValue,
    claimedValue,
    reduction: year.rolledValue !== null ? year.rolledValue - claimedValue : null,
    ground: ground.trim(),
    route: {
      key: route.key,
      cite: route.cite,
      label: route.label,
      grounds: route.grounds,
      deadline: route.deadline,
      cost: route.cost,
    },
    yearStanding: year.outlook.standing,
    priorMotions: year.motions.map((motion) => ({
      filedOn: motion.filedOn,
      route: motion.route,
      standing: motion.standing.standing,
    })),
  };
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
