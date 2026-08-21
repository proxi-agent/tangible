import type { RenditionExtension } from '@tangible/types';
import { deadlinesFor } from './deadlines.js';

/**
 * Which extension requests actually move a deadline.
 *
 * Tax Code 22.23(b) makes two different promises in two sentences, and treating
 * them alike is how a firm files late believing it had until May.
 *
 * A standard request made on or before the April deadline is not a favour: the
 * chief appraiser *shall* extend, so the extension exists whether or not the
 * district ever writes back, and the deadline moves the day the request goes
 * out. An additional fifteen days is discretion — *may*, for good cause shown —
 * and moves nothing until somebody grants it. The same standard request sent
 * one day late is the third case: it obliges nobody, and it is worth recording
 * anyway, because a district that grants it regardless is a fact you want in
 * writing.
 *
 * These live here rather than beside the table they read because they are the
 * statute, not the storage: pure functions over a request and a calendar, which
 * is what makes them testable and what keeps the rule in one place.
 */

/** The statutory pair every standing question is decided against. */
export interface StatutoryDates {
  /** Tax Code 22.23(a), observed onto the next business day. */
  dueOn: string;
  /** Tax Code 22.23(b)'s May 15, likewise observed. */
  extendedDueOn: string;
}

export function statutoryDates(taxYear: number): StatutoryDates {
  const deadlines = deadlinesFor(taxYear);
  const dateFor = (key: string, fallback: string) =>
    deadlines.find((deadline) => deadline.key === key)?.date ?? fallback;
  return {
    dueOn: dateFor('rendition-due', `${taxYear}-04-15`),
    extendedDueOn: dateFor('rendition-extended', `${taxYear}-05-15`),
  };
}

/**
 * Whether a request on file moves anything, and the sentence saying why.
 *
 * Every branch returns prose an operator can act on rather than a flag, because
 * the interesting cases are the ones where the answer is no: a request that
 * bought nothing looks identical to one that bought a month until somebody
 * reads the reason.
 */
export function extensionStanding(
  row: Pick<RenditionExtension, 'kind' | 'status' | 'requestedOn' | 'extendedTo'>,
  statutory: StatutoryDates,
): { inForce: boolean; standing: string } {
  if (row.status === 'void') {
    return { inForce: false, standing: 'Recorded in error and voided. It moves nothing.' };
  }
  if (row.status === 'superseded') {
    return {
      inForce: false,
      standing: 'Replaced by a later request of the same kind for this site and year.',
    };
  }
  if (row.status === 'denied') {
    return {
      inForce: false,
      standing: `The district refused the request of ${stamp(row.requestedOn)}. The deadline stands where it was.`,
    };
  }

  if (row.kind === 'standard') {
    const timely = row.requestedOn <= statutory.dueOn;
    if (timely) {
      return {
        inForce: true,
        standing:
          `Requested ${stamp(row.requestedOn)}, on or before the ${stamp(statutory.dueOn)} deadline. ` +
          `Under 22.23(b) the chief appraiser shall extend, so this return is due ${stamp(row.extendedTo)} ` +
          `whether or not the district writes back${row.status === 'granted' ? ' — and it has' : ''}.`,
      };
    }
    if (row.status === 'granted') {
      return {
        inForce: true,
        standing:
          `Requested ${stamp(row.requestedOn)}, after the ${stamp(statutory.dueOn)} deadline, so 22.23(b) ` +
          `obliged nobody — but the district granted it anyway. Due ${stamp(row.extendedTo)}.`,
      };
    }
    return {
      inForce: false,
      standing:
        `Requested ${stamp(row.requestedOn)}, after the ${stamp(statutory.dueOn)} deadline. 22.23(b) obliges ` +
        'the chief appraiser only where the request came first, so this buys nothing unless he grants ' +
        'it as a matter of grace. Treat the return as late until he does.',
    };
  }

  // Additional: discretionary, and outstanding means outstanding.
  if (row.status === 'granted') {
    return {
      inForce: true,
      standing: `The district granted the further days for cause. Due ${stamp(row.extendedTo)}.`,
    };
  }
  return {
    inForce: false,
    standing:
      `Sent ${stamp(row.requestedOn)}, no answer yet. The further fifteen days are discretionary under ` +
      '22.23(b), so nothing moves until the district says yes. Work to the May date.',
  };
}

/**
 * The deadline a return is actually working to, and what moved it.
 *
 * The latest in-force date wins rather than the newest row: a granted
 * additional extension runs past a standard one, and the two stand together
 * — the second is built on the first, not a replacement for it.
 */
export function operativeDeadline(
  extensions: readonly RenditionExtension[],
  statutoryDueOn: string,
): { dueOn: string; extension: RenditionExtension | null } {
  let best: RenditionExtension | null = null;
  for (const extension of extensions) {
    if (!extension.inForce) continue;
    if (extension.extendedTo <= statutoryDueOn) continue;
    if (best === null || extension.extendedTo > best.extendedTo) best = extension;
  }
  return { dueOn: best?.extendedTo ?? statutoryDueOn, extension: best };
}

/** An ISO date as a person reads it, in UTC so the day cannot slip. */
export function stamp(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
