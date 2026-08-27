/**
 * What day it is, where the deadlines are.
 *
 * Every date in this app is a *calendar* date under the Texas Tax Code — a
 * rendition is due April 15th, a protest lands within thirty days of a notice.
 * None of those are instants, and none of them care what UTC thinks.
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date, which is the right
 * answer for about eighteen hours a day and the wrong one for the other six.
 * Vercel's clock is UTC, so from 7pm Central onward (6pm under standard time)
 * the deployed app believes it is already tomorrow: a return due today reads
 * as overdue while the filer still has five hours, a "filed on" field
 * pre-fills with a date that has not happened yet, and a notice recorded on
 * the evening it arrived starts its thirty-day clock a day early.
 *
 * There is a second failure that is easier to see: a `useState` initializer
 * calling this runs once on the server and again in the browser. With the
 * server on UTC and the practitioner on Central those two disagree for that
 * same six-hour window, and React hydrates a date input with one value over
 * markup containing another. Pinning both sides to one zone settles it.
 *
 * Arithmetic still happens in UTC — see `daysUntil` — because subtracting two
 * UTC midnights is the only way to get whole days without a DST hour ruining
 * the division. It is the *anchor* that has to be local, not the subtraction.
 */

/**
 * The practice's zone, not the viewer's.
 *
 * A Harris County deadline expires on Harris County's clock. A practitioner
 * reviewing the season board from a hotel in London should see the same day
 * remaining that their colleague in Houston sees, so this is deliberately a
 * fixed zone rather than `Intl.DateTimeFormat().resolvedOptions().timeZone`.
 * Texas is one zone; revisit this when the product is not.
 */
export const PRACTICE_TIME_ZONE = 'America/Chicago';

/**
 * `en-CA` formats as YYYY-MM-DD, which is the ISO date this app passes around
 * everywhere. Built once — constructing a formatter is not free and this is
 * called per row on the season board.
 */
const isoDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: PRACTICE_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's calendar date in the practice's zone, as `YYYY-MM-DD`. */
export function today(at: Date = new Date()): string {
  return isoDate.format(at);
}

/** The calendar year in the practice's zone — the tax year a season defaults to. */
export function currentYear(at: Date = new Date()): number {
  return Number(today(at).slice(0, 4));
}

/**
 * Whole days from today to an ISO date.
 *
 * Both sides are read as UTC midnights so the difference is exact days with no
 * DST remainder; only the near side is anchored to the practice's zone.
 * Negative means the date is behind us.
 */
export function daysUntil(iso: string, at: Date = new Date()): number {
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today(at)}T00:00:00Z`)) / 86_400_000,
  );
}
