import type { FormOmission } from './form-50-144.js';

/**
 * What both 25.25 motions ask, asked once.
 *
 * The Comptroller publishes two correction motions and the repo models three
 * routes: Form 50-771 carries (c) and (c-1), Form 50-230 carries (d). They are
 * different documents — one selects among five statutory grounds and lists
 * taxing units, the other asserts a one-third over-appraisal and a paid tax
 * bill — but their first half is the same half. Both open in a named county
 * before a named appraisal review board, both identify the movant and the
 * property, and both recite the day the board certified the roll.
 *
 * That shared half lives here so the two forms cannot disagree about it, and
 * so the date arithmetic — which each form breaks into different blanks off the
 * same ISO string — is written once.
 */

/** Who is bringing the motion, and how to reach them afterwards. */
export interface MotionMovant {
  /** The property owner. Both forms print this as the movant. */
  ownerName: string;
  /** Printed name of whoever signs — the owner, or an agent under 1.111. */
  signerName: string | null;
  phone: string | null;
  /** Street line. The forms give the city/state/ZIP its own blank. */
  mailingAddress: string | null;
  cityStateZip: string | null;
  /** The date it is signed. A draft going out for signature has none. */
  signedOn: string | null;
  /** Whether a 50-162 designating us is on file, where an agent signs. */
  appointmentOnFile: boolean | null;
}

/** The property, the district it sits in, and the roll being corrected. */
export interface MotionSubject {
  /** The county. Every county blank on both forms takes this, not the district. */
  county: string | null;
  /** The district's own name, for what we say about the motion. */
  districtName: string | null;
  /** The account number. 50-771 asks for it; 50-230 calls it a parcel number. */
  accountId: string | null;
  description: string | null;
  /** Where the property is. Only 50-771 has a blank for it. */
  location: string | null;
  /** The tax year being corrected. */
  taxYear: number;
  /**
   * The day the ARB certified the roll, ISO.
   *
   * Both forms recite it and neither can be filled without it: the certified
   * roll is the thing a 25.25 motion asks to change, and the date is how the
   * board finds the roll it certified.
   */
  certifiedOn: string | null;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export interface CertificationDate {
  /** "14" — 50-771 gives the day its own blank. */
  day: string;
  /** "May" — spelled, because the blank sits between "day of" and the year. */
  month: string;
  /** "2026" */
  year: string;
  /** "May 14" — 50-230 runs the month and day together in one blank. */
  monthDay: string;
}

/**
 * Split an ISO date into the blanks the forms actually print.
 *
 * Parsed as UTC rather than local. A date read as local time in a US timezone
 * lands on the previous day, and the day is a blank on a document asking a
 * board to find one particular certified roll.
 */
export function certificationDate(iso: string): CertificationDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const at = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return null;
  const month = MONTHS[at.getUTCMonth()];
  if (month === undefined) return null;
  const day = String(at.getUTCDate());
  return { day, month, year: String(at.getUTCFullYear()), monthDay: `${month} ${day}` };
}

/**
 * The 25.26 warning both forms make the signer certify.
 *
 * Neither form asks whether the taxes were paid — 50-771 prints the
 * certification as a finished sentence, and 50-230 asserts it in the body. So
 * the signer certifies it by signing, and this is the only place anybody is
 * told what they just certified. 25.26(b) forfeits the right to a final
 * determination where the undisputed part of the bill went unpaid before the
 * delinquency date, which for an old year is a fact in the past that nobody in
 * this system can look up.
 */
export function taxesPaidCaution(taxYear: number): FormOmission {
  return {
    field: 'Tax Code 25.26',
    missing:
      `Signing this motion certifies compliance with Tax Code 25.26 for ${taxYear} — that the ` +
      'undisputed portion of the tax was paid before it became delinquent. Nothing in this file ' +
      'records whether it was, and 25.26(b) forfeits the right to a determination where it was ' +
      'not. Confirm it with the client before the motion goes out.',
    severity: 'warning',
  };
}
