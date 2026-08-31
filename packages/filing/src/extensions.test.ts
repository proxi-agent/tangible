import { describe, expect, it } from 'vitest';
import type { RenditionExtension } from '@tangible/types';
import { extensionStanding, operativeDeadline, statutoryDates } from './extensions.js';

/**
 * 2027 is the season the app is being used for, and its dates are awkward in a
 * useful way: April 15 is a Thursday, but May 15 falls on a Saturday, so the
 * extended deadline is observed on Monday May 17. Anything that hard-coded the
 * 15th would pass on a different year and quietly be a day early here.
 */
const STATUTORY = statutoryDates(2027);

type Request = Pick<RenditionExtension, 'kind' | 'status' | 'requestedOn' | 'extendedTo'>;

const standard = (over: Partial<Request> = {}): Request => ({
  kind: 'standard',
  status: 'requested',
  requestedOn: '2027-04-13',
  extendedTo: STATUTORY.extendedDueOn,
  ...over,
});

describe('the statutory dates', () => {
  it('observes a weekend deadline onto the next business day', () => {
    expect(STATUTORY.dueOn).toBe('2027-04-15');
    // May 15 2027 is a Saturday.
    expect(STATUTORY.extendedDueOn).toBe('2027-05-17');
  });
});

describe('a standard request', () => {
  it('moves the deadline the day it goes out, with no answer from the district', () => {
    const { inForce, standing } = extensionStanding(standard(), STATUTORY);
    expect(inForce).toBe(true);
    expect(standing).toContain('shall extend');
  });

  it('still counts when sent on the deadline itself', () => {
    expect(extensionStanding(standard({ requestedOn: '2027-04-15' }), STATUTORY).inForce).toBe(
      true,
    );
  });

  it('buys nothing when it is late, because 22.23(b) obliges nobody', () => {
    // The whole reason `requestedOn` is a date rather than a timestamp: this is
    // one day, and it is the difference between an extension and a penalty.
    const { inForce, standing } = extensionStanding(
      standard({ requestedOn: '2027-04-16' }),
      STATUTORY,
    );
    expect(inForce).toBe(false);
    expect(standing).toContain('late');
  });

  it('counts a late request the district granted anyway', () => {
    const late = standard({ requestedOn: '2027-04-16', status: 'granted' });
    expect(extensionStanding(late, STATUTORY).inForce).toBe(true);
  });
});

describe('an additional request', () => {
  const additional = (over: Partial<Request> = {}): Request =>
    standard({ kind: 'additional', extendedTo: '2027-06-01', ...over });

  it('moves nothing while it is outstanding, because the further days are discretionary', () => {
    const { inForce, standing } = extensionStanding(additional(), STATUTORY);
    expect(inForce).toBe(false);
    expect(standing).toContain('discretionary');
  });

  it('moves the deadline once granted', () => {
    expect(extensionStanding(additional({ status: 'granted' }), STATUTORY).inForce).toBe(true);
  });
});

describe('a request that is no longer live', () => {
  for (const status of ['denied', 'superseded', 'void'] as const) {
    it(`${status} moves nothing`, () => {
      expect(extensionStanding(standard({ status }), STATUTORY).inForce).toBe(false);
    });
  }
});

describe('the operative deadline', () => {
  const extension = (over: Partial<RenditionExtension>): RenditionExtension =>
    ({
      id: 'x',
      engagementId: 'e',
      locationId: 'l',
      locationLabel: 'Plant',
      accountId: null,
      taxYear: 2027,
      kind: 'standard',
      status: 'requested',
      requestedOn: '2027-04-13',
      method: 'certified-mail',
      confirmation: null,
      reason: null,
      note: null,
      extendedTo: STATUTORY.extendedDueOn,
      answeredOn: null,
      answerNote: null,
      inForce: true,
      standing: '',
      ...over,
    }) as RenditionExtension;

  it('is the statutory date when nothing has been asked for', () => {
    expect(operativeDeadline([], STATUTORY.dueOn).dueOn).toBe('2027-04-15');
  });

  it('ignores a request that is on file but not in force', () => {
    const result = operativeDeadline([extension({ inForce: false })], STATUTORY.dueOn);
    expect(result.dueOn).toBe('2027-04-15');
    expect(result.extension).toBeNull();
  });

  it('takes the latest date in force, not the newest row', () => {
    // A granted additional extension is built on the standard one rather than
    // replacing it, so both stand and the later date is the operative one.
    const result = operativeDeadline(
      [
        extension({ kind: 'additional', status: 'granted', extendedTo: '2027-06-01' }),
        extension({}),
      ],
      STATUTORY.dueOn,
    );
    expect(result.dueOn).toBe('2027-06-01');
    expect(result.extension?.kind).toBe('additional');
  });

  it('names the extension that produced the date, so a board can say why', () => {
    const result = operativeDeadline([extension({})], STATUTORY.dueOn);
    expect(result.dueOn).toBe('2027-05-17');
    expect(result.extension?.id).toBe('x');
  });
});
