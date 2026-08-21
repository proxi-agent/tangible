import { describe, expect, it } from 'vitest';
import {
  appointmentFor,
  appointmentStanding,
  coversLocation,
  effectiveAppointments,
  type AppointmentFacts,
} from './appointment.js';

/**
 * Every date here is asked *about a day*, not about today. "Were we appointed
 * when we signed this?" is a question about April 15, and an appointment that
 * lapsed in June must still answer yes.
 */
const FILING_DAY = '2027-04-15';

const appointment = (over: Partial<AppointmentFacts> = {}): AppointmentFacts => ({
  jurisdictionId: 'tx-harris',
  scope: 'listed',
  locationIds: ['plant'],
  signedOn: '2027-01-10',
  filedOn: '2027-01-14',
  endsOn: null,
  revokedOn: null,
  revokedReason: null,
  ...over,
});

describe('an appointment that has not reached the district', () => {
  it('authorises nothing, however recently it was signed', () => {
    const { effective, standing } = appointmentStanding(
      appointment({ filedOn: null, signedOn: FILING_DAY }),
      FILING_DAY,
    );
    expect(effective).toBe(false);
    expect(standing).toContain('not yet filed');
  });

  it('is not retroactive to the day it was signed', () => {
    // Signed in January, filed in March, asked about February.
    const row = appointment({ signedOn: '2027-01-10', filedOn: '2027-03-02' });
    expect(appointmentStanding(row, '2027-02-01').effective).toBe(false);
    expect(appointmentStanding(row, '2027-03-02').effective).toBe(true);
  });
});

describe('an appointment that has ended', () => {
  it('is dead once revoked, and alive before the revocation', () => {
    const row = appointment({ revokedOn: '2027-03-01', revokedReason: 'Client moved to Ryan.' });
    expect(appointmentStanding(row, '2027-02-28').effective).toBe(true);
    expect(appointmentStanding(row, '2027-03-01').effective).toBe(false);
    expect(appointmentStanding(row, FILING_DAY).standing).toContain('Ryan');
  });

  it('reads Step 5 as the day authority stops, not the last day it holds', () => {
    const row = appointment({ endsOn: FILING_DAY });
    expect(appointmentStanding(row, '2027-04-14').effective).toBe(true);
    expect(appointmentStanding(row, FILING_DAY).effective).toBe(false);
  });

  it('is revoked even where it was never filed, because that is the deader fact', () => {
    const row = appointment({ filedOn: null, revokedOn: '2027-02-01' });
    expect(appointmentStanding(row, FILING_DAY).standing).toContain('Revoked');
  });
});

describe('what Step 2 reaches', () => {
  it('covers only the sites the form lists', () => {
    const row = appointment({ locationIds: ['plant', 'office'] });
    expect(coversLocation(row, 'office')).toBe(true);
    expect(coversLocation(row, 'warehouse')).toBe(false);
  });

  it('covers everything under all-at-address, and says to check that it did', () => {
    const row = appointment({ scope: 'all-at-address', locationIds: [] });
    expect(coversLocation(row, 'anywhere')).toBe(true);
    expect(appointmentStanding(row, FILING_DAY).standing).toContain('above address');
  });
});

describe('finding the appointment a filing is made under', () => {
  it('stops at the district line', () => {
    const rows = [appointment({ jurisdictionId: 'tx-fort-bend' })];
    expect(appointmentFor(rows, { jurisdictionId: 'tx-harris', locationId: 'plant', on: FILING_DAY })).toBeNull();
  });

  it('takes the most recently signed where two are live, per 1.111(d)', () => {
    const older = appointment({ signedOn: '2026-01-05', filedOn: '2026-01-09' });
    const newer = appointment({ signedOn: '2027-01-10', filedOn: '2027-01-14' });
    const found = appointmentFor([older, newer], {
      jurisdictionId: 'tx-harris',
      locationId: 'plant',
      on: FILING_DAY,
    });
    expect(found?.signedOn).toBe('2027-01-10');
    // Both are still listed — the earlier one is displaced, not deleted.
    expect(
      effectiveAppointments([older, newer], {
        jurisdictionId: 'tx-harris',
        locationId: 'plant',
        on: FILING_DAY,
      }),
    ).toHaveLength(2);
  });

  it('does not fall back to an appointment for a different site', () => {
    const rows = [appointment({ locationIds: ['office'] })];
    expect(appointmentFor(rows, { jurisdictionId: 'tx-harris', locationId: 'plant', on: FILING_DAY })).toBeNull();
  });

  it('still answers yes about a filing day the appointment has since outlived', () => {
    const rows = [appointment({ endsOn: '2027-06-30' })];
    expect(appointmentFor(rows, { jurisdictionId: 'tx-harris', locationId: 'plant', on: FILING_DAY })).not.toBeNull();
    expect(appointmentFor(rows, { jurisdictionId: 'tx-harris', locationId: 'plant', on: '2027-07-01' })).toBeNull();
  });
});
