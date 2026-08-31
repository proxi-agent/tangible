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
 * Fill the Comptroller's Form 50-771, Property Owner's Motion for Correction of
 * Appraisal Roll — the (c) and (c-1) motion.
 *
 * The open-years board computes whether a year can be reopened and the draft
 * agent argues why it should be; this is the paper that asks. Until now the
 * highest-value thing the practice does for a new client — the years already
 * gone — printed as a letter, and a letter is not a motion under 25.25.
 *
 * Two things about the form drive the design.
 *
 * **The ground selector is not a checkbox list.** Its five options share one
 * field name and differ only by appearance state, which is how a PDF spells a
 * radio group without saying so. Exactly one may be chosen, and choosing badly
 * is invisible: `fill-pdf.ts` carries the machinery, and this planner carries
 * the rule that a motion states one ground. Where the firm has two grounds it
 * files two motions, because the board rules on the ground it was given.
 *
 * **Every county blank is the county.** Field 16 sits in the printed sentence
 * "located within the ______ Appraisal District", so the district's own name
 * goes in with the trailing "Appraisal District" removed — "Harris Central",
 * not "Harris Central Appraisal District", which would print the words twice,
 * and not "Harris", which names an entity that does not exist. The 91 districts
 * that do not end in those two words are the interesting case and they warn.
 */

/** The pinned revision. */
export const FORM_50771_REVISION = '50-771 · 1-22/8';

/** SHA-256 of `assets/50-771.pdf` as downloaded from comptroller.texas.gov. */
export const FORM_50771_SHA256 = '91771433b3e33c1aa0ea963f2c69f00738587b658ac9a65dc284e047f35e359f';

/**
 * The five grounds 25.25(c) and (c-1) reach, in the order the form prints them.
 *
 * `omitted-tpp` is the one a BPP practice files most: 25.25(c-1) lets an owner
 * reach back three years for property wrongly included in — or omitted from — a
 * rendition, which is exactly the error a mis-scheduled register produces.
 */
export const MOTION_GROUNDS = [
  /** 25.25(c)(1): a clerical error affecting liability. */
  'clerical',
  /** 25.25(c)(2): multiple appraisals of one property. */
  'multiple-appraisals',
  /** 25.25(c)(3): property that does not exist in that form or at that place. */
  'non-existent',
  /** 25.25(c)(4): an error of ownership. */
  'ownership',
  /** 25.25(c-1): an error or omission of TPP in a rendition or property report. */
  'omitted-tpp',
] as const;

export type MotionGround = (typeof MOTION_GROUNDS)[number];

/**
 * The option string each ground selects, and the blank it then has to fill.
 *
 * The options are the form's own export values, copied exactly: pdf-lib matches
 * the string, and a tidied one selects nothing while reporting success. Each
 * ground's sentence ends "in tax year(s) ______", and `years` is that blank —
 * a ticked ground naming no year asks the board to correct an unbounded roll.
 */
const GROUND: Readonly<Record<MotionGround, { option: string; years: string }>> = {
  clerical: {
    option: "clerical error that affects Movant's liability for a tax imposed in tax year(s)",
    years: '11',
  },
  'multiple-appraisals': {
    option: 'Multiple appraisals of a property in tax year(s)',
    years: '12',
  },
  'non-existent': {
    option:
      'inclusion of property that does not exist in the form or at the location described in ' +
      'the appraisal roll for tax year(s)',
    years: '13',
  },
  ownership: { option: 'an error of ownership of a property for tax year(s)', years: '14' },
  'omitted-tpp': {
    option:
      'an error or omission of tangible personal property in a rendition statement or property ' +
      'report for tax year(s)',
    years: '15',
  },
};

export interface MotionFillInput {
  /** Which subsection the board is being asked under. (d) has its own form. */
  route: CorrectionRouteKey;
  ground: MotionGround | null;
  movant: MotionMovant;
  subject: MotionSubject;
  /** The taxing units the property sits in. The form lists them on one line. */
  taxingUnits: readonly string[];
  /** The error, in the firm's own words. This is what the board rules on. */
  errors: string | null;
}

export interface MotionFillPlan {
  revision: string;
  blocked: string | null;
  text: readonly FormFillText[];
  choices: readonly FormFillChoice[];
  omissions: readonly FormOmission[];
}

/** Roughly what field 18's box holds, measured off the printed page. */
const ERRORS_BOX = 480;

export function planMotionFill(input: MotionFillInput): MotionFillPlan {
  const { movant, subject } = input;
  const text: FormFillText[] = [];
  const choices: FormFillChoice[] = [];
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

  // ---- The route ----------------------------------------------------------
  // This form says on its face that the motion is made under 25.25(c) or (c-1).
  // A (d) motion sent here would be filed under a subsection it does not meet
  // and would be denied on the paper rather than on the facts.

  if (input.route === 'd') {
    blocked =
      'This is a 25.25(d) motion and Form 50-771 is the (c) and (c-1) motion. Use Form 50-230, ' +
      'which asserts the one-third over-appraisal (d) actually requires.';
    omit('Form', blocked, 'blocking');
  }

  // ---- Who, where, which property ----------------------------------------

  if (subject.county === null) {
    blocked = blocked ?? 'No county named for the board this motion is filed with.';
    omit(
      '1',
      `The motion opens "In the County of ______" and none is recorded for ` +
        `${subject.districtName ?? 'this district'}. The named board is the only one that can ` +
        'hear it.',
      'blocking',
    );
  }
  put('1', subject.county);
  put('2', subject.county);
  put('16', districtBlank(subject.districtName, omit));

  if (!movant.ownerName) {
    blocked = blocked ?? 'No movant named.';
    omit('3', 'The motion has no movant. 25.25(c) is the owner’s to bring.', 'blocking');
  }
  put('3', movant.ownerName);
  put('4', subject.description);
  put('5', subject.location);
  put('6', subject.accountId);

  if (subject.description === null && subject.accountId === null) {
    blocked = blocked ?? 'Nothing on the motion identifies the property.';
    omit(
      '4',
      'No property description and no appraisal district account number. The board corrects a ' +
        'line on the roll and cannot find the line.',
      'blocking',
    );
  }
  if (subject.location === null) {
    omit('5', 'No property location. The form asks where the property is, beside what it is.');
  }

  // ---- The certified roll -------------------------------------------------

  const certified = subject.certifiedOn === null ? null : certificationDate(subject.certifiedOn);
  if (certified === null) {
    blocked = blocked ?? 'No certification date for the roll being corrected.';
    omit(
      '7',
      'The motion recites the day this board certified the roll, and none is on file. A 25.25 ' +
        'motion asks to change a certified roll — without the date it does not say which one.',
      'blocking',
    );
  } else {
    put('7', certified.day);
    put('8', certified.month);
    put('9', certified.year);
  }

  // ---- The ground ---------------------------------------------------------

  if (input.ground === null) {
    blocked = blocked ?? 'No ground selected.';
    omit(
      '10',
      'The motion selects none of the five grounds. 25.25(c) and (c-1) are a closed list, and a ' +
        'motion that names no item on it asks the board for nothing it can grant.',
      'blocking',
    );
  } else {
    const ground = GROUND[input.ground];
    choices.push({ field: '10', option: ground.option });
    put(ground.years, String(subject.taxYear));
  }

  // ---- What is wrong ------------------------------------------------------

  put('17', input.taxingUnits.join(', '));
  if (input.taxingUnits.length === 0) {
    omit(
      '17',
      'No taxing units listed. The board sends notice of the hearing to the presiding officer of ' +
        'each one, so an empty line is a hearing the units are not told about.',
    );
  }
  if (input.errors === null || input.errors.trim() === '') {
    blocked = blocked ?? 'The motion does not state the error.';
    omit(
      '18',
      'The form asks the movant to state the specific errors this motion seeks to correct, and ' +
        'the line is empty. That sentence is the motion; the rest is the caption.',
      'blocking',
    );
  } else {
    put('18', input.errors.trim());
    if (input.errors.trim().length > ERRORS_BOX) {
      omit(
        '18',
        `The statement of errors runs to ${input.errors.trim().length} characters and the ` +
          `printed box holds about ${ERRORS_BOX}. The rest is in the file and not on the paper.`,
      );
    }
  }

  // ---- Signature block ----------------------------------------------------

  put('20', movant.signedOn);
  put('21', movant.signerName);
  put('22', movant.phone);
  put('23', movant.mailingAddress);
  put('24', movant.cityStateZip);
  if (movant.signerName === null) {
    omit('21', 'Nobody is named as signing. The form prints the name beneath the signature line.');
  }
  if (movant.mailingAddress === null || movant.cityStateZip === null) {
    omit(
      '23',
      'No mailing address for the movant. 25.25(e) has the board notify the movant of the ' +
        'hearing at least fifteen days ahead, and this is where it writes.',
    );
  }
  if (movant.appointmentOnFile === false) {
    blocked = blocked ?? 'Signed as agent with no appointment on file.';
    omit(
      '19',
      'The form’s own footnote says an agent designation does not take effect with respect ' +
        'to an appraisal district until a copy is filed with it. File the Form 50-162 first, or ' +
        'have the client sign.',
      'blocking',
    );
  }
  omissions.push(taxesPaidCaution(subject.taxYear));

  return { revision: FORM_50771_REVISION, blocked, text, choices, omissions };
}

/**
 * What goes in the "located within the ______ Appraisal District" blank.
 *
 * Returns null and warns where the district's name does not end in the two
 * words the form has already printed. "Tax Appraisal District of Bell County"
 * cannot be folded into that sentence at all, and there are 91 districts whose
 * names are not "<County> County Appraisal District" — guessing would put a
 * misnamed entity on a filed motion.
 */
function districtBlank(
  name: string | null,
  omit: (field: string, missing: string) => void,
): string | null {
  if (name === null) {
    omit('16', 'No district name recorded, so the sentence naming the district stays blank.');
    return null;
  }
  const suffix = ' Appraisal District';
  if (!name.endsWith(suffix)) {
    omit(
      '16',
      `The form prints "within the ______ Appraisal District" and this district is "${name}", ` +
        'which does not end in those words. Write the blank by hand rather than letting the ' +
        'sentence name an entity that does not exist.',
    );
    return null;
  }
  return name.slice(0, -suffix.length);
}

export async function renderForm50771(plan: MotionFillPlan): Promise<Uint8Array> {
  if (plan.blocked !== null) {
    throw new Error(
      `Refusing to fill Form 50-771: ${plan.blocked} A motion the board denies on its face ` +
        'spends the route, and 25.25(c-1)(3) counts a determination against the next one.',
    );
  }
  return fillPinnedForm({
    template: new URL('../assets/50-771.pdf', import.meta.url),
    formLabel: 'Form 50-771',
    revision: FORM_50771_REVISION,
    text: plan.text,
    choices: plan.choices,
    driftHint: 're-read the form before filing anything from it.',
  });
}
