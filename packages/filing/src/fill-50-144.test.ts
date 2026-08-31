import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { TX_HARRIS_2026 as S } from '@tangible/valuation';
import { buildRendition, type RenditionAsset, type RenditionInput } from './rendition.js';
import type { FormParty, FormSigner } from './form-50-144.js';
import {
  FORM_50144_TAX_YEAR,
  planFormFill,
  renderForm50144,
  type FormFillPlan,
} from './fill-50-144.js';

let nextId = 0;
const asset = (over: Partial<RenditionAsset> = {}): RenditionAsset => ({
  id: `a${nextId++}`,
  description: 'Lathe',
  acquisitionYear: 2022,
  originalCost: 100_000,
  isDisposed: false,
  categoryKey: 'machinery-equipment',
  lifeClassOverride: null,
  status: 'confirmed',
  ...over,
});

const rendition = (assets: RenditionAsset[], over: Partial<RenditionInput> = {}) =>
  buildRendition({
    engagementId: 'e1',
    clientName: 'Acme',
    taxYear: FORM_50144_TAX_YEAR,
    jurisdictionId: 'tx-harris',
    accountId: '1234567',
    sicCode: '3599',
    assets,
    schedule: S,
    basis: 'cost',
    filedByAgent: true,
    generatedAt: '2026-08-19T00:00:00.000Z',
    ...over,
  });

const party = (over: Partial<FormParty> = {}): FormParty => ({
  ownerName: 'Acme Manufacturing LLC',
  mailingAddress: ['1200 Commerce St', 'Houston, TX 77002'],
  situsAddress: ['4400 Industrial Way', 'Houston, TX 77015'],
  businessDescription: 'Machine shop, precision parts',
  ...over,
});

const signer = (over: Partial<FormSigner> = {}): FormSigner => ({
  name: 'Dana Ruiz',
  title: 'Agent',
  capacity: 'agent',
  appointmentFiledOn: '2026-01-15',
  ...over,
});

const plan = (assets: RenditionAsset[], over: Partial<RenditionInput> = {}, who = {}) =>
  planFormFill({
    rendition: rendition(assets, over),
    party: party(),
    signer: signer(),
    ...who,
  });

const cell = (p: FormFillPlan, field: string) => p.text.find((t) => t.field === field)?.value;
const chosen = (p: FormFillPlan, field: string) => p.choices.find((c) => c.field === field)?.option;
const omission = (p: FormFillPlan, prefix: string) =>
  p.omissions.find((o) => o.field.startsWith(prefix));

describe('the Schedule E ladder', () => {
  it('puts a cost on the rung its year names, not the row we happen to reach', () => {
    // 2026 − 2022 = the fourth rung of Machinery and Equipment, which is
    // sub-table B on the form even though the schedule is E.
    const p = plan([asset({ acquisitionYear: 2022, originalCost: 100_000 })]);
    expect(cell(p, 'HCWN_4B')).toBe('100000');
    expect(cell(p, 'HCWN_1B')).toBeUndefined();
    expect(cell(p, 'HCWNT_15B')).toBe('100000');
  });

  it('folds everything older than the bottom rung into the “& Prior” bucket', () => {
    const p = plan([
      asset({ acquisitionYear: 2001, originalCost: 40_000 }),
      asset({ acquisitionYear: 1995, originalCost: 60_000 }),
    ]);
    // Two lines, twenty-two years apart, one box.
    expect(cell(p, 'HCWN_14B')).toBe('100000');
    expect(p.overflow).toHaveLength(0);
  });

  it('sends property the form has no table for to Other, and names it there', () => {
    const p = plan([asset({ categoryKey: 'vessels', acquisitionYear: 2022 })]);
    expect(cell(p, 'HCWN_4F')).toBe('100000');
    expect(cell(p, 'Description_4')).toBeTruthy();
  });

  it('reports a line it cannot place rather than rounding it onto a rung', () => {
    const p = plan([asset({ acquisitionYear: null, originalCost: 75_000 })]);
    expect(p.text.some((t) => t.field.startsWith('HCWN_'))).toBe(false);
    const [missed] = p.overflow;
    expect(missed?.reason).toContain('no year acquired');
    expect(missed?.historicalCost).toBe(75_000);
  });

  it('refuses the ladder when the tax year is not the one printed on it', async () => {
    const p = plan([asset()], { taxYear: FORM_50144_TAX_YEAR + 1 });
    const blocked = omission(p, 'Schedule E year ladder');
    expect(blocked?.severity).toBe('blocking');
    expect(blocked?.missing).toContain('wrong year');
    expect(p.blocked).toContain(String(FORM_50144_TAX_YEAR + 1));
    await expect(renderForm50144(p)).rejects.toThrow(/one rung off/);
  });
});

describe('what it will not write', () => {
  it('leaves the signature and the date to the person who signs', () => {
    const p = plan([asset()]);
    const fields = p.text.map((t) => t.field);
    expect(fields).not.toContain('Signature of Authorized Individual');
    expect(fields).not.toContain('Date of Signature');
    expect(omission(p, 'Signature and date')?.missing).toContain('nobody swore anything');
  });

  it('will not tick a market-value box on a rendition filed at cost', () => {
    const p = plan([asset()]);
    expect(chosen(p, 'Total market value of your property-2')).toBeUndefined();
    expect(p.choices.some((c) => c.field === 'S5_market value')).toBe(false);
    expect(omission(p, 'Market value $125,000')?.missing).toContain('assertion');
  });

  it('answers the market-value box once the estimate basis gives it a number', () => {
    const p = plan([asset({ originalCost: 20_000, acquisitionYear: 2018 })], {
      basis: 'estimate',
    });
    expect(chosen(p, 'Total market value of your property-2')).toBe('$125,000 or less');
    expect(chosen(p, 'S5_market value')).toBeNull();
  });

  it('writes no estimate column at all when filing on cost', () => {
    const p = plan([asset()]);
    expect(p.text.some((t) => t.field.startsWith('GFEMV'))).toBe(false);
  });
});

describe('the short printed tables', () => {
  it('counts the vehicle lines that will not fit rather than dropping them', () => {
    const p = plan(
      [2018, 2019, 2020, 2021, 2022].map((year) =>
        asset({ categoryKey: 'vehicles', acquisitionYear: year, originalCost: 100_000 }),
      ),
    );
    expect(cell(p, 'ScD:Historical Cost When New Omit CentsRow3')).toBe('100,000');
    expect(cell(p, 'ScD:Historical Cost When New Omit CentsRow4')).toBeUndefined();
    const spill = p.overflow.find((o) => o.schedule.startsWith('Schedule D'));
    expect(spill?.historicalCost).toBe(200_000);
    expect(spill?.reason).toContain('attach the listing');
  });

  it('fills inventory as the one line it is, and says where it is taxable', () => {
    const p = plan([asset({ categoryKey: 'inventory', originalCost: 50_000 })]);
    expect(cell(p, 'ScB:Historical Cost When NewRow1')).toBe('50,000');
    expect(cell(p, 'ScB:Property Address or Address Where TaxableRow1')).toContain('Houston');
  });

  it('takes the simplified path when the whole account is under $20,000', () => {
    // The form's own shortcut: one line on Schedule A, no year, no breakdown.
    const p = plan([asset({ originalCost: 2_000 })]);
    expect(chosen(p, 'Total market value of your property')).toBe('under $20,000');
    expect(cell(p, 'ScA:General Property Description by TypeCategoryRow1')).toContain(
      'All business personal property',
    );
    expect(p.text.some((t) => t.field.startsWith('HCWN_'))).toBe(false);
  });

  it('blocks on Schedule F, where the register knows the property but not its owner', () => {
    const p = plan([asset({ categoryKey: 'excluded-leased-in', originalCost: 300_000 })]);
    expect(cell(p, 'General Property DescriptionRow1')).toBeTruthy();
    expect(omission(p, 'Schedule F owner')?.severity).toBe('blocking');
  });
});

describe('against the real form', () => {
  it('writes every mapped field onto the Comptroller’s PDF', async () => {
    const p = plan([
      asset({ acquisitionYear: 2022, originalCost: 100_000 }),
      asset({ categoryKey: 'inventory', acquisitionYear: 2024, originalCost: 5_000 }),
    ]);
    // Throws by design if any name in the map is absent from the PDF.
    const bytes = await renderForm50144(p);
    const form = (await PDFDocument.load(bytes)).getForm();
    expect(form.getTextField('HCWN_4B').getText()).toBe('100000');
    expect(form.getTextField('Tax Year').getText()).toBe(String(FORM_50144_TAX_YEAR));
    expect(form.getRadioGroup('Representation').getSelected()).toBe('Authorized Agent');
    expect(form.getRadioGroup('secured party').getSelected()).toBe('No');
    expect(form.getTextField('Property Location Address, City, State, ZIP Code').getText()).toBe(
      '4400 Industrial Way, Houston, TX 77015',
    );
  });

  it('survives the form recalculating its own totals', async () => {
    // Every TOTAL on page 3 carries AFSimple_Calculate("SUM", …) over the rungs
    // above it. If a viewer runs that script our total must not move, which it
    // will if the rungs are stored comma-grouped and the sum reads 100 for
    // 100,000. Number() here stands in for the form's own AFMakeNumber.
    // Estimates, not costs: depreciation is what puts fractions in these cells,
    // and eight of them is enough for the fractions to carry. This exact ladder
    // sums to 36,298 whole and 36,297 rounded rung by rung.
    const p = plan(
      [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018].map((year, i) =>
        asset({ acquisitionYear: year, originalCost: 5_000 + i * 37 }),
      ),
      { basis: 'estimate' },
    );
    for (const prefix of ['HCWN', 'GFEMV']) {
      const rungs = p.text.filter((t) => new RegExp(`^${prefix}_\\d+B$`).test(t.field));
      expect(rungs).toHaveLength(8);
      const recalculated = rungs.reduce((sum, t) => sum + Number(t.value), 0);
      const total = prefix === 'HCWN' ? 'HCWNT_15B' : 'GFEMVT_15B';
      expect(Number(cell(p, total))).toBe(recalculated);
    }
    expect(cell(p, 'GFEMVT_15B')).toBe('36297');
  });

  it('spells every capacity the way the form’s own radio does', async () => {
    const form = (
      await PDFDocument.load(
        await import('node:fs/promises').then((fs) =>
          fs.readFile(new URL('../assets/50-144.pdf', import.meta.url)),
        ),
      )
    ).getForm();
    const options = form.getRadioGroup('Representation').getOptions();
    for (const capacity of ['owner', 'employee', 'agent', 'fiduciary', 'secured-party'] as const) {
      const p = plan([asset()], {}, { signer: signer({ capacity }) });
      expect(options).toContain(chosen(p, 'Representation'));
    }
  });
});
