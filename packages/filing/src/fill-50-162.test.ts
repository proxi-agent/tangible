import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  planAppointmentFill,
  renderForm50162,
  type AppointmentFillInput,
  type AppointmentFillPlan,
  type AppointmentParty,
  type AppointmentProperty,
  type AppointmentTerms,
} from './fill-50-162.js';

const owner = (over: Partial<AppointmentParty> = {}): AppointmentParty => ({
  name: 'Acme Manufacturing LLC',
  phone: '(713) 555-0142',
  street: '1200 Commerce St',
  cityStateZip: 'Houston, TX 77002',
  ...over,
});

const agent = (over: Partial<AppointmentParty> = {}): AppointmentParty => ({
  name: 'Tangible Property Tax LLC',
  phone: '(512) 555-0199',
  street: '98 Congress Ave, Suite 400',
  cityStateZip: 'Austin, TX 78701',
  ...over,
});

const terms = (over: Partial<AppointmentTerms> = {}): AppointmentTerms => ({
  scope: 'listed',
  matters: 'all',
  specificMatters: null,
  receivesConfidential: true,
  deliveries: ['chief-appraiser', 'arb', 'taxing-units'],
  endsOn: null,
  signedOn: null,
  signerName: 'Maria Delgado',
  signerTitle: 'Controller',
  signerCapacity: 'owner',
  ...over,
});

const site = (label: string, over: Partial<AppointmentProperty> = {}): AppointmentProperty => ({
  label,
  accountId: '1234567',
  situsAddress: '4400 Industrial Way, Houston, TX 77015',
  legalDescription: null,
  ...over,
});

const plan = (over: Partial<AppointmentFillInput> = {}): AppointmentFillPlan =>
  planAppointmentFill({
    districtName: 'Harris Central Appraisal District',
    owner: owner(),
    agent: agent(),
    terms: terms(),
    properties: [site('Houston Plant')],
    ...over,
  });

const cell = (p: AppointmentFillPlan, field: string) =>
  p.text.find((t) => t.field === field)?.value;
const checked = (p: AppointmentFillPlan, field: string) =>
  p.choices.some((c) => c.field === field && c.option === null);
const omission = (p: AppointmentFillPlan, prefix: string) =>
  p.omissions.find((o) => o.field.startsWith(prefix));

describe('the district it is filed with', () => {
  it('is field one, because authority stops at the district line', () => {
    expect(cell(plan(), 'Appraisal District Name')).toBe('Harris Central Appraisal District');
  });

  it('refuses to produce a designation addressed to nobody', async () => {
    const p = plan({ districtName: null });
    expect(omission(p, 'Appraisal District Name')?.severity).toBe('blocking');
    await expect(renderForm50162(p)).rejects.toThrow(/No appraisal district named/);
  });

  it('never answers the district’s own received-date box', () => {
    expect(cell(plan(), 'Date Received appraisal district use only')).toBeUndefined();
  });
});

describe('Step 2, which property', () => {
  it('writes each site into the row the form gives it, starting at _2', () => {
    const p = plan({
      properties: [
        site('Houston Plant', { accountId: '1111111' }),
        site('Houston Office', { accountId: '2222222', legalDescription: 'LT 7 BLK 2' }),
      ],
    });
    expect(checked(p, 'the property(ies) listed below:')).toBe(true);
    expect(cell(p, 'Appraisal District Account Number_2')).toBe('1111111');
    expect(cell(p, 'Appraisal District Account Number_3')).toBe('2222222');
    expect(cell(p, 'Legal Description_3')).toBe('LT 7 BLK 2');
    // Nothing invented for the two empty rows.
    expect(cell(p, 'Appraisal District Account Number_4')).toBeUndefined();
    expect(p.overflow).toHaveLength(0);
  });

  it('stops rather than appointing us over four of five sites in silence', async () => {
    const p = plan({
      properties: ['Plant', 'Office', 'Yard', 'Warehouse', 'Depot'].map((l) => site(l)),
    });
    expect(p.overflow.map((row) => row.label)).toEqual(['Depot']);
    const missing = omission(p, 'Number of additional sheets');
    expect(missing?.severity).toBe('blocking');
    expect(missing?.missing).toContain('Depot');
    // The count field says how many sheets are stapled on. We cannot staple.
    expect(cell(p, 'Number of additional sheets attatched')).toBeUndefined();
    await expect(renderForm50162(p)).rejects.toThrow(/5 properties/);
  });

  it('takes the all-at-address box as a caution, not an error', () => {
    const p = plan({ properties: [], terms: terms({ scope: 'all-at-address' }) });
    expect(checked(p, 'all property listed for me at the above address')).toBe(true);
    expect(cell(p, 'Appraisal District Account Number_2')).toBeUndefined();
    // Signable, and narrower than a BPP client usually means.
    expect(p.blocked).toBeNull();
    expect(omission(p, 'Step 2 property list')?.missing).toContain('listed at each site');
  });

  it('will not put a site on the form that nothing identifies', async () => {
    const p = plan({
      properties: [site('Unknown yard', { accountId: null, situsAddress: null })],
    });
    expect(omission(p, 'Step 2, row 1')?.severity).toBe('blocking');
    await expect(renderForm50162(p)).rejects.toThrow();
  });

  it('is not a form worth signing when it lists nothing at all', () => {
    const p = plan({ properties: [] });
    expect(p.blocked).toBe('No property listed.');
  });
});

describe('Step 3, us', () => {
  it('refuses to designate an unnamed agent', async () => {
    const p = plan({ agent: agent({ name: '' }) });
    expect(omission(p, 'Step 3 agent name')?.severity).toBe('blocking');
    await expect(renderForm50162(p)).rejects.toThrow(/No agent named/);
  });

  it('treats a missing agent address as blocking once notices are redirected', () => {
    const p = plan({ agent: agent({ street: null, cityStateZip: null }) });
    expect(omission(p, 'Step 3 agent address')?.severity).toBe('blocking');
  });

  it('downgrades it where nothing is being redirected to us anyway', () => {
    const p = plan({
      agent: agent({ street: null, cityStateZip: null }),
      terms: terms({ deliveries: [] }),
    });
    expect(omission(p, 'Step 3 agent address')?.severity).toBe('warning');
  });
});

describe('Step 4, the two separate grants', () => {
  const CONFIDENTIAL = /confidential information pursuant to Tax Code/;
  const radio = (p: AppointmentFillPlan) =>
    p.choices.find((c) => CONFIDENTIAL.test(c.field))?.option;

  it('answers the confidentiality radio either way, because blank is a No nobody chose', () => {
    expect(radio(plan())).toBe('Yes');
    const no = plan({ terms: terms({ receivesConfidential: false }) });
    expect(radio(no)).toBe('No');
    expect(omission(no, 'Confidential information')?.missing).toContain('22.27');
  });

  it('is a wide authority and a closed file at the same time, and says so', () => {
    // A valid form: we may do everything and may not be shown the client's own
    // rendition back. Worth a sentence rather than an assumption.
    const p = plan({ terms: terms({ matters: 'all', receivesConfidential: false }) });
    expect(checked(p, 'all property tax matters concerning the property identified')).toBe(true);
    expect(p.blocked).toBeNull();
    expect(omission(p, 'Confidential information')).toBeDefined();
  });

  it('will not limit the authority to matters it cannot name', async () => {
    const p = plan({ terms: terms({ matters: 'specific', specificMatters: null }) });
    expect(omission(p, 'specific property tax matters')?.severity).toBe('blocking');
    await expect(renderForm50162(p)).rejects.toThrow(/nothing in particular/);
  });

  it('checks only the offices actually redirected', () => {
    const p = plan({ terms: terms({ deliveries: ['arb'] }) });
    expect(checked(p, 'all communications from the appraisal review board')).toBe(true);
    expect(checked(p, 'all communications from the chief appraiser')).toBe(false);
  });

  it('says what happens when no office is redirected', () => {
    const p = plan({ terms: terms({ deliveries: [] }) });
    expect(omission(p, 'Step 4 delivery')?.missing).toContain('keep going to the client');
  });
});

describe('Steps 5 and 6', () => {
  it('leaves the expiry blank without complaint, because blank runs until revoked', () => {
    const p = plan();
    expect(cell(p, 'Date Agents Authority Ends')).toBeUndefined();
    expect(omission(p, 'Date Agents')).toBeUndefined();
  });

  it('writes an expiry where one was agreed', () => {
    expect(
      cell(plan({ terms: terms({ endsOn: '2028-12-31' }) }), 'Date Agents Authority Ends'),
    ).toBe('2028-12-31');
  });

  it('leaves the signature and its date to the hand that signs', () => {
    const p = plan();
    expect(p.text.some((t) => t.field.startsWith('Signature'))).toBe(false);
    expect(cell(p, 'Date')).toBeUndefined();
    // And does not nag about it: unsigned is the normal state of a form going
    // out for signature.
    expect(omission(p, 'Date')).toBeUndefined();
  });

  it('checks the capacity box the signer actually signed under', () => {
    const p = plan({ terms: terms({ signerCapacity: 'property-manager' }) });
    expect(checked(p, 'a property manager authorized to designate agents for the owner')).toBe(
      true,
    );
    expect(checked(p, 'the property owner')).toBe(false);
  });
});

describe('rendering onto the pinned PDF', () => {
  it('produces a form whose fields read back the way they were planned', async () => {
    const p = plan({
      terms: terms({ signedOn: '2027-01-08', endsOn: '2029-12-31', deliveries: ['arb'] }),
    });
    const form = (await PDFDocument.load(await renderForm50162(p))).getForm();
    expect(form.getTextField('Appraisal District Name').getText()).toBe(
      'Harris Central Appraisal District',
    );
    expect(form.getTextField('Name').getText()).toBe('Acme Manufacturing LLC');
    expect(form.getTextField('Name_2').getText()).toBe('Tangible Property Tax LLC');
    expect(form.getTextField('Appraisal District Account Number_2').getText()).toBe('1234567');
    expect(form.getTextField('Date').getText()).toBe('2027-01-08');
    expect(form.getCheckBox('the property(ies) listed below:').isChecked()).toBe(true);
    expect(form.getCheckBox('all property listed for me at the above address').isChecked()).toBe(
      false,
    );
    expect(form.getCheckBox('all communications from the appraisal review board').isChecked()).toBe(
      true,
    );
    expect(form.getCheckBox('the property owner').isChecked()).toBe(true);
    expect(form.getSignature('Signature1').getText?.()).toBeUndefined();
  });

  it('answers the confidentiality radio in the document itself', async () => {
    const form = (await PDFDocument.load(await renderForm50162(plan()))).getForm();
    const radios = form.getFields().filter((f) => f.constructor.name === 'PDFRadioGroup');
    expect(radios).toHaveLength(1);
    expect(form.getRadioGroup(radios[0]!.getName()).getSelected()).toBe('Yes');
  });

  it('throws naming the field if the Comptroller renames one under us', async () => {
    const p = plan();
    const broken: AppointmentFillPlan = {
      ...p,
      text: [...p.text, { field: 'Agent Name (2028 revision)', value: 'x' }],
    };
    await expect(renderForm50162(broken)).rejects.toThrow(/Agent Name \(2028 revision\)/);
  });
});
