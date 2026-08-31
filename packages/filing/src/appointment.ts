import type { AppointmentScope } from '@tangible/types';
import { stamp } from './extensions.js';

/**
 * Whether we may act for a client, where, and on what.
 *
 * Form 50-162's own instructions decide almost all of this, and they are
 * stricter than the single date the filing profile used to carry:
 *
 *   > This designation will not take effect until filed with the appropriate
 *   > appraisal district. Once effective, this designation will be in effect
 *   > until the earlier of (1) the date of a written revocation filed with the
 *   > appraisal district by the owner or the owner's designated agent, or
 *   > (2) the expiration date, if any, designated below.
 *
 * So an appointment has three ways to be worth nothing — unfiled, revoked,
 * expired — and one more that nobody tells us about: under Tax Code 1.111(d) a
 * property owner may not designate two agents for one item of property, and a
 * new designation revokes the previous one for that property automatically.
 *
 * These are pure functions over a row and a date for the same reason the
 * extension rules are: the question "were we appointed on the day we signed
 * this rendition" has to be answerable about the past, not just about today.
 */

/** The facts an appointment's standing is decided from. */
export interface AppointmentFacts {
  jurisdictionId: string;
  scope: AppointmentScope;
  locationIds: readonly string[];
  signedOn: string;
  filedOn: string | null;
  endsOn: string | null;
  revokedOn: string | null;
  revokedReason: string | null;
}

export interface AppointmentStanding {
  effective: boolean;
  standing: string;
}

/**
 * Whether this appointment authorises anything on a given date, and why.
 *
 * Prose rather than a flag, because "no" has four different remedies: file it,
 * wait, get it re-signed, or find out who revoked it. The order of the branches
 * is the order of decisiveness — a revoked appointment is dead whether or not
 * it was ever filed.
 */
export function appointmentStanding(row: AppointmentFacts, on: string): AppointmentStanding {
  if (row.revokedOn && row.revokedOn <= on) {
    return {
      effective: false,
      standing:
        `Revoked ${stamp(row.revokedOn)}.` +
        (row.revokedReason ? ` ${row.revokedReason}` : '') +
        ' A revocation filed with the district ends the designation under 1.111(c).',
    };
  }
  if (!row.filedOn) {
    return {
      effective: false,
      standing:
        `Signed ${stamp(row.signedOn)} and not yet filed with the district. The form is explicit ` +
        'that a designation takes effect only when the appraisal district has it, so this ' +
        'authorises nothing until it goes in.',
    };
  }
  if (row.filedOn > on) {
    return {
      effective: false,
      standing: `Not filed with the district until ${stamp(row.filedOn)}, which is after ${stamp(on)}.`,
    };
  }
  // Conservative on purpose. The form says the designation runs "until the date
  // indicated", which could mean through that day or up to it. Reading it as
  // the day authority stops costs at most a day of filing early; the other
  // reading risks swearing to a rendition unappointed, which Form 50-162 itself
  // points at Penal Code 37.10 for.
  if (row.endsOn && on >= row.endsOn) {
    return {
      effective: false,
      standing:
        `Expired ${stamp(row.endsOn)}, the date Step 5 gave. Read as the day authority stops ` +
        'rather than the last day it holds, which is the safe way round.',
    };
  }
  return {
    effective: true,
    standing:
      `Signed ${stamp(row.signedOn)}, filed with the district ${stamp(row.filedOn)}` +
      (row.endsOn ? `, and runs until ${stamp(row.endsOn)}` : ' and runs until revoked') +
      '.' +
      (row.scope === 'all-at-address'
        ? ' Step 2 granted authority over "all property listed for me at the above address" — the ' +
          "owner's own mailing address. Where the property sits somewhere else, which is the " +
          'ordinary case for business personal property, it is worth confirming with the district ' +
          'that this reached the accounts you mean.'
        : ''),
  };
}

/** Whether the form's Step 2 reaches a particular site. */
export function coversLocation(row: AppointmentFacts, locationId: string): boolean {
  return row.scope === 'all-at-address' || row.locationIds.includes(locationId);
}

export interface AppointmentQuery {
  jurisdictionId: string;
  locationId: string;
  /** The date the authority is being asked about — a filing date, not today. */
  on: string;
}

/**
 * Every appointment that authorises this site on this date, the governing one
 * first.
 *
 * More than one can be live at once — a renewal signed before the old one
 * lapsed, or a second form adding a site. The most recently signed governs,
 * and that is not a tidiness preference: 1.111(d) says the designation of an
 * agent for an item of property revokes any previous designation for that
 * property, so the later form has already displaced the earlier one by the time
 * anybody reads this.
 */
export function effectiveAppointments<T extends AppointmentFacts>(
  rows: readonly T[],
  query: AppointmentQuery,
): T[] {
  return rows
    .filter(
      (row) =>
        row.jurisdictionId === query.jurisdictionId &&
        coversLocation(row, query.locationId) &&
        appointmentStanding(row, query.on).effective,
    )
    .sort((a, b) => b.signedOn.localeCompare(a.signedOn));
}

/** The one appointment a filing for this site would be made under, if any. */
export function appointmentFor<T extends AppointmentFacts>(
  rows: readonly T[],
  query: AppointmentQuery,
): T | null {
  return effectiveAppointments(rows, query)[0] ?? null;
}

/**
 * The appointment a filing should point at, whether or not it authorises
 * anything: the governing one if there is one, otherwise the closest we hold.
 *
 * "We have no Form 50-162 for this client" and "one was signed three weeks ago
 * and is still on somebody's desk" are the same blocker with entirely different
 * remedies, and the second is much the more common. Non-effective candidates
 * are ranked by how recently they were signed, which is the one somebody is
 * most likely to be waiting on.
 */
export function nearestAppointment<T extends AppointmentFacts>(
  rows: readonly T[],
  query: AppointmentQuery,
): T | null {
  const matching = rows
    .filter(
      (row) => row.jurisdictionId === query.jurisdictionId && coversLocation(row, query.locationId),
    )
    .sort((a, b) => b.signedOn.localeCompare(a.signedOn));
  return (
    matching.find((row) => appointmentStanding(row, query.on).effective) ?? matching[0] ?? null
  );
}
