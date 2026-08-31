import type { CorrectionRouteKey } from '@tangible/types';
import type { FormFillChoice, FormFillText } from './fill-50-144.js';
import type { FormOmission } from './form-50-144.js';
import {
  certificationDate,
  taxesPaidCaution,
  type MotionMovant,
  type MotionSubject,
} from './fill-motion.js';
import { fillPinnedForm } from './fill-pdf.js';

/**
 * Fill the Comptroller's Form 50-230, Motion for Hearing to Correct One-Third
 * Over-Appraisal Error of Non-Residence Homestead Property — the (d) motion.
 *
 * 25.25(d) is the widest route back into a closed year and the narrowest test:
 * it reaches any appraisal more than a third over the correct value, whatever
 * the reason, and it reaches nothing else. A BPP account rendered from a fixed
 * asset register that double-counted a category is routinely over by more than
 * a third, which is why this form matters to the practice; a re-read of a
 * depreciation schedule almost never is.
 *
 * Three things about the form drive the design.
 *
 * **The one-third test is not on the paper.** The form asserts a one-third
 * over-appraisal and never asks for the numbers, so nothing printed would
 * betray a motion that does not meet it. `motionDraftBlocker` already computes
 * the test — as a fraction of the *correct* value, which is how (d) is written
 * — and this planner takes its answer rather than recomputing it, because two
 * implementations of one threshold is one more than can be kept right.
 *
 * **The movant blank is the chief appraiser's, and stays empty.** The opening
 * sentence names two possible movants — the chief appraiser, or the owner — and
 * gives each a blank. An owner-side motion fills the owner's and leaves the
 * appraiser's alone. Writing the client's name into `MOname` would file a
 * motion claiming they are the district's chief appraiser.
 *
 * **The 10% penalty is the cost of winning.** 25.25(d-1) charges a
 * late-correction penalty of ten percent of the tax on the corrected value, so
 * a (d) correction that succeeds still costs a tenth of the corrected bill.
 * That is a number the client should hear before the motion is filed and not
 * after, and it is printed at the foot of the form where nobody reads it.
 */

/** The pinned revision. */
export const FORM_50230_REVISION = '50-230 · 11-21/8';

/** SHA-256 of `assets/50-230.pdf` as downloaded from comptroller.texas.gov. */
export const FORM_50230_SHA256 = 'f8eb4980cc9daa2629521a7ee17616c1444ebbd68c75cb21c56cd2fba99a9e90';

export interface OverAppraisalFillInput {
  /** Which subsection the board is being asked under. (c) and (c-1) have 50-771. */
  route: CorrectionRouteKey;
  movant: MotionMovant;
  subject: MotionSubject;
  /** The taxing units the property sits in. */
  taxingUnits: readonly string[];
  /** The over-appraisal, in the firm's own words. */
  errors: string | null;
  /**
   * Whether the one-third test is met, from the caller that already computed it.
   *
   * Null where nobody has run it. Null blocks exactly as false does: this form
   * asserts the test in its own body, so filing it without an answer is signing
   * an assertion nobody checked.
   */
  overByOneThird: boolean | null;
  /** What the roll says, for the caution. Not a blank on this form. */
  rolledValue: number | null;
  /** What the firm asserts the value should be. Not a blank on this form. */
  claimedValue: number | null;
}

export interface OverAppraisalFillPlan {
  revision: string;
  blocked: string | null;
  text: readonly FormFillText[];
  choices: readonly FormFillChoice[];
  omissions: readonly FormOmission[];
}

/** Roughly what the error box holds, measured off the printed page. */
const ERRORS_BOX = 480;

/** 25.25(d-1)'s late-correction penalty, as a share of the corrected tax. */
const LATE_CORRECTION_PENALTY = 0.1;

export function planOverAppraisalFill(input: OverAppraisalFillInput): OverAppraisalFillPlan {
  const { movant, subject } = input;
  const text: FormFillText[] = [];
  const omissions: FormOmission[] = [];

  const put = (field: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== '') text.push({ field, value });
  };
  const omit = (
    field: string,
    missing: string,
    severity: FormOmission['severity'] = 'warning',
  ): void => {
    omissions.push({ field, missing, severity });
  };

  let blocked: string | null = null;

  // ---- The route and the test ---------------------------------------------

  if (input.route !== 'd') {
    blocked =
      `This is a 25.25(${input.route}) motion and Form 50-230 is the (d) motion. Use Form ` +
      '50-771, which selects among the grounds (c) and (c-1) actually list.';
    omit('Form', blocked, 'blocking');
  }
  if (input.overByOneThird !== true) {
    const reason =
      input.overByOneThird === false
        ? 'The one-third test does not pass on the values on file.'
        : 'Nobody has run the one-third test for this year.';
    blocked = blocked ?? reason;
    omit(
      'One-third test',
      `${reason} The form's body asserts a one-third over-appraisal, so signing it says the ` +
        'test passed. 25.25(d) measures the error against the correct value, not the rolled one.',
      'blocking',
    );
  }

  // ---- Who, where, which property ----------------------------------------

  if (subject.county === null) {
    blocked = blocked ?? 'No county named for the board this motion is filed with.';
    omit(
      'CO',
      `The motion opens "In the County of ______" and none is recorded for ` +
        `${subject.districtName ?? 'this district'}.`,
      'blocking',
    );
  }
  put('CO', subject.county);
  put('COap', subject.county);
  // One field, two widgets: the district blank in the opening sentence and the
  // one in "located within the ______ County Appraisal District". Both take the
  // county, because the form has already printed the other two words itself.
  put('COname', subject.county);
  // `MOname` is the chief appraiser's blank. See the note at the top.

  if (!movant.ownerName) {
    blocked = blocked ?? 'No movant named.';
    omit('PropNm', 'The motion has no property owner on it.', 'blocking');
  }
  put('PropNm', movant.ownerName);
  put('PropDes', subject.description);
  put('Parcel', subject.accountId);
  if (subject.description === null && subject.accountId === null) {
    blocked = blocked ?? 'Nothing on the motion identifies the property.';
    omit(
      'PropDes',
      'No property description and no account number. The board corrects a line on the roll and ' +
        'cannot find the line.',
      'blocking',
    );
  }

  // ---- The certified roll and the year ------------------------------------

  const certified = subject.certifiedOn === null ? null : certificationDate(subject.certifiedOn);
  if (certified === null) {
    blocked = blocked ?? 'No certification date for the roll being corrected.';
    omit(
      'MonDy',
      'The motion recites the day this board certified the roll, and none is on file.',
      'blocking',
    );
  } else {
    put('MonDy', certified.monthDay);
    put('Year', certified.year);
  }
  put('TxYr', String(subject.taxYear));
  put('TxUn', input.taxingUnits.join(', '));
  if (input.taxingUnits.length === 0) {
    omit(
      'TxUn',
      'No taxing units listed. The board notifies the presiding officer of each one of the ' +
        'hearing, so an empty line is a hearing they are not told about.',
    );
  }

  // ---- What is wrong ------------------------------------------------------

  if (input.errors === null || input.errors.trim() === '') {
    blocked = blocked ?? 'The motion does not state the over-appraisal.';
    omit(
      'ErrDes',
      'The form asks the movant to state the one-third over-appraisal error, and the line is ' +
        'empty. That sentence is the motion; the rest is the caption.',
      'blocking',
    );
  } else {
    put('ErrDes', input.errors.trim());
    if (input.errors.trim().length > ERRORS_BOX) {
      omit(
        'ErrDes',
        `The statement runs to ${input.errors.trim().length} characters and the printed box ` +
          `holds about ${ERRORS_BOX}. The rest is in the file and not on the paper.`,
      );
    }
  }

  // ---- Signature block ----------------------------------------------------

  put('Date', movant.signedOn);
  put('Auth', movant.signerName);
  put('Phone', movant.phone);
  put('Mail', movant.mailingAddress);
  put('Add', movant.cityStateZip);
  if (movant.signerName === null) {
    omit('Auth', 'Nobody is named as signing. The form prints the name beneath the signature.');
  }
  if (movant.mailingAddress === null || movant.cityStateZip === null) {
    omit('Mail', 'No mailing address for the movant, which is where the board writes.');
  }
  if (movant.appointmentOnFile === false) {
    blocked = blocked ?? 'Signed as agent with no appointment on file.';
    omit(
      'Sig',
      'This motion is signed as agent and no Form 50-162 has been filed with the district. ' +
        'Under 1.111(a) the district need not recognise the signature until it has one.',
      'blocking',
    );
  }

  // ---- What winning costs -------------------------------------------------

  omissions.push(taxesPaidCaution(subject.taxYear));
  omissions.push({
    field: 'Tax Code 25.25(d-1)',
    missing: penaltyCaution(input.rolledValue, input.claimedValue),
    severity: 'warning',
  });

  return { revision: FORM_50230_REVISION, blocked, text, choices: [], omissions };
}

/**
 * What the (d-1) penalty costs, as a share of what the motion wins.
 *
 * The penalty is ten percent of the *tax* on the corrected value, and this
 * module has no rate. It does not need one. The saving is the tax on the
 * reduction and the penalty is a tenth of the tax on the corrected value, so
 * the rate cancels and the ratio between them is a pure number: ten percent of
 * the corrected value over the reduction.
 *
 * That ratio has a ceiling worth knowing. 25.25(d) only reaches an error
 * exceeding a third of the correct value, so the reduction is always more than
 * a third of the claimed value and the penalty is always under thirty percent
 * of the saving — highest on a motion that barely clears the test, and falling
 * from there. A (d) motion is never a loss on these numbers; it is just never
 * worth as much as the reduction says.
 */
function penaltyCaution(rolledValue: number | null, claimedValue: number | null): string {
  const base =
    'A correction under 25.25(d) carries a late-correction penalty of ' +
    `${LATE_CORRECTION_PENALTY * 100} percent of the tax on the corrected value, under (d-1), ` +
    'owed to each affected taxing unit whether or not the motion was the client’s idea.';
  if (claimedValue === null) return base;
  if (rolledValue === null || rolledValue <= claimedValue) {
    return `${base} Here it runs on the tax on ${money(claimedValue)}.`;
  }
  const share = Math.round(
    ((LATE_CORRECTION_PENALTY * claimedValue) / (rolledValue - claimedValue)) * 100,
  );
  return (
    `${base} Here it runs on the tax on ${money(claimedValue)} against a reduction of ` +
    `${money(rolledValue - claimedValue)} — the rate cancels, so the penalty takes about ` +
    `${share} percent of whatever this motion saves. Tell the client that before filing.`
  );
}

export async function renderForm50230(plan: OverAppraisalFillPlan): Promise<Uint8Array> {
  if (plan.blocked !== null) {
    throw new Error(
      `Refusing to fill Form 50-230: ${plan.blocked} The form asserts in its own body what this ` +
        'motion would not have established, and the signer is the one asserting it.',
    );
  }
  return fillPinnedForm({
    template: new URL('../assets/50-230.pdf', import.meta.url),
    formLabel: 'Form 50-230',
    revision: FORM_50230_REVISION,
    text: plan.text,
    choices: plan.choices,
    driftHint: 're-read the form before filing anything from it.',
  });
}

function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}
