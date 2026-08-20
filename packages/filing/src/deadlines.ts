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
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() + 2);
  if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function deadlinesFor(taxYear: number): FilingDeadline[] {
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
