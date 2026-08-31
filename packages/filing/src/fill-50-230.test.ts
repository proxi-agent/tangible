import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  planOverAppraisalFill,
  renderForm50230,
  type OverAppraisalFillInput,
  type OverAppraisalFillPlan,
} from './fill-50-230.js';
import type { MotionMovant, MotionSubject } from './fill-motion.js';

const movant = (over: Partial<MotionMovant> = {}): MotionMovant => ({
  ownerName: 'Acme Manufacturing LLC',
  signerName: 'Maria Delgado',
  phone: '(713) 555-0142',
  mailingAddress: '1200 Commerce St',
  cityStateZip: 'Houston, TX 77002',
  signedOn: null,
  appointmentOnFile: true,
  ...over,
});

const subject = (over: Partial<MotionSubject> = {}): MotionSubject => ({
  county: 'Harris',
  districtName: 'Harris Central Appraisal District',
  accountId: '1234567',
  description: 'Business personal property',
  location: '4400 Industrial Way, Houston, TX 77015',
  taxYear: 2024,
  certifiedOn: '2024-07-19',
  ...over,
});

const plan = (over: Partial<OverAppraisalFillInput> = {}): OverAppraisalFillPlan =>
  planOverAppraisalFill({
    route: 'd',
    movant: movant(),
    subject: subject(),
    taxingUnits: ['Harris County', 'Houston ISD'],
    errors: 'Inventory was rendered at replacement cost rather than market.',
    overByOneThird: true,
    rolledValue: 4_000_000,
    claimedValue: 2_400_000,
    ...over,
  });

const cell = (p: OverAppraisalFillPlan, field: string) =>
  p.text.find((t) => t.field === field)?.value;
const omission = (p: OverAppraisalFillPlan, field: string) =>
  p.omissions.find((o) => o.field === field);

describe('which form this is', () => {
  it('refuses a (c) or (c-1) motion and names the form that carries them', async () => {
    for (const route of ['c', 'c-1'] as const) {
      const p = plan({ route });
      expect(omission(p, 'Form')?.severity).toBe('blocking');
      expect(p.blocked).toContain('50-771');
      await expect(renderForm50230(p)).rejects.toThrow(/50-771/);
    }
  });
});

describe('the one-third test', () => {
  it('takes the answer from whoever computed it rather than recomputing it', () => {
    // motionDraftBlocker already measures the error against the *correct*
    // value, which is how (d) is written. Two implementations of one threshold
    // is one more than can be kept right.
    expect(plan({ overByOneThird: true }).blocked).toBeNull();
  });

  it('will not sign an assertion the numbers do not support', async () => {
    const p = plan({ overByOneThird: false });
    expect(p.blocked).toContain('does not pass');
    await expect(renderForm50230(p)).rejects.toThrow(/asserts in its own body/);
  });

  it('treats an unrun test exactly as a failed one', async () => {
    const p = plan({ overByOneThird: null });
    expect(omission(p, 'One-third test')?.severity).toBe('blocking');
    expect(p.blocked).toContain('Nobody has run');
    await expect(renderForm50230(p)).rejects.toThrow();
  });
});

describe('the caption', () => {
  it('fills both district blanks from one field, and both take the county', () => {
    // COname has two widgets: the opening sentence and "located within the
    // ______ County Appraisal District". The form printed the other two words.
    const p = plan();
    expect(cell(p, 'COname')).toBe('Harris');
    expect(cell(p, 'CO')).toBe('Harris');
    expect(cell(p, 'COap')).toBe('Harris');
  });

  it('leaves the chief appraiser’s blank empty on an owner’s motion', () => {
    // Writing the client's name there files a motion claiming they are the
    // district's chief appraiser.
    expect(cell(plan(), 'MOname')).toBeUndefined();
    expect(cell(plan(), 'PropNm')).toBe('Acme Manufacturing LLC');
  });

  it('runs the month and day into one blank, unlike 50-771’s three', () => {
    const p = plan();
    expect(cell(p, 'MonDy')).toBe('July 19');
    expect(cell(p, 'Year')).toBe('2024');
    expect(cell(p, 'TxYr')).toBe('2024');
  });

  it('will not ask a board to change a roll it cannot identify', async () => {
    const p = plan({ subject: subject({ certifiedOn: null }) });
    expect(omission(p, 'MonDy')?.severity).toBe('blocking');
    await expect(renderForm50230(p)).rejects.toThrow(/certification date/);
  });
});

describe('what winning costs', () => {
  it('prices the (d-1) penalty as a share of the saving, with no rate', () => {
    // Penalty is 10% of the tax on the corrected value; the saving is the tax
    // on the reduction. The rate cancels: 10% × 2.4M ÷ 1.6M = 15%.
    const caution = omission(plan(), 'Tax Code 25.25(d-1)')?.missing;
    expect(caution).toContain('15 percent of whatever this motion saves');
  });

  it('never claims a share it cannot compute', () => {
    const p = plan({ rolledValue: null });
    const caution = omission(p, 'Tax Code 25.25(d-1)')?.missing;
    expect(caution).toContain('$2,400,000');
    expect(caution).not.toContain('percent of whatever');
  });

  it('is a warning, not a blocker — the client decides whether it is worth it', () => {
    expect(omission(plan(), 'Tax Code 25.25(d-1)')?.severity).toBe('warning');
    expect(plan().blocked).toBeNull();
  });

  it('says out loud what signing certifies about the tax bill', () => {
    expect(omission(plan(), 'Tax Code 25.26')?.missing).toContain('2024');
  });
});

describe('the rest of it', () => {
  it('has no boxes to tick', () => {
    // Unlike 50-771 this form selects nothing: (d) is the only ground it has.
    expect(plan().choices).toHaveLength(0);
  });

  it('is the statement of the error, and there is no motion without one', async () => {
    const p = plan({ errors: null });
    expect(omission(p, 'ErrDes')?.severity).toBe('blocking');
    await expect(renderForm50230(p)).rejects.toThrow(/does not state the over-appraisal/);
  });

  it('never touches the signature field', () => {
    expect(plan().text.some((t) => t.field === 'Sig')).toBe(false);
  });

  it('blocks an agent signature the district has no designation for', async () => {
    const p = plan({ movant: movant({ appointmentOnFile: false }) });
    expect(omission(p, 'Sig')?.severity).toBe('blocking');
    await expect(renderForm50230(p)).rejects.toThrow(/no appointment on file/);
  });
});

describe('the pinned PDF', () => {
  it('has every field this planner writes to', async () => {
    const pdf = await PDFDocument.load(
      await renderForm50230(plan({ movant: movant({ signedOn: '01/14/2026' }) })),
    );
    const form = pdf.getForm();
    expect(form.getTextField('PropNm').getText()).toBe('Acme Manufacturing LLC');
    expect(form.getTextField('COname').getText()).toBe('Harris');
    expect(form.getTextField('Date').getText()).toBe('01/14/2026');
    expect(form.getTextField('MOname').getText()).toBeUndefined();
  });
});
