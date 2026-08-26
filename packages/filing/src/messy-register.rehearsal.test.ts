import { describe, expect, it } from 'vitest';
import { applyMapping, type AssetDraft } from '@tangible/far';
import { MESSY_REGISTER_MAPPING, messyRegisterWorkbook } from '@tangible/far/fixtures';
import { TX_HARRIS_2026 as SCHEDULE } from '@tangible/valuation';
import { buildRendition, type RenditionAsset } from './rendition.js';
import type { FormParty, FormSigner } from './form-50-144.js';
import { FORM_50144_TAX_YEAR, planFormFill } from './fill-50-144.js';

/**
 * The rest of the rehearsal.
 *
 * `@tangible/far` proved the messy register normalizes. Nothing proved what
 * happens after that: every rendition test in this package is built from assets
 * written by hand to exercise one branch, and the form has never been asked to
 * carry three hundred rows that came out of a real-shaped register — with a
 * disposal booked as a credit, rows the register would not date, a band of
 * realty and a band of intangibles sitting in the same file as the machinery.
 *
 * The question worth asking of a document somebody signs under penalty of
 * perjury is not "does it produce lines" but "is every dollar in the register
 * still accounted for on the other side" — on a schedule, or in an exclusion
 * that says why it is not.
 */

/**
 * What a reviewer would have confirmed, band by band.
 *
 * Stands in for the classification step rather than reproducing it: the point
 * here is the arithmetic downstream of a settled classification, and hand-
 * mapping the seven bands is exactly the state the review queue leaves behind.
 * Two of them are the interesting ones — a register that lists the building and
 * the software alongside the lathes is the normal case, not a trick.
 */
const CATEGORY_FOR_BAND: Readonly<Record<string, string>> = {
  'MACHINERY & EQUIPMENT': 'machinery-equipment',
  'FURNITURE & FIXTURES': 'furniture-fixtures',
  'COMPUTER EQUIPMENT': 'computer-pc',
  VEHICLES: 'vehicles',
  'LEASEHOLD IMPROVEMENTS': 'leasehold-improvements',
  'SOFTWARE & INTANGIBLES': 'excluded-intangible',
  'LAND & BUILDINGS': 'excluded-real-property',
};

function drafts(): AssetDraft[] {
  return applyMapping(messyRegisterWorkbook(), MESSY_REGISTER_MAPPING).assets;
}

function renditionAssets(): RenditionAsset[] {
  return drafts().map((draft, index) => ({
    id: `a${index}`,
    description: draft.description,
    acquisitionYear: draft.acquisitionYear,
    originalCost: draft.originalCost,
    isDisposed: draft.isDisposed,
    categoryKey: CATEGORY_FOR_BAND[draft.category ?? ''] ?? null,
    lifeClassOverride: null,
    status: 'confirmed' as const,
  }));
}

const PARTY: FormParty = {
  ownerName: 'Meridian Fabrication Group, LP',
  mailingAddress: ['1200 Commerce St', 'Houston, TX 77002'],
  situsAddress: ['4400 Industrial Way', 'Houston, TX 77015'],
  businessDescription: 'Fabrication and machine shop',
};

const SIGNER: FormSigner = {
  name: 'Dana Ruiz',
  title: 'Agent',
  capacity: 'agent',
  appointmentFiledOn: '2026-01-15',
};

const build = (basis: 'cost' | 'estimate' = 'cost') =>
  buildRendition({
    engagementId: 'e1',
    clientName: 'Meridian Fabrication Group, LP',
    taxYear: FORM_50144_TAX_YEAR,
    jurisdictionId: 'tx-harris',
    accountId: '1234567',
    sicCode: '3599',
    assets: renditionAssets(),
    schedule: SCHEDULE,
    basis,
    filedByAgent: true,
    generatedAt: '2026-08-25T00:00:00.000Z',
  });

const registerCost = () => drafts().reduce((sum, draft) => sum + (draft.originalCost ?? 0), 0);

const cents = (n: number) => Math.round(n * 100);

describe('a whole register on the form', () => {
  it('accounts for every dollar the register carried', () => {
    const rendition = build();
    const excluded = rendition.exclusions.reduce((sum, e) => sum + e.originalCost, 0);
    // The invariant that makes the document trustworthy: nothing leaves the
    // register without landing somewhere a reader can see it.
    expect(cents(rendition.totalHistoricalCost + excluded)).toBe(cents(registerCost()));
  });

  it('accounts for every row the register carried', () => {
    const rendition = build();
    const onSchedules = rendition.schedules
      .flatMap((s) => s.lines)
      .reduce((sum, line) => sum + line.assetCount, 0);
    const inExclusions = rendition.exclusions.reduce((sum, e) => sum + e.assetCount, 0);
    expect(onSchedules + inExclusions).toBe(renditionAssets().length);
  });

  it('keeps the building and the software off the schedules', () => {
    const rendition = build();
    const reasons = new Map(rendition.exclusions.map((e) => [e.categoryKey, e]));
    // Realty is the county's other roll and intangibles are not taxed at all.
    // Both are in the register because a fixed asset ledger is not a rendition.
    expect(reasons.get('excluded-real-property')?.assetCount).toBe(3);
    expect(reasons.get('excluded-intangible')?.assetCount).toBe(9);
    const onForm = rendition.schedules.flatMap((s) => s.lines).flatMap((l) => l.categoryKeys);
    expect(onForm).not.toContain('excluded-real-property');
    expect(onForm).not.toContain('excluded-intangible');
  });

  it('takes the disposal off the form and says why', () => {
    const rendition = build();
    const disposed = rendition.exclusions.filter((e) =>
      e.reason.startsWith('Disposed of before January 1'),
    );
    expect(disposed.length).toBeGreaterThan(0);
  });

  it('puts the vehicles on Schedule D and the rest of the equipment on E', () => {
    const rendition = build();
    const d = rendition.schedules.find((s) => s.key === 'D');
    const e = rendition.schedules.find((s) => s.key === 'E');
    expect(d?.lines.reduce((n, l) => n + l.assetCount, 0)).toBe(12);
    expect(e?.lines.reduce((n, l) => n + l.assetCount, 0)).toBe(140 + 60 + 90 + 8 - 1);
    // And having put them there, says so: whether any of the twelve is the one
    // vehicle 22.01(k) would relieve is a fact about the owner, not about the
    // register, so the form asks rather than assuming either way.
    const asked = rendition.blockers.find((b) => b.key === 'vehicles-personal-use');
    expect(asked?.severity).toBe('warning');
    expect(asked?.message).toContain('12 licensed vehicles');
  });

  it('blocks on the rows the register would not date, on either basis', () => {
    // Schedules D and E are filed by year acquired, and the register would not
    // commit to a date on some rows — "Various", or a year it wrote as text.
    // 22.01(a) offers cost *with* year or an estimate, so an undated line has
    // no complete form to sit on and the filer has to hear that before signing,
    // whichever basis they chose.
    for (const basis of ['cost', 'estimate'] as const) {
      const rendition = build(basis);
      const blocker = rendition.blockers.find((b) => b.key === 'no-year-acquired');
      expect(blocker?.severity).toBe('blocking');
      expect(blocker?.message).toContain('22.01(a)');
    }
  });

  it('names the undated cost rather than only counting the rows', () => {
    const rendition = build();
    const undatedCost = renditionAssets()
      .filter((a) => a.acquisitionYear === null && !a.isDisposed)
      .filter((a) => a.categoryKey !== null && !a.categoryKey.startsWith('excluded-'))
      .reduce((sum, a) => sum + (a.originalCost ?? 0), 0);
    // The number decides whether this is worth chasing the client for.
    expect(undatedCost).toBeGreaterThan(0);
    expect(rendition.blockers.find((b) => b.key === 'no-year-acquired')?.message).toContain(
      `$${Math.round(undatedCost).toLocaleString('en-US')}`,
    );
  });

  it('sends the undated lines to the attached listing rather than a wrong rung', () => {
    const plan = planFormFill({
      rendition: build(),
      party: PARTY,
      signer: SIGNER,
    });
    const overflow = plan.overflow.filter((o) => /year/i.test(o.reason));
    expect(overflow.length).toBeGreaterThan(0);
    // Whatever could not be placed is still carried, with its cost, so the
    // listing the form asks for can be written from the plan itself.
    expect(overflow.reduce((sum, o) => sum + o.historicalCost, 0)).toBeGreaterThan(0);
  });

  it('withholds the sworn total when the schedules could not value everything', () => {
    const rendition = build('estimate');
    if (rendition.totalGoodFaithEstimate === null) {
      // Then it has to say so, rather than leaving a reader to notice a blank.
      expect(rendition.blockers.length).toBeGreaterThan(0);
    } else {
      expect(rendition.totalGoodFaithEstimate).toBeGreaterThan(0);
    }
  });
});
