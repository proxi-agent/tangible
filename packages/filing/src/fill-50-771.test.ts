import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  MOTION_GROUNDS,
  planMotionFill,
  renderForm50771,
  type MotionFillInput,
  type MotionFillPlan,
} from './fill-50-771.js';
import { certificationDate, type MotionMovant, type MotionSubject } from './fill-motion.js';

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

const plan = (over: Partial<MotionFillInput> = {}): MotionFillPlan =>
  planMotionFill({
    route: 'c-1',
    ground: 'omitted-tpp',
    movant: movant(),
    subject: subject(),
    taxingUnits: ['Harris County', 'Houston ISD'],
    errors: 'The register double-counted improvements already carried on the real account.',
    ...over,
  });

const cell = (p: MotionFillPlan, field: string) => p.text.find((t) => t.field === field)?.value;
const omission = (p: MotionFillPlan, field: string) => p.omissions.find((o) => o.field === field);

describe('which form this is', () => {
  it('refuses a (d) motion and names the form that carries it', async () => {
    const p = plan({ route: 'd' });
    expect(omission(p, 'Form')?.severity).toBe('blocking');
    expect(p.blocked).toContain('50-230');
    await expect(renderForm50771(p)).rejects.toThrow(/50-230/);
  });

  it('takes both of the subsections it prints on its face', () => {
    expect(plan({ route: 'c' }).blocked).toBeNull();
    expect(plan({ route: 'c-1' }).blocked).toBeNull();
  });
});

describe('the caption', () => {
  it('puts the county in both county blanks, and the district in neither', () => {
    const p = plan();
    expect(cell(p, '1')).toBe('Harris');
    expect(cell(p, '2')).toBe('Harris');
  });

  it('folds the district name into the sentence the form already half-wrote', () => {
    // The page prints "located within the ______ Appraisal District".
    expect(cell(plan(), '16')).toBe('Harris Central');
  });

  it('leaves that blank for a hand rather than naming an entity that is not there', () => {
    const p = plan({ subject: subject({ districtName: 'Tax Appraisal District of Bell County' }) });
    expect(cell(p, '16')).toBeUndefined();
    expect(omission(p, '16')?.missing).toContain('by hand');
    // Still filable: the sentence is a recital, not the motion.
    expect(p.blocked).toBeNull();
  });

  it('will not open a motion in no county at all', async () => {
    const p = plan({ subject: subject({ county: null }) });
    expect(omission(p, '1')?.severity).toBe('blocking');
    await expect(renderForm50771(p)).rejects.toThrow(/No county named/);
  });
});

describe('the certified roll', () => {
  it('splits the date into the three blanks the form prints', () => {
    const p = plan();
    expect([cell(p, '7'), cell(p, '8'), cell(p, '9')]).toEqual(['19', 'July', '2024']);
  });

  it('reads the date as UTC, so the day is the day', () => {
    // Parsed as local time in a US timezone, this lands on the 31st.
    expect(certificationDate('2024-08-01')?.day).toBe('1');
    expect(certificationDate('not-a-date')).toBeNull();
  });

  it('refuses to ask a board to change a roll it cannot identify', async () => {
    const p = plan({ subject: subject({ certifiedOn: null }) });
    expect(omission(p, '7')?.severity).toBe('blocking');
    await expect(renderForm50771(p)).rejects.toThrow(/certification date/);
  });
});

describe('the ground', () => {
  it('writes the year into the blank belonging to the ground that was chosen', () => {
    const p = plan({ ground: 'omitted-tpp', subject: subject({ taxYear: 2023 }) });
    expect(cell(p, '15')).toBe('2023');
    // Not into any of the other four.
    expect(['11', '12', '13', '14'].map((f) => cell(p, f))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('asks the board for nothing it can grant when no ground is chosen', async () => {
    const p = plan({ ground: null });
    expect(omission(p, '10')?.severity).toBe('blocking');
    await expect(renderForm50771(p)).rejects.toThrow(/No ground selected/);
  });

  it('turns exactly one of the five shared widgets on, whichever ground it is', async () => {
    // The five options share one field name and differ only by appearance
    // state. pdf-lib reads that as a check box, and a check box's own check()
    // would claim a clerical error every time.
    for (const ground of MOTION_GROUNDS) {
      const pdf = await PDFDocument.load(await renderForm50771(plan({ ground })));
      const field = pdf.getForm().getField('10') as unknown as {
        acroField: { dict: { get: (k: PDFName) => unknown }; getWidgets: () => unknown[] };
      };
      const states = field.acroField
        .getWidgets()
        .map((w) =>
          String((w as { dict: { get: (k: PDFName) => unknown } }).dict.get(PDFName.of('AS'))),
        );
      expect(
        states.filter((s) => s !== '/Off'),
        ground,
      ).toHaveLength(1);
      expect(String(field.acroField.dict.get(PDFName.of('V'))), ground).toBe(
        states.find((s) => s !== '/Off'),
      );
    }
  });
});

describe('what the motion actually says', () => {
  it('is the statement of errors, and there is no motion without one', async () => {
    const p = plan({ errors: '   ' });
    expect(omission(p, '18')?.severity).toBe('blocking');
    await expect(renderForm50771(p)).rejects.toThrow(/does not state the error/);
  });

  it('lists the taxing units the board has to notify', () => {
    expect(cell(plan(), '17')).toBe('Harris County, Houston ISD');
    expect(omission(plan({ taxingUnits: [] }), '17')?.missing).toContain('presiding officer');
  });

  it('counts the box rather than truncating the firm’s own words', () => {
    const p = plan({ errors: 'y'.repeat(700) });
    expect(cell(p, '18')?.length).toBe(700);
    expect(omission(p, '18')?.missing).toContain('700 characters');
    expect(p.blocked).toBeNull();
  });
});

describe('signing it', () => {
  it('never touches the signature field', () => {
    expect(plan().text.some((t) => t.field === '19')).toBe(false);
  });

  it('says out loud what signing certifies about the tax bill', () => {
    // 25.26 is printed as a finished sentence, so nobody is asked. They are
    // still certifying it.
    expect(omission(plan(), 'Tax Code 25.26')?.missing).toContain('2024');
    expect(omission(plan(), 'Tax Code 25.26')?.severity).toBe('warning');
  });

  it('blocks an agent signature the district has no designation for', async () => {
    const p = plan({ movant: movant({ appointmentOnFile: false }) });
    expect(omission(p, '19')?.severity).toBe('blocking');
    await expect(renderForm50771(p)).rejects.toThrow(/no appointment on file/);
  });
});

describe('the pinned PDF', () => {
  it('has every field this planner writes to', async () => {
    const pdf = await PDFDocument.load(
      await renderForm50771(plan({ movant: movant({ signedOn: '01/14/2026' }) })),
    );
    const form = pdf.getForm();
    expect(form.getTextField('3').getText()).toBe('Acme Manufacturing LLC');
    expect(form.getTextField('16').getText()).toBe('Harris Central');
    expect(form.getTextField('20').getText()).toBe('01/14/2026');
  });
});
