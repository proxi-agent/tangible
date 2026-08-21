import { describe, expect, it } from 'vitest';
import { TX_HARRIS_2026 as S } from '@tangible/valuation';
import { buildRendition, type RenditionAsset, type RenditionInput } from './rendition.js';
import {
  buildForm50144,
  type Form50144Input,
  type FormParty,
  type FormSigner,
} from './form-50-144.js';

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
    taxYear: 2027,
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

const form = (over: Partial<Form50144Input> = {}) =>
  buildForm50144({
    rendition: rendition([asset()]),
    party: party(),
    signer: signer(),
    audience: 'district',
    ...over,
  });

const field = (fields: { label: string; value: string | null }[], label: string) =>
  fields.find((f) => f.label.startsWith(label));
const omission = (f: ReturnType<typeof form>, field: string) =>
  f.omissions.find((o) => o.field === field);
const table = (f: ReturnType<typeof form>, key: string) => f.schedules.find((s) => s.key === key);

describe('what goes in the boxes', () => {
  it('carries the owner and the situs as separate answers', () => {
    const f = form();
    expect(field(f.owner, 'Mailing address')?.value).toBe('1200 Commerce St\nHouston, TX 77002');
    expect(field(f.property, 'Address where')?.value).toBe(
      '4400 Industrial Way\nHouston, TX 77015',
    );
    expect(f.omissions).toHaveLength(0);
  });

  it('blocks on a missing situs rather than printing a blank', () => {
    const f = form({ party: party({ situsAddress: [] }) });
    expect(omission(f, 'Situs address')?.severity).toBe('blocking');
    expect(field(f.property, 'Address where')?.value).toBeNull();
  });

  it('treats a missing account as filable but worth knowing about', () => {
    const f = form({ rendition: rendition([asset()], { accountId: null }) });
    expect(omission(f, 'Account number')?.severity).toBe('warning');
  });

  it('will not let an agent sign without an appointment on file', () => {
    const f = form({ signer: signer({ appointmentFiledOn: null }) });
    expect(omission(f, 'Agent appointment')?.severity).toBe('blocking');
  });

  it('asks about the appointment once, not twice', () => {
    // `buildRendition` raises a generic agent reminder because it cannot see an
    // appointment. This module can, so it answers specifically — and saying it
    // both ways is how an omissions list stops being read.
    const f = form({ signer: signer({ appointmentFiledOn: null }) });
    expect(f.omissions.filter((o) => /agent/i.test(o.field))).toHaveLength(1);
    expect(omission(f, 'agent-appointment')).toBeUndefined();
  });

  it('checks exactly one capacity', () => {
    const f = form({ signer: signer({ capacity: 'owner' }) });
    expect(f.representation.filter((c) => c.checked)).toHaveLength(1);
    expect(f.representation.find((c) => c.checked)?.label).toContain('Owner');
  });
});

describe('the estimate column', () => {
  it('states nothing on the cost basis, because the form does not ask', () => {
    const f = form();
    expect(table(f, 'E')?.rows[0]?.goodFaithEstimate).toBe('—');
    expect(field(f.totals, 'Total good faith')?.value).toBeNull();
  });

  it('withholds an estimate it cannot support instead of filing zero', () => {
    // No acquisition year, so the schedules have nothing to index from. Zero
    // here would swear the property is worthless.
    const r = rendition([asset({ acquisitionYear: null })], {
      basis: 'estimate',
    });
    const f = buildForm50144({
      rendition: r,
      party: party(),
      signer: signer(),
      audience: 'district',
    });
    const cells = table(f, 'E')?.rows.map((row) => row.goodFaithEstimate) ?? [];
    expect(cells).toContain('withheld');
    expect(cells).not.toContain('$0');
  });
});

describe('audience', () => {
  it('keeps our reasoning off the copy the district gets', () => {
    const r = rendition([asset()]);
    const withDecision = {
      ...r,
      decisions: [
        {
          source: 'savings' as const,
          key: 'leasehold-double-tax',
          title: 'Leasehold improvements possibly taxed twice',
          taxYear: 2027,
          status: 'accepted' as const,
          decidedBy: 'dana@example.com',
          decidedAt: '2026-08-19T00:00:00.000Z',
          cost: 54_300,
          removedCost: 108_600,
          removedAssetCount: 2,
          effectOnForm: 'Takes $108,600 of leasehold improvements off Schedule E.',
        },
      ],
    };
    const district = buildForm50144({
      rendition: withDecision,
      party: party(),
      signer: signer(),
      audience: 'district',
    });
    const file = buildForm50144({
      rendition: withDecision,
      party: party(),
      signer: signer(),
      audience: 'file',
    });

    expect(district.decisions).toHaveLength(0);
    expect(file.decisions).toHaveLength(1);
    expect(file.decisions[0]?.value).toContain('accepted');
    expect(file.decisions[0]?.value).toContain('108,600');

    // Our own schedule arithmetic is not part of the filing either.
    expect(field(district.totals, 'Value on the district')).toBeUndefined();
    expect(field(file.totals, 'Value on the district')?.value).toBeTruthy();
  });
});

describe('overflow', () => {
  it('counts what will not fit the printed table rather than dropping it', () => {
    // Schedule D holds three rows. Five years of vehicles is five lines.
    const assets = Array.from({ length: 5 }, (_, i) =>
      asset({ categoryKey: 'vehicles', acquisitionYear: 2018 + i, originalCost: 100_000 }),
    );
    const f = form({ rendition: rendition(assets) });
    const d = table(f, 'D');
    expect(d?.rows).toHaveLength(5);
    expect(d?.continuationRows).toBe(2);
    // The total on the form still covers every row, attached or not.
    expect(d?.totalCost).toBe('$500,000');
  });

  it('never asks Schedule E for a continuation, however many years it holds', () => {
    // Thirty distinct years of machinery. On the printed form they collapse
    // onto fourteen rungs, the oldest seventeen sharing the "& Prior" bucket,
    // so there is nothing to attach — see `planFormFill`.
    const assets = Array.from({ length: 30 }, (_, i) =>
      asset({ acquisitionYear: 1996 + i, originalCost: 10_000 }),
    );
    const e = table(form({ rendition: rendition(assets) }), 'E');
    expect(e?.rows).toHaveLength(30);
    expect(e?.continuationRows).toBe(0);
    expect(e?.totalCost).toBe('$300,000');
  });
});

describe('the signature block', () => {
  it('says what signing asserts and what it costs to get wrong', () => {
    const f = form();
    expect(f.signature.penaltyNotice).toContain('22.28');
    expect(f.signature.capacityLabel).toContain('50-162');
    expect(f.signature.notarization.required).toBe(false);
  });

  it('carries the blocking reasons the rendition already found', () => {
    const f = form({ rendition: rendition([asset({ status: 'needs-review' })]) });
    expect(f.omissions.some((o) => o.severity === 'blocking')).toBe(true);
  });
});
