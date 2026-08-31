import type { FormOmission } from './form-50-144.js';
import type { FormFillChoice, FormFillText } from './fill-50-144.js';
import { fillPinnedForm } from './fill-pdf.js';

/**
 * Fill the Comptroller's Form 50-132, Property Owner's Notice of Protest.
 *
 * The protest wing has tracked this document since the notice-intake work —
 * three clocks off one envelope, a brief drafted against the district's number
 * — and then printed nothing a district accepts. A brief is an argument; this
 * is the filing that makes the argument admissible, and until now the deadline
 * the whole board is built around had no document behind it.
 *
 * Four things about the printed form drive the design.
 *
 * **Field one asks for the county, not the district.** The box is named
 * "Appraisal Districts Name" in the PDF and labelled "Appraisal District's
 * County" on the page, and the label is the one to believe. So this planner
 * takes both: the county goes in the box, and the district's own name is kept
 * for the messages, because "no county recorded for Harris Central Appraisal
 * District" is a sentence somebody can act on and "no county recorded for
 * tx-harris" is not.
 *
 * **Section 3 is a preservation rule, not a summary.** The form says in its own
 * words that failing to select the box for a reason "may result in your
 * inability to protest an issue that you want to pursue" — 41.44(d) requires
 * only that the protest identify the owner, the property and that the owner is
 * dissatisfied, but the ARB reads the boxes. A protest filed with no box ticked
 * is therefore blocked rather than noted: it preserves nothing, and it consumes
 * the deadline.
 *
 * **The special-panel question is broken on the Comptroller's own PDF.** The
 * threshold sentence's Yes and No are two separate one-option fields, and the
 * No is still named for the *old* $57 million threshold while the Yes carries
 * the current $62.9 million one. Both are filled only when a special panel is
 * actually requested; otherwise the whole line is left alone, because touching
 * half of a broken pair is how a form ends up answering a question nobody asked.
 *
 * **The signature is the client's.** Section 5's certification radio says who
 * is signing, and where that is us, 1.111(a) means the district may disregard
 * the protest until the designation is on file. That is a filing defect rather
 * than a drafting one, so it blocks.
 *
 * Everything else follows the rule Form 50-144's fill sets: a blank is never a
 * value. A field we cannot answer stays empty and turns up in `omissions`.
 */

/** The pinned revision. Filling a different one silently moves every field. */
export const FORM_50132_REVISION = '50-132 · 03-26/28';

/**
 * SHA-256 of `assets/50-132.pdf` as downloaded from comptroller.texas.gov.
 * Recorded so a swapped asset is a visible change rather than a surprise.
 */
export const FORM_50132_SHA256 = 'd98b6f42b1b5f1adcb34262fa397400c7fc1f4d38ee06b9434c84cfe431ca5fd';

/**
 * Section 3's fifteen boxes, keyed by what they claim.
 *
 * All fifteen, though a business personal property protest reaches perhaps six
 * of them: a map missing the ground somebody needs is a ground they cannot
 * file. The comment on each is the form's own printed wording, abbreviated.
 */
export const PROTEST_REASONS = [
  /** Incorrect appraised (market) value and/or unequal appraisal. 41.41(a)(1)-(2). */
  'value',
  /** Property should not be taxed in (taxing unit). 41.41(a)(7). */
  'wrong-taxing-unit',
  /** Not located in this appraisal district, or should not be on its records. */
  'not-in-district',
  /** Failure to send a required notice. 41.41(a)(9). */
  'no-notice',
  /** Exemption denied, modified or cancelled. 41.41(a)(4). */
  'exemption-denied',
  /** Temporary disaster damage exemption denied or modified. 11.35. */
  'disaster-exemption',
  /** Ag-use, open-space or other special appraisal denied, modified, cancelled. */
  'special-appraisal-denied',
  /** Change in use of land appraised as ag-use, open-space or timberland. */
  'change-of-use',
  /** Incorrect value of land under a special appraisal. */
  'special-appraisal-value',
  /** Owner's name is incorrect. 41.41(a)(5). */
  'owner-name',
  /** Property description is incorrect. 41.41(a)(6). */
  'property-description',
  /** Incorrect damage assessment rating for a temporary disaster exemption. */
  'damage-rating',
  /** Circuit breaker limitation on other real property denied, modified, cancelled. */
  'circuit-breaker',
  /** Incorrect value and allocation under a historic site exemption. */
  'historic-allocation',
  /** Other. The form then asks what. */
  'other',
] as const;

export type ProtestReason = (typeof PROTEST_REASONS)[number];

/** Which printed box each reason is, in the order Section 3 prints them. */
const REASON_FIELD: Readonly<Record<ProtestReason, string>> = {
  value: 'Reason for protest 1',
  'wrong-taxing-unit': 'Reason for protest 2',
  'not-in-district': 'Reason for protest 3',
  'no-notice': 'Reason for protest 4',
  'exemption-denied': 'Reason for protest 5',
  'disaster-exemption': 'Reason for protest 6',
  'special-appraisal-denied': 'Reason for protest 7',
  'change-of-use': 'Reason for protest 8',
  'special-appraisal-value': 'Reason for protest 9',
  'owner-name': 'Reason for protest 10',
  'property-description': 'Reason for protest 11',
  'damage-rating': 'Reason for protest 12',
  'circuit-breaker': 'Reason for protest 13',
  'historic-allocation': 'Reason for protest 14',
  other: 'Reason for protest 15',
};

/**
 * Section 5's appearance options, verbatim.
 *
 * The three that are not "In person" carry the affidavit sentence in the option
 * name itself, leading space and doubled asterisks included. They are copied
 * exactly because pdf-lib matches the string, and a tidied one selects nothing.
 */
const APPEARANCE_OPTION = {
  'in-person': 'In person',
  telephone:
    ' By telephone conference call and will submit evidence with a written affidavit delivered ' +
    'to the ARB before the hearing begins.** (may use Comptroller Form 50-283, Property Owner ' +
    'Affidavit of Evidence)',
  videoconference:
    ' By videoconference and will submit evidence with a written affidavit delivered to the ARB ' +
    'before the hearing begins.** (may use Comptroller Form 50-283, Property Owner Affidavit of ' +
    'Evidence)',
  affidavit:
    ' On written affidavit submitted with evidence and delivered to the ARB before the hearing ' +
    'begins',
} as const;

export type ProtestAppearance = keyof typeof APPEARANCE_OPTION;

/** 6.425's four classifications, which is what a special panel is limited to. */
const CLASSIFICATION_OPTION = {
  // The trailing space is the form's, not a typo here.
  commercial: 'Commercial real and personal property ',
  industrial: 'Industrial and manufacturing real and personal property',
  utility: 'Real and personal property of utilities',
  multifamily: 'Multifamily residential real property',
} as const;

export type ProtestClassification = keyof typeof CLASSIFICATION_OPTION;

/** The property owner or lessee, as Section 1 asks for them. */
export interface ProtestParty {
  name: string;
  /** Mailing address, city, state and ZIP on the form's single line. */
  mailingAddress: string | null;
  phone: string | null;
}

/** Section 2. The account is "if known"; something here has to identify it. */
export interface ProtestProperty {
  accountId: string | null;
  situsAddress: string | null;
  legalDescription: string | null;
}

/** The grounds, with the riders three of them ask for. */
export interface ProtestGrounds {
  reasons: readonly ProtestReason[];
  /** Which taxing unit, for `wrong-taxing-unit`. */
  taxingUnit: string | null;
  /** Which notice was not sent, for `no-notice`. */
  noticeType: string | null;
  /** What the other ground is, for `other`. */
  otherReason: string | null;
  /** Section 4's optional opinion of value. Blank is a real answer. */
  opinionOfValue: number | null;
  /** Section 4's free text. */
  facts: string | null;
}

/**
 * Section 5's elections.
 *
 * Every one is nullable and null leaves the box alone, because each unanswered
 * box has a printed default the ARB applies and inventing an answer is not the
 * same as accepting one. The two that change what the firm has to do on the day
 * — appearance and notice delivery — say so in `omissions` when left blank.
 */
export interface ProtestHearing {
  informalConference: boolean | null;
  panel: 'single-member' | 'regular' | null;
  appearance: ProtestAppearance | null;
  noticeDelivery: 'first-class' | 'certified' | null;
  wantsHearingProcedures: boolean | null;
  reminder: 'text' | 'email' | 'none' | null;
  mobileNumber: string | null;
  emailAddress: string | null;
  /** Set only to request a 6.425 special panel, which needs all three facts. */
  specialPanel: {
    districtValue: number;
    classification: ProtestClassification;
  } | null;
}

export interface ProtestSigner {
  /** Printed name of whoever signs. The signature itself is never touched. */
  name: string;
  capacity: 'owner' | 'agent' | 'other';
  /** What the relationship is, for `other`. */
  otherDescription: string | null;
  /** Whether a 50-162 designating us is on file. Null where nobody has said. */
  appointmentOnFile: boolean | null;
  /** The date the form is signed. A draft going out for signature has none. */
  signedOn: string | null;
}

export interface ProtestFillInput {
  /** Field one takes the county; the name is for what we say about it. */
  district: { county: string | null; name: string | null };
  taxYear: number;
  owner: ProtestParty;
  property: ProtestProperty;
  grounds: ProtestGrounds;
  hearing: ProtestHearing;
  signer: ProtestSigner;
  /**
   * Whether the notice says a 22.28 rendition penalty was applied.
   *
   * Not a field on this form. It is here because the protest does not reach the
   * penalty and the waiver that does has a shorter clock, and this is the last
   * moment anybody looks at the notice before the deadline passes.
   */
  renditionPenaltyApplied: boolean | null;
}

export interface ProtestFillPlan {
  revision: string;
  /**
   * Set when filing this form would spend the deadline on a protest that
   * preserves less than it appears to. An ARB reads the boxes; a page that
   * looks complete and ticks nothing is worse than no page, because the day it
   * was filed is the day the window closed.
   */
  blocked: string | null;
  text: readonly FormFillText[];
  choices: readonly FormFillChoice[];
  omissions: readonly FormOmission[];
}

/**
 * Roughly what Section 4's facts box holds, measured off the printed page.
 *
 * The box is 550 by 61 points, which is five lines of about 120 characters.
 * Past that the text is still in the file and still invisible on paper, so it
 * is counted rather than truncated: silently cutting a client's own account of
 * the facts is the one thing worse than a full box.
 */
const FACTS_BOX = 600;

export function planProtestFill(input: ProtestFillInput): ProtestFillPlan {
  const { district, owner, property, grounds, hearing, signer } = input;
  const text: FormFillText[] = [];
  const choices: FormFillChoice[] = [];
  const omissions: FormOmission[] = [];

  const put = (field: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== '') text.push({ field, value });
  };
  const check = (field: string): void => {
    choices.push({ field, option: null });
  };
  const select = (field: string, option: string): void => {
    choices.push({ field, option });
  };
  const omit = (
    field: string,
    missing: string,
    severity: FormOmission['severity'] = 'warning',
  ): void => {
    omissions.push({ field, missing, severity });
  };

  let blocked: string | null = null;
  const districtLabel = district.name ?? 'the appraisal district';

  // ---- The header line ----------------------------------------------------

  if (district.county === null) {
    blocked = 'No county named for the district this protest is filed with.';
    omit(
      'Appraisal Districts Name',
      `Field one asks which county’s appraisal district this is, and none is recorded for ` +
        `${districtLabel}. A protest is filed with one district and is invisible to every other.`,
      'blocking',
    );
  } else {
    put('Appraisal Districts Name', district.county);
  }
  put('Tax Year', String(input.taxYear));
  put('Appraisal District Account Number', property.accountId);

  // ---- Section 1: who ----------------------------------------------------
  // The over-65 / disabled / military boxes above the name are left alone. They
  // are an "if applicable" line about the owner as a person, and a business
  // entity is none of them; a blank there says nothing false.

  if (!owner.name) {
    blocked = blocked ?? 'No property owner named.';
    omit(
      'Name of Property Owner or Lessee',
      'The protest has no owner on it. 41.44(d) asks for the protesting owner by name before ' +
        'it asks for anything else.',
      'blocking',
    );
  }
  put('Name of Property Owner or Lessee', owner.name);
  put('Mailing Address City State ZIP Code', owner.mailingAddress);
  put('Phone Number area code and number', owner.phone);
  if (owner.mailingAddress === null) {
    omit(
      'Mailing Address City State ZIP Code',
      'No mailing address for the owner. The ARB sends the notice of hearing here, and 41.46 ' +
        'gives it fifteen days’ notice to send.',
    );
  }
  if (owner.phone === null) {
    omit(
      'Phone Number area code and number',
      'No phone on the client record. An appraisal office settling informally calls this number.',
    );
  }

  // ---- Section 2: which property -----------------------------------------

  put('Physical Address', property.situsAddress);
  put('Legal description', property.legalDescription);
  // "Mobile Home Make, Model and Identification" is left blank: it is real
  // property's question, and business personal property never answers it.
  if (
    property.accountId === null &&
    property.situsAddress === null &&
    property.legalDescription === null
  ) {
    blocked = blocked ?? 'Nothing on the form identifies the property.';
    omit(
      'Section 2 property description',
      'No account number, no situs address and no legal description. The ARB cannot docket a ' +
        'protest against a property it cannot find, and the deadline runs while it asks.',
      'blocking',
    );
  }

  // ---- Section 3: the grounds --------------------------------------------

  if (grounds.reasons.length === 0) {
    blocked = blocked ?? 'No reason for protest selected.';
    omit(
      'Section 3 reasons for protest',
      'Not one box is ticked. The form’s own warning is that failing to select the box for a ' +
        'reason may cost the right to pursue it, so this page would spend the deadline and ' +
        'preserve nothing.',
      'blocking',
    );
  }
  for (const reason of grounds.reasons) check(REASON_FIELD[reason]);

  const rider = (
    reason: ProtestReason,
    field: string,
    value: string | null,
    missing: string,
  ): void => {
    if (!grounds.reasons.includes(reason)) return;
    if (value === null || value === '') {
      blocked = blocked ?? `The ${reason} ground names nothing.`;
      omit(field, missing, 'blocking');
      return;
    }
    put(field, value);
  };

  rider(
    'wrong-taxing-unit',
    'Taxing Unit',
    grounds.taxingUnit,
    'The ground is that the property should not be taxed in a named unit, and the unit is not ' +
      'named. Ticked and blank, the box claims nothing the ARB can rule on.',
  );
  rider(
    'no-notice',
    'Type of notice',
    grounds.noticeType,
    'The ground is that a required notice was not sent, and the form asks which one. Which ' +
      'notice is the whole claim: 41.411 reaches only notices the district owed.',
  );
  rider(
    'other',
    'Other disaster exemption',
    grounds.otherReason,
    'The "Other" box is ticked with nothing written on its line. The field is misnamed in the ' +
      'PDF — its tooltip says disaster exemption and the printed line is the general "Other:" — ' +
      'but blank is blank either way.',
  );

  put(
    'Opinion of property value',
    grounds.opinionOfValue === null ? null : money(grounds.opinionOfValue),
  );
  put('Facts to resolve protest', grounds.facts);
  if (grounds.facts !== null && grounds.facts.length > FACTS_BOX) {
    omit(
      'Facts to resolve protest',
      `The facts run to ${grounds.facts.length} characters and the printed box holds about ` +
        `${FACTS_BOX}. The rest is in the file and not on the paper — shorten it, or say here ` +
        'that a statement is attached and attach it.',
    );
  }

  // ---- Section 5: how the hearing runs ------------------------------------

  if (hearing.informalConference !== null) {
    select('Do you request an informal conference', hearing.informalConference ? 'Yes' : 'No');
  }
  if (hearing.panel !== null) {
    select(
      'ARB panel',
      hearing.panel === 'single-member'
        ? 'a single-member ARB panel'
        : 'a regular ARB panel of at least three members',
    );
  }
  if (hearing.appearance !== null) {
    select('ARB hearing', APPEARANCE_OPTION[hearing.appearance]);
  } else {
    omit(
      'ARB hearing',
      'No appearance elected. Left blank the ARB schedules an in-person hearing, so somebody ' +
        'has to be in the room on a date it picks; the affidavit and remote options are the ' +
        'ones that have to be asked for.',
    );
  }
  if (hearing.noticeDelivery !== null) {
    select(
      'Notice of hearing',
      hearing.noticeDelivery === 'first-class'
        ? 'Regular first-class mail'
        : 'Certified mail and agree to pay the cost (if applicable)',
    );
  }
  if (hearing.wantsHearingProcedures !== null) {
    select('Hearing Procedures', hearing.wantsHearingProcedures ? 'Yes' : 'No');
  }
  if (hearing.reminder !== null) {
    select(
      'Electronic reminder',
      hearing.reminder === 'text'
        ? 'Yes, by text'
        : hearing.reminder === 'email'
          ? 'Yes, by email'
          : 'No',
    );
    if (hearing.reminder === 'text') put('Mobile Number', hearing.mobileNumber);
    if (hearing.reminder === 'email') put('Email Address', hearing.emailAddress);
    if (hearing.reminder === 'text' && hearing.mobileNumber === null) {
      omit(
        'Mobile Number',
        'A text reminder is requested with no number to send it to, so the reminder that was ' +
          'the point of the box will not arrive.',
      );
    }
    if (hearing.reminder === 'email' && hearing.emailAddress === null) {
      omit(
        'Email Address',
        'An email reminder is requested with no address to send it to, so the reminder that was ' +
          'the point of the box will not arrive.',
      );
    }
  }

  // The special-panel line, all of it or none of it. See the note at the top:
  // its Yes and No are separate one-option fields and the No still carries the
  // old $57 million threshold in its name.
  if (hearing.specialPanel !== null) {
    select('Request for special panel', 'Yes');
    select('Property is appraised at $62.9 million or greater', 'Yes');
    put(
      'Appraisal districts value assigned to property',
      money(hearing.specialPanel.districtValue),
    );
    select(
      'Classification of your property',
      CLASSIFICATION_OPTION[hearing.specialPanel.classification],
    );
  }

  // ---- Section 5: who signs ------------------------------------------------

  put('Print Name of Property Owner or Authorized Representative', signer.name);
  // The date belongs to the hand that signs, and an unsigned, undated form is
  // the ordinary state of one going out for signature. Not an omission.
  put('Date of Signature', signer.signedOn);
  select(
    'Certification and Signature',
    signer.capacity === 'owner'
      ? 'Property Owner'
      : signer.capacity === 'agent'
        ? "Property Owner's agent"
        : 'Other (please specify)',
  );
  if (signer.capacity === 'other') {
    if (signer.otherDescription === null) {
      blocked = blocked ?? 'The signer is neither the owner nor the agent, and says nothing more.';
      omit(
        'Other description',
        'The certification claims some other authority to sign and does not say what it is. ' +
          'The ARB decides whether the signer could bring this protest by reading that line.',
        'blocking',
      );
    }
    put('Other description', signer.otherDescription);
  }
  if (signer.capacity === 'agent' && signer.appointmentOnFile !== true) {
    const known = signer.appointmentOnFile === false;
    if (known) blocked = blocked ?? 'Signed as agent with no appointment on file.';
    omit(
      'Certification and Signature',
      known
        ? `This protest is signed as agent and no Form 50-162 has been filed with ` +
            `${districtLabel}. Under 1.111(a) the district need not recognise us until it has ` +
            'one, so the protest can be disregarded and the deadline still passes. File the ' +
            'appointment first, or have the client sign.'
        : 'This protest is signed as agent and nothing records whether the appointment is on ' +
            'file with the district. Under 1.111(a) that designation is what makes the signature ' +
            'count — worth confirming before the deadline rather than after.',
      known ? 'blocking' : 'warning',
    );
  }

  if (input.renditionPenaltyApplied === true) {
    omit(
      'Rendition penalty',
      'The notice says the 22.28 penalty was applied. This form does not reach it: the penalty ' +
        'is waived under 22.30 on a separate written request, and 22.30(b) gives thirty days ' +
        'from the penalty notice with no May 15 floor under it, so that clock usually closes ' +
        'first. Protest the value here and ask for the waiver separately.',
    );
  }

  return { revision: FORM_50132_REVISION, blocked, text, choices, omissions };
}

/**
 * Write a plan onto the pinned PDF.
 *
 * The signature field is never touched and the form is left fillable: this is a
 * document somebody signs and files, not one we produce finished.
 */
export async function renderForm50132(plan: ProtestFillPlan): Promise<Uint8Array> {
  if (plan.blocked !== null) {
    throw new Error(
      `Refusing to fill Form 50-132: ${plan.blocked} The page would read as a filed protest ` +
        'while preserving less than it appears to, and the deadline it spent does not come back.',
    );
  }
  return fillPinnedForm({
    template: new URL('../assets/50-132.pdf', import.meta.url),
    formLabel: 'Form 50-132',
    revision: FORM_50132_REVISION,
    text: plan.text,
    choices: plan.choices,
    driftHint: 're-read the form before filing anything from it.',
  });
}

function money(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}
