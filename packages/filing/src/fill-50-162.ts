import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type {
  AppointmentDelivery,
  AppointmentMatters,
  AppointmentScope,
  AppointmentSignerCapacity,
} from '@tangible/types';
import { PDFBool, PDFDocument, PDFName } from 'pdf-lib';
import type { FormOmission } from './form-50-144.js';
import type { FormFillChoice, FormFillText } from './fill-50-144.js';

/**
 * Fill the Comptroller's Form 50-162, Appointment of Agent for Property Tax
 * Matters.
 *
 * This is the document the rest of the pipeline assumes exists. Every rendition
 * we sign as agent stands on one, the draft screen blocks a return without one,
 * and until now the app raised that gate and gave nobody a way through it.
 *
 * Three things about the printed form drive the design.
 *
 * **The property list is four rows long.** Step 2's grid holds four accounts,
 * and the form's own answer to a longer list is a sheet attached and counted in
 * "Number of additional sheets attatched" [sic]. That count is a fact about the
 * paper somebody actually staples on, not about the register, so it is left
 * blank and the sites that did not fit are named in `overflow` instead. A form
 * printed for a nine-site client with four rows filled and no attachment
 * appoints us for four sites — which is why that case is blocking rather than a
 * note.
 *
 * **Step 4 is two separate grants.** The matters checkbox says what we may do;
 * the 22.27(b)(2) radio says whether the district may show us the client's own
 * confidential filings. They are independent, and a Yes on the first with a No
 * on the second is a valid form that leaves us filing renditions we are not
 * allowed to receive back.
 *
 * **The district's own boxes are not ours.** "Date Received" belongs to the
 * appraisal district and stays empty, and the signature is never touched: the
 * whole document is a thing the client signs, so it is left fillable rather
 * than flattened.
 *
 * Everything else follows the rule Form 50-144's fill already sets — a blank is
 * never a value. A field we cannot answer stays empty and turns up in
 * `omissions` naming what is missing.
 */

/** The pinned revision. Filling a different one silently moves every field. */
export const FORM_50162_REVISION = '50-162 · 12-16/13';

/**
 * SHA-256 of `assets/50-162.pdf` as downloaded from comptroller.texas.gov.
 * Recorded so a swapped asset is a visible change rather than a surprise.
 */
export const FORM_50162_SHA256 =
  '0bb89b18abbc967bcf49db5d92ae0f79a7a6198ca53128e588b1c159618dfdd3';

/** Rows in Step 2's printed grid. Counted off the form, not guessed. */
const PROPERTY_ROWS = 4;

/** Step 2's field names are suffixed _2 through _5. Row 1 of the grid is _2. */
const rowSuffix = (index: number): number => index + 2;

/** A name, phone and address as Steps 1 and 3 ask for them. */
export interface AppointmentParty {
  name: string;
  phone: string | null;
  /** Street address, in the form's single "Address" box. */
  street: string | null;
  /** The form's second box: city, state and ZIP on one line. */
  cityStateZip: string | null;
}

/** One site as Step 2 identifies it: by account, by situs, by legal description. */
export interface AppointmentProperty {
  /** Our name for the site, used when saying what did not fit. */
  label: string;
  accountId: string | null;
  situsAddress: string | null;
  /** The district's legal description, where the client has given us one. */
  legalDescription: string | null;
}

/** The terms being granted — the appointment's own facts, before it is filed. */
export interface AppointmentTerms {
  scope: AppointmentScope;
  matters: AppointmentMatters;
  specificMatters: string | null;
  receivesConfidential: boolean;
  deliveries: readonly AppointmentDelivery[];
  /** Step 5's expiry. Null runs until revoked, which is the form's default. */
  endsOn: string | null;
  /** Step 6. The date is when the client signs, so a draft may not have one. */
  signedOn: string | null;
  signerName: string;
  signerTitle: string | null;
  signerCapacity: AppointmentSignerCapacity;
}

export interface AppointmentFillInput {
  /** The appraisal district, spelled as it spells itself. Field one. */
  districtName: string | null;
  /** Step 1: the property owner. */
  owner: AppointmentParty;
  /** Step 3: us. */
  agent: AppointmentParty;
  terms: AppointmentTerms;
  /** Every site this appointment is meant to cover, in the order to list them. */
  properties: readonly AppointmentProperty[];
}

/** A site the printed grid had no row for. */
export interface AppointmentOverflow {
  label: string;
  accountId: string | null;
}

export interface AppointmentFillPlan {
  revision: string;
  /**
   * Set when filling this form would produce a document that says something
   * false, as opposed to something incomplete. An incomplete form is one
   * somebody can see is incomplete; a form appointing an unnamed agent over
   * four of a client's nine sites is not.
   */
  blocked: string | null;
  text: readonly FormFillText[];
  choices: readonly FormFillChoice[];
  /** Sites past the fourth, for the listing the form asks to be attached. */
  overflow: readonly AppointmentOverflow[];
  /** Fields left deliberately blank, and why. */
  omissions: readonly FormOmission[];
}

/** Step 4's three delivery boxes, in the order the form prints them. */
const DELIVERY_FIELD: Readonly<Record<AppointmentDelivery, string>> = {
  'chief-appraiser': 'all communications from the chief appraiser',
  arb: 'all communications from the appraisal review board',
  'taxing-units': 'all communications from all taxing units participating in the appraisal district',
};

/** Step 6's three capacity boxes. Verbatim, including the long third one. */
const CAPACITY_FIELD: Readonly<Record<AppointmentSignerCapacity, string>> = {
  owner: 'the property owner',
  'property-manager': 'a property manager authorized to designate agents for the owner',
  'other-authorized':
    'other person authorized to act on behalf of the owner other than the person being designated as agent',
};

/** The 22.27(b)(2) radio. Its name is the whole printed sentence. */
const CONFIDENTIAL_FIELD =
  'The agent identified above is authorized to receive confidential information pursuant to Tax ' +
  'Code §§11.48(b)(2), 22.27(b)(2), 23.123(c)(2), 23.126(c)(2), and 23.45(b)(2):';

export function planAppointmentFill(input: AppointmentFillInput): AppointmentFillPlan {
  const { districtName, owner, agent, terms, properties } = input;
  const text: FormFillText[] = [];
  const choices: FormFillChoice[] = [];
  const overflow: AppointmentOverflow[] = [];
  const omissions: FormOmission[] = [];

  const put = (field: string, value: string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== '') text.push({ field, value });
  };
  const check = (field: string): void => {
    choices.push({ field, option: null });
  };
  const omit = (
    field: string,
    missing: string,
    severity: FormOmission['severity'] = 'warning',
  ): void => {
    omissions.push({ field, missing, severity });
  };

  let blocked: string | null = null;

  // ---- Field one: which district -----------------------------------------
  // Authority stops at the district's line, so the wrong name here is not a
  // typo — it is an appointment filed where it grants nothing.
  if (districtName === null) {
    blocked = 'No appraisal district named.';
    omit(
      'Appraisal District Name',
      'An appointment is filed with one district and is invisible to every other. Set the ' +
        'jurisdiction on the site or the engagement before producing the form.',
      'blocking',
    );
  } else {
    put('Appraisal District Name', districtName);
  }
  // "Date Received" is the district's box. Never ours to answer.

  // ---- Step 1: the property owner ----------------------------------------

  put('Name', owner.name);
  put('Telephone Number include area code', owner.phone);
  if (owner.phone === null) {
    omit(
      'Step 1 telephone number',
      'No phone on the client record. The district calls this number when it has a question ' +
        'about the designation itself.',
    );
  }
  put('Address', owner.street);
  put('City State Zip Code', owner.cityStateZip);
  if (owner.street === null || owner.cityStateZip === null) {
    omit(
      'Step 1 address',
      'No mailing address for the owner. Step 2’s first box grants authority over property ' +
        'listed “at the above address”, so a blank here is a form that cannot use it.',
      terms.scope === 'all-at-address' ? 'blocking' : 'warning',
    );
  }

  // ---- Step 2: which property --------------------------------------------

  if (terms.scope === 'all-at-address') {
    check('all property listed for me at the above address');
    // Recorded as a caution rather than an error. It is a real box on the real
    // form and clients do sign it — but it reaches property listed at the
    // owner's *mailing* address, and business personal property is listed
    // where it stands. A client whose notices go to a downtown office and
    // whose machines sit in a yard has appointed us over nothing.
    omit(
      'Step 2 property list',
      'This appointment covers property listed at the owner’s address rather than named ' +
        'accounts. For business personal property that is usually narrower than intended — the ' +
        'property is listed at each site, not at the address the mail goes to.',
    );
  } else {
    check('the property(ies) listed below:');
    if (properties.length === 0) {
      blocked = blocked ?? 'No property listed.';
      omit(
        'Step 2 property list',
        'The form lists the properties the authority covers and none were given. A designation ' +
          'over nothing is not worth the client’s signature.',
        'blocking',
      );
    }
    properties.slice(0, PROPERTY_ROWS).forEach((property, index) => {
      const n = rowSuffix(index);
      put(`Appraisal District Account Number_${n}`, property.accountId);
      put(`Physical or Situs Address of Property_${n}`, property.situsAddress);
      put(`Legal Description_${n}`, property.legalDescription);
      if (property.accountId === null && property.situsAddress === null) {
        blocked = blocked ?? `${property.label} is on the list with nothing to identify it by.`;
        omit(
          `Step 2, row ${index + 1}`,
          `Nothing identifies ${property.label} on the form: no account number and no situs ` +
            'address. The district cannot attach the designation to a property it cannot find.',
          'blocking',
        );
      }
    });
    for (const property of properties.slice(PROPERTY_ROWS)) {
      overflow.push({ label: property.label, accountId: property.accountId });
    }
    if (overflow.length > 0) {
      blocked = blocked ?? `${properties.length} properties on a form with ${PROPERTY_ROWS} rows.`;
      // The count field stays blank on purpose: it says how many sheets are
      // attached, and we cannot attach one. Filling it would be the form
      // asserting paper that is not there.
      omit(
        'Number of additional sheets attatched',
        `Step 2 has ${PROPERTY_ROWS} rows and this appointment is meant to cover ` +
          `${properties.length} sites. ${overflow.map((row) => row.label).join(', ')} ` +
          `${overflow.length === 1 ? 'is' : 'are'} not on the printed form. Attach a listing, ` +
          'write the number of sheets in, or file a second appointment — as filled, this one ' +
          `appoints us over ${PROPERTY_ROWS} sites.`,
        'blocking',
      );
    }
  }

  // ---- Step 3: us ---------------------------------------------------------

  if (!agent.name) {
    blocked = blocked ?? 'No agent named.';
    omit(
      'Step 3 agent name',
      'The firm’s own name is not recorded anywhere, so this form would designate nobody. Set ' +
        'it once on the filing agent record.',
      'blocking',
    );
  }
  put('Name_2', agent.name);
  put('Telephone Number include area code_2', agent.phone);
  put('Address_2', agent.street);
  put('City State Zip Code_2', agent.cityStateZip);
  if (agent.street === null || agent.cityStateZip === null) {
    // Step 4 directs the district to deliver documents "only to the agent at
    // the agent's address indicated above". A blank address is a notice of
    // appraised value that goes nowhere, and the protest window runs anyway.
    omit(
      'Step 3 agent address',
      'No address for us. Step 4 sends the district’s notices to the agent at the address on ' +
        'this form, so leaving it blank redirects the client’s mail into a void.',
      terms.deliveries.length > 0 ? 'blocking' : 'warning',
    );
  }

  // ---- Step 4: what we may do, and what we may see -----------------------

  if (terms.matters === 'specific') {
    check('the following specific property tax matters:');
    put('specific property tax matters', terms.specificMatters);
    if (!terms.specificMatters) {
      blocked = blocked ?? 'Authority limited to nothing in particular.';
      omit(
        'specific property tax matters',
        'The form limits the authority to matters it then has to name. Blank, the limitation ' +
          'reads as no authority at all.',
        'blocking',
      );
    }
  } else {
    check('all property tax matters concerning the property identified');
  }

  // Always answered. The radio has a Yes and a No, and blank is not a third
  // option — a district reading an unanswered box will not hand over a
  // confidential file, so silence here is a No nobody chose.
  choices.push({ field: CONFIDENTIAL_FIELD, option: terms.receivesConfidential ? 'Yes' : 'No' });
  if (!terms.receivesConfidential) {
    omit(
      'Confidential information',
      'The client has said the district may not disclose confidential information to us. 22.27 ' +
        'covers rendition contents, so we can file for them and cannot be sent their own filing ' +
        'back. Intended in some engagements; worth confirming it is intended in this one.',
    );
  }

  for (const delivery of terms.deliveries) check(DELIVERY_FIELD[delivery]);
  if (terms.deliveries.length === 0) {
    omit(
      'Step 4 delivery',
      'No office is directed to send us its paper, so notices, orders and ARB correspondence ' +
        'keep going to the client. Workable where the client forwards them; a missed protest ' +
        'deadline where they do not.',
    );
  }

  // ---- Step 5: when it ends ----------------------------------------------
  // Blank is the form's own default and means the designation runs until it is
  // revoked in writing (1.111(c)), so there is nothing to omit here.
  put('Date Agents Authority Ends', terms.endsOn);

  // ---- Step 6: who signs --------------------------------------------------

  put('Name of Property Owner', terms.signerName);
  put('Title', terms.signerTitle);
  // No date is not an omission. An unsigned, undated form is the ordinary
  // state of one we are about to send out for signature, and the date belongs
  // to the hand that signs it.
  put('Date', terms.signedOn);
  check(CAPACITY_FIELD[terms.signerCapacity]);
  if (!terms.signerTitle) {
    omit(
      'Step 6 title',
      'No title for whoever signs. The form asks in the same breath as the capacity boxes, and ' +
        'a district checking whether a signer could bind the entity looks here first.',
    );
  }

  return { revision: FORM_50162_REVISION, blocked, text, choices, overflow, omissions };
}

const templatePath = (): string => fileURLToPath(new URL('../assets/50-162.pdf', import.meta.url));

/**
 * Write a plan onto the pinned PDF.
 *
 * Every field name is checked against the document rather than assumed, for
 * the same reason as Form 50-144: if the Comptroller republishes and renames a
 * field, that should be an exception naming the field, not a box that silently
 * stays empty on a document somebody signs.
 *
 * The signature field is never touched and the form is left fillable. This one
 * is not ours to sign at all.
 */
export async function renderForm50162(plan: AppointmentFillPlan): Promise<Uint8Array> {
  if (plan.blocked !== null) {
    throw new Error(
      `Refusing to fill Form 50-162: ${plan.blocked} The form would read as a complete ` +
        'designation while granting something narrower than intended, and nothing on the printed ' +
        'page would say so.',
    );
  }
  const pdf = await PDFDocument.load(await readFile(templatePath()));
  const form = pdf.getForm();
  const missing: string[] = [];

  for (const { field, value } of plan.text) {
    const target = form.getFieldMaybe(field);
    if (target === undefined || !('setText' in target)) {
      missing.push(field);
      continue;
    }
    (target as { setText: (t: string) => void }).setText(value);
  }

  for (const { field, option } of plan.choices) {
    const target = form.getFieldMaybe(field);
    if (target === undefined) {
      missing.push(field);
      continue;
    }
    if (option === null && 'check' in target) {
      (target as { check: () => void }).check();
    } else if (option !== null && 'select' in target) {
      (target as { select: (o: string) => void }).select(option);
    } else {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Form 50-162 (${FORM_50162_REVISION}) has no field named ${missing
        .map((f) => JSON.stringify(f))
        .join(', ')}. The pinned PDF and the field map have drifted apart — re-read the form ` +
        'before sending anything from it out for signature.',
    );
  }

  // Some viewers cache a field's stored appearance and show a filled form as
  // blank. This asks them to redraw from the values instead.
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);
  return pdf.save();
}
