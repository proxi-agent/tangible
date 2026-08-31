import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  planProtestFill,
  renderForm50132,
  type ProtestFillInput,
  type ProtestFillPlan,
  type ProtestGrounds,
  type ProtestHearing,
  type ProtestParty,
  type ProtestProperty,
  type ProtestSigner,
} from './fill-50-132.js';

const owner = (over: Partial<ProtestParty> = {}): ProtestParty => ({
  name: 'Acme Manufacturing LLC',
  mailingAddress: '1200 Commerce St, Houston, TX 77002',
  phone: '(713) 555-0142',
  ...over,
});

const property = (over: Partial<ProtestProperty> = {}): ProtestProperty => ({
  accountId: '1234567',
  situsAddress: '4400 Industrial Way, Houston, TX 77015',
  legalDescription: null,
  ...over,
});

const grounds = (over: Partial<ProtestGrounds> = {}): ProtestGrounds => ({
  reasons: ['value'],
  taxingUnit: null,
  noticeType: null,
  otherReason: null,
  opinionOfValue: 1_240_000,
  facts: 'The district carried leased equipment already rendered on another account.',
  ...over,
});

const hearing = (over: Partial<ProtestHearing> = {}): ProtestHearing => ({
  informalConference: true,
  panel: null,
  appearance: 'in-person',
  noticeDelivery: null,
  wantsHearingProcedures: true,
  reminder: null,
  mobileNumber: null,
  emailAddress: null,
  specialPanel: null,
  ...over,
});

const signer = (over: Partial<ProtestSigner> = {}): ProtestSigner => ({
  name: 'Maria Delgado',
  capacity: 'owner',
  otherDescription: null,
  appointmentOnFile: null,
  signedOn: null,
  ...over,
});

const plan = (over: Partial<ProtestFillInput> = {}): ProtestFillPlan =>
  planProtestFill({
    district: { county: 'Harris', name: 'Harris Central Appraisal District' },
    taxYear: 2026,
    owner: owner(),
    property: property(),
    grounds: grounds(),
    hearing: hearing(),
    signer: signer(),
    renditionPenaltyApplied: null,
    ...over,
  });

const cell = (p: ProtestFillPlan, field: string) => p.text.find((t) => t.field === field)?.value;
const checked = (p: ProtestFillPlan, field: string) =>
  p.choices.some((c) => c.field === field && c.option === null);
const chosen = (p: ProtestFillPlan, field: string) =>
  p.choices.find((c) => c.field === field)?.option;
const omission = (p: ProtestFillPlan, prefix: string) =>
  p.omissions.find((o) => o.field.startsWith(prefix));

describe('the district it is filed with', () => {
  it('puts the county in field one, which is what the printed label asks for', () => {
    // The PDF names the field "Appraisal Districts Name" and the page labels it
    // "Appraisal District's County". The label is the one to believe.
    expect(cell(plan(), 'Appraisal Districts Name')).toBe('Harris');
  });

  it('refuses to file with nobody, and says which district it could not place', async () => {
    const p = plan({ district: { county: null, name: 'Harris Central Appraisal District' } });
    expect(omission(p, 'Appraisal Districts Name')?.severity).toBe('blocking');
    expect(omission(p, 'Appraisal Districts Name')?.missing).toContain(
      'Harris Central Appraisal District',
    );
    await expect(renderForm50132(p)).rejects.toThrow(/No county named/);
  });

  it('leaves the over-65, disabled and military boxes alone', () => {
    // An "if applicable" line about the owner as a person. A company is none of
    // them, and a blank there says nothing false.
    expect(chosen(plan(), 'Property owner type')).toBeUndefined();
  });
});

describe('Section 3, the grounds', () => {
  it('ticks the box for each reason and nothing else', () => {
    const p = plan({ grounds: grounds({ reasons: ['value', 'property-description'] }) });
    expect(checked(p, 'Reason for protest 1')).toBe(true);
    expect(checked(p, 'Reason for protest 11')).toBe(true);
    expect(checked(p, 'Reason for protest 5')).toBe(false);
  });

  it('will not spend the deadline on a page that preserves nothing', async () => {
    const p = plan({ grounds: grounds({ reasons: [] }) });
    expect(p.blocked).toBe('No reason for protest selected.');
    expect(omission(p, 'Section 3')?.missing).toContain('cost the right to pursue it');
    await expect(renderForm50132(p)).rejects.toThrow(/preserving less than it appears to/);
  });

  it('makes the three grounds that ask a question answer it', async () => {
    const p = plan({ grounds: grounds({ reasons: ['wrong-taxing-unit'] }) });
    expect(omission(p, 'Taxing Unit')?.severity).toBe('blocking');
    await expect(renderForm50132(p)).rejects.toThrow(/wrong-taxing-unit/);

    const named = plan({
      grounds: grounds({ reasons: ['wrong-taxing-unit', 'no-notice', 'other'] }),
    });
    expect(named.blocked).not.toBeNull();

    const answered = plan({
      grounds: grounds({
        reasons: ['wrong-taxing-unit', 'no-notice', 'other'],
        taxingUnit: 'Houston ISD',
        noticeType: 'Notice of Appraised Value',
        otherReason: 'The account duplicates 7654321.',
      }),
    });
    expect(answered.blocked).toBeNull();
    expect(cell(answered, 'Taxing Unit')).toBe('Houston ISD');
    expect(cell(answered, 'Type of notice')).toBe('Notice of Appraised Value');
    // The PDF calls the "Other:" line a disaster exemption. Its printed line is
    // the general one beside reason 15, and that is where this text lands.
    expect(cell(answered, 'Other disaster exemption')).toBe('The account duplicates 7654321.');
  });

  it('writes the opinion of value without the dollar sign the form prints', () => {
    expect(cell(plan(), 'Opinion of property value')).toBe('1,240,000');
  });

  it('leaves the opinion blank rather than filling in a zero', () => {
    // 41.44(d) does not require an opinion, and a $0 opinion is an assertion.
    const p = plan({ grounds: grounds({ opinionOfValue: null }) });
    expect(cell(p, 'Opinion of property value')).toBeUndefined();
    expect(p.blocked).toBeNull();
  });

  it('counts the facts box rather than truncating what the client said', () => {
    const long = 'x'.repeat(900);
    const p = plan({ grounds: grounds({ facts: long }) });
    expect(cell(p, 'Facts to resolve protest')).toBe(long);
    expect(omission(p, 'Facts')?.missing).toContain('900 characters');
    expect(p.blocked).toBeNull();
  });
});

describe('Section 2, which property', () => {
  it('will not protest a property the board cannot find', async () => {
    const p = plan({
      property: property({ accountId: null, situsAddress: null, legalDescription: null }),
    });
    expect(omission(p, 'Section 2')?.severity).toBe('blocking');
    await expect(renderForm50132(p)).rejects.toThrow(/identifies the property/);
  });

  it('takes any one of the three identifiers', () => {
    const p = plan({ property: property({ accountId: null, situsAddress: '9 Ship Channel Rd' }) });
    expect(p.blocked).toBeNull();
    expect(cell(p, 'Physical Address')).toBe('9 Ship Channel Rd');
  });
});

describe('Section 5, how the hearing runs', () => {
  it('says nothing where the client has elected nothing', () => {
    const p = plan({
      hearing: hearing({ informalConference: null, wantsHearingProcedures: null }),
    });
    expect(chosen(p, 'Do you request an informal conference')).toBeUndefined();
    expect(chosen(p, 'Hearing Procedures')).toBeUndefined();
    expect(p.blocked).toBeNull();
  });

  it('warns when nobody elected an appearance, because the default is a room', () => {
    const p = plan({ hearing: hearing({ appearance: null }) });
    expect(omission(p, 'ARB hearing')?.missing).toContain('in-person');
    expect(omission(p, 'ARB hearing')?.severity).toBe('warning');
  });

  it('selects the affidavit option by the form’s own exact wording', () => {
    const p = plan({ hearing: hearing({ appearance: 'affidavit' }) });
    expect(chosen(p, 'ARB hearing')).toBe(
      ' On written affidavit submitted with evidence and delivered to the ARB before the hearing ' +
        'begins',
    );
  });

  it('asks for a reminder nobody can send, and says so', () => {
    const p = plan({ hearing: hearing({ reminder: 'text', mobileNumber: null }) });
    expect(chosen(p, 'Electronic reminder')).toBe('Yes, by text');
    expect(omission(p, 'Mobile Number')?.severity).toBe('warning');
  });

  it('answers the special-panel line all at once or not at all', () => {
    // Its Yes and No are two separate one-option radio groups, and the No is
    // still named for the superseded $57 million threshold.
    const none = plan();
    expect(chosen(none, 'Request for special panel')).toBeUndefined();
    expect(chosen(none, 'Property is appraised at $62.9 million or greater')).toBeUndefined();
    expect(chosen(none, 'Property is appraised at $57 million or greater')).toBeUndefined();

    const asked = plan({
      hearing: hearing({
        specialPanel: { districtValue: 70_000_000, classification: 'commercial' },
      }),
    });
    expect(chosen(asked, 'Request for special panel')).toBe('Yes');
    expect(chosen(asked, 'Property is appraised at $62.9 million or greater')).toBe('Yes');
    expect(cell(asked, 'Appraisal districts value assigned to property')).toBe('70,000,000');
    // 6.425's own wording, trailing space included.
    expect(chosen(asked, 'Classification of your property')).toBe(
      'Commercial real and personal property ',
    );
  });
});

describe('Section 5, who signs', () => {
  it('never touches the signature field, and leaves an unsigned form undated', () => {
    const p = plan();
    expect(p.text.some((t) => t.field === 'Signature of Authorized Individual')).toBe(false);
    expect(cell(p, 'Date of Signature')).toBeUndefined();
    expect(p.omissions.some((o) => o.field === 'Date of Signature')).toBe(false);
  });

  it('blocks an agent signature the district has no designation for', async () => {
    const p = plan({ signer: signer({ capacity: 'agent', appointmentOnFile: false }) });
    expect(omission(p, 'Certification')?.severity).toBe('blocking');
    expect(omission(p, 'Certification')?.missing).toContain('1.111(a)');
    await expect(renderForm50132(p)).rejects.toThrow(/no appointment on file/);
  });

  it('warns rather than blocks where nobody has said whether one is on file', () => {
    const p = plan({ signer: signer({ capacity: 'agent', appointmentOnFile: null }) });
    expect(p.blocked).toBeNull();
    expect(omission(p, 'Certification')?.severity).toBe('warning');
  });

  it('makes "other" say what other means', async () => {
    const p = plan({ signer: signer({ capacity: 'other' }) });
    expect(omission(p, 'Other description')?.severity).toBe('blocking');
    await expect(renderForm50132(p)).rejects.toThrow();

    const said = plan({
      signer: signer({ capacity: 'other', otherDescription: 'Court-appointed receiver' }),
    });
    expect(said.blocked).toBeNull();
    expect(cell(said, 'Other description')).toBe('Court-appointed receiver');
  });
});

describe('what this form does not reach', () => {
  it('points at 22.30 when the notice applied the rendition penalty', () => {
    const p = plan({ renditionPenaltyApplied: true });
    expect(omission(p, 'Rendition penalty')?.missing).toContain('22.30');
    // The value protest is still fine — this is a second filing, not a defect.
    expect(p.blocked).toBeNull();
  });

  it('says nothing about a penalty the notice did not apply', () => {
    expect(omission(plan({ renditionPenaltyApplied: false }), 'Rendition penalty')).toBeUndefined();
  });
});

describe('the pinned PDF', () => {
  it('has every field this planner writes to', async () => {
    const p = plan({
      grounds: grounds({
        reasons: ['value', 'wrong-taxing-unit', 'no-notice', 'other'],
        taxingUnit: 'Houston ISD',
        noticeType: 'Notice of Appraised Value',
        otherReason: 'Duplicate account',
      }),
      hearing: hearing({
        panel: 'single-member',
        appearance: 'telephone',
        noticeDelivery: 'certified',
        reminder: 'email',
        emailAddress: 'controller@acme.example',
        specialPanel: { districtValue: 70_000_000, classification: 'industrial' },
      }),
      signer: signer({ signedOn: '05/14/2026' }),
    });
    const bytes = await renderForm50132(p);
    const form = await PDFDocument.load(bytes);
    expect(form.getForm().getTextField('Appraisal Districts Name').getText()).toBe('Harris');
    expect(form.getForm().getRadioGroup('ARB hearing').getSelected()).toContain('telephone');
    expect(form.getForm().getCheckBox('Reason for protest 1').isChecked()).toBe(true);
    // Left fillable and unsigned: this is a document somebody signs and files.
    expect(
      form
        .getForm()
        .getFields()
        .some((f) => f.getName() === 'Signature of Authorized Individual'),
    ).toBe(true);
  });
});
