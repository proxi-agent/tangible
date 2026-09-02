import type { FilingDeadline } from '@tangible/types';

/**
 * The statutory calendar for a Texas rendition season.
 *
 * Dates are computed rather than listed because they move with the year, and
 * each one carries the statute it comes from — a deadline without its basis is
 * something nobody can check and nobody will trust when it matters.
 *
 * One rule here is easy to get wrong and expensive: a granted rendition
 * extension now pulls the Freeport and interstate-allocation applications along
 * with it to May 15 (SB 1352). Filing the extension therefore buys time on more
 * than the rendition, and a calendar that showed April 30 regardless would send
 * someone scrambling for no reason.
 */

/** Statutory dates land on the next business day when they fall on a weekend. */
function observed(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return observedDate(date.toISOString().slice(0, 10));
}

/**
 * The same rule applied to a date already computed.
 *
 * Tax Code 1.06 is general — any act whose last day falls on a weekend is
 * timely on the next business day — so it governs the dates this file lists
 * *and* the ones counted off an event, like the thirty days a notice of
 * appraised value starts running. Exported for the second kind; the calendar
 * below uses the wrapper above.
 */
export function observedDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * The statutory calendar, per state.
 *
 * Texas stays the default because every existing caller meant Texas and none of
 * them should silently change answer. What Florida proves is that a calendar is
 * not a set of dates with the state's name swapped in: the *shape* differs.
 * The extension is the trap rather than the example: Texas must grant one on
 * request and so must Florida, because s. 193.063's first sentence is a "shall"
 * exactly like 22.23(b)'s. Where the shape really differs is everywhere else.
 * Texas prices lateness at a flat 10%; Florida runs 5% a month to 25% and adds
 * a separate 15% on property never disclosed. The Florida protest clock does
 * not start on a calendar date at all — it runs 25 days from the TRIM notice,
 * which the county mails when it mails. And a Florida return filed late
 * forfeits the appeal itself under s. 194.034(1)(j), which Texas has no
 * analogue for: a Texas non-filer protests from a worse position, a Florida
 * one does not protest at all.
 *
 * A state nobody has researched gets an empty calendar rather than Texas's. An
 * empty list reads on screen as "no dates loaded"; a wrong list reads as April
 * 15, and somebody plans around it.
 */
export function deadlinesFor(
  taxYear: number,
  jurisdictionId: string | null = null,
): FilingDeadline[] {
  if (jurisdictionId === null || jurisdictionId.startsWith('tx-')) return texasDeadlines(taxYear);
  if (jurisdictionId === 'fl' || jurisdictionId.startsWith('fl-')) return floridaDeadlines(taxYear);
  return [];
}

/**
 * Florida's tangible personal property season.
 *
 * Three dates and one that cannot be computed. April 1 is the return deadline
 * under s. 193.062; the extension under s. 193.063 is mandatory for its first
 * 30 days and discretionary for a further 15, the same two-part shape as the
 * Texas one; s. 193.072 penalties compound monthly rather than landing flat. The TRIM notice is the one that matters most to a protest and
 * the one this calendar cannot print, because the mailing date is the county's
 * and the 25 days run from it — so it appears as a dated-when-it-arrives entry
 * rather than as a guess, and the notice intake is what fills it in.
 */
function floridaDeadlines(taxYear: number): FilingDeadline[] {
  return [
    {
      key: 'assessment-date',
      label: 'Property counted as of this date',
      date: `${taxYear}-01-01`,
      basis:
        's. 192.042(2), F.S. — tangible personal property is assessed at its value on January 1. The same January 1 rule as Texas, from a different statute.',
    },
    {
      key: 'return-due',
      label: 'DR-405 tangible personal property return due',
      date: observed(taxYear, 4, 1),
      basis:
        's. 193.062, F.S. Two weeks earlier than the Texas rendition, and the deadline a firm working both states will miss first.',
    },
    {
      key: 'extension-request',
      label: 'Last day to request an extension',
      date: observed(taxYear, 4, 1),
      basis:
        's. 193.063, F.S. makes two promises, not one: the property appraiser *shall* grant 30 days, and *may* grant up to 15 more at discretion. The first is not a favour and cannot be refused, so a granted request lands the return on May 1. The difference from Texas is not discretion but timing — the statute requires the request to reach the appraiser in time to be considered and acted on *before* April 1, and a county may require it up to 10 days ahead, so a request sent on the deadline itself may be too late to act on.',
    },
    {
      key: 'trim-notice',
      label: 'TRIM notice of proposed property taxes',
      date: null,
      basis:
        's. 200.069, F.S. Mailed in August, on a date the county sets. The petition clock runs 25 days from this notice, so the date is recorded when the notice arrives rather than predicted here.',
    },
    {
      key: 'protest',
      label: 'VAB petition deadline',
      date: null,
      basis:
        's. 194.011(3), F.S.: a DR-486 petition within 25 days of the TRIM notice. Filing a timely return is a precondition for contesting the assessment at all, which makes the April 1 date above do double duty.',
    },
  ];
}

function texasDeadlines(taxYear: number): FilingDeadline[] {
  return [
    {
      key: 'assessment-date',
      label: 'Property counted as of this date',
      date: `${taxYear}-01-01`,
      basis:
        'Tax Code 22.01 renders what was owned and in place on January 1. Anything disposed of before then does not belong on the form, and anything bought after it waits a year.',
    },
    {
      key: 'rendition-due',
      label: 'Rendition due',
      date: observed(taxYear, 4, 15),
      basis: 'Tax Code 22.23(a). A late rendition draws a 10% penalty on the taxes due (22.28).',
    },
    {
      key: 'extension-request',
      label: 'Last day to request an extension',
      date: observed(taxYear, 4, 15),
      basis:
        'Tax Code 22.23(b): a written request on or before the due date moves the deadline to May 15, and the chief appraiser may add 15 more days for good cause.',
    },
    {
      key: 'freeport',
      label: 'Freeport exemption application',
      date: observed(taxYear, 4, 30),
      basis:
        'Tax Code 11.251/11.4391. A granted rendition extension carries this to May 15 as well (SB 1352). Late applications still capture part of the exemption, so a missed date is not the end of it.',
    },
    {
      key: 'rendition-extended',
      label: 'Extended rendition deadline',
      date: observed(taxYear, 5, 15),
      basis: 'Tax Code 22.23(b), where an extension was requested by the original due date.',
    },
    {
      key: 'protest',
      label: 'Protest deadline',
      date: observed(taxYear, 5, 15),
      basis:
        'Tax Code 41.44: the later of May 15 or 30 days after the notice of appraised value was delivered. A good faith estimate given on the rendition is inadmissible later except in a 41.41 protest.',
    },
  ];
}
