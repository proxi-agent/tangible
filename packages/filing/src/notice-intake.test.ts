import { describe, expect, it } from 'vitest';
import type { ExtractedNotice } from '@tangible/types';
import {
  parsePrintedDate,
  proposeNoticeRecord,
  type NoticeProposalContext,
} from './notice-intake.js';

const notice = (over: Partial<ExtractedNotice> = {}): ExtractedNotice => ({
  ownerName: 'Acme Machining LLC',
  accountId: '2349508',
  taxYear: 2027,
  noticeDate: '04/15/2027',
  districtName: 'Harris Central Appraisal District',
  appraisedValue: 812_000,
  assessedValue: 812_000,
  priorYearValue: 760_000,
  protestDeadline: 'May 15, 2027',
  renditionPenaltyApplied: null,
  unreadable: [],
  ...over,
});

const context = (over: Partial<NoticeProposalContext> = {}): NoticeProposalContext => ({
  taxYear: 2027,
  clientName: 'Acme Machining',
  sites: [
    { locationId: 'loc-1', label: 'Main plant', accountId: '2349508' },
    { locationId: 'loc-2', label: 'Warehouse', accountId: '2401177' },
  ],
  ...over,
});

describe('parsePrintedDate', () => {
  it('reads the formats districts actually print', () => {
    expect(parsePrintedDate('04/15/2027')).toBe('2027-04-15');
    expect(parsePrintedDate('4/5/2027')).toBe('2027-04-05');
    expect(parsePrintedDate('May 15, 2027')).toBe('2027-05-15');
    expect(parsePrintedDate('MAY 15 2027')).toBe('2027-05-15');
    expect(parsePrintedDate('2027-04-15')).toBe('2027-04-15');
  });

  it('returns null rather than guessing', () => {
    expect(parsePrintedDate('mid-April')).toBeNull();
    expect(parsePrintedDate('02/30/2027')).toBeNull();
    expect(parsePrintedDate('13/01/2027')).toBeNull();
    expect(parsePrintedDate('')).toBeNull();
  });
});

describe('proposeNoticeRecord', () => {
  it('matches on the account number and drafts the record', () => {
    const p = proposeNoticeRecord('doc-1', notice(), context());
    expect(p.match).toEqual({
      locationId: 'loc-1',
      label: 'Main plant',
      accountId: '2349508',
      basis: 'account',
    });
    expect(p.draft.noticedOn).toBe('2027-04-15');
    expect(p.draft.printedDeadline).toBe('2027-05-15');
    expect(p.draft.appraisedValue).toBe(812_000);
    expect(p.checks.every((c) => c.ok)).toBe(true);
  });

  it('matches accounts across formatting: dashes, case, leading zeros', () => {
    const p = proposeNoticeRecord('doc-1', notice({ accountId: '00-234-9508' }), context());
    expect(p.match?.basis).toBe('account');
  });

  it('falls back to the only site, named as an assumption', () => {
    const p = proposeNoticeRecord(
      'doc-1',
      notice({ accountId: null }),
      context({ sites: [{ locationId: 'loc-1', label: 'Main plant', accountId: null }] }),
    );
    expect(p.match?.basis).toBe('only-site');
    expect(p.checks.find((c) => c.check === 'account')?.ok).toBe(false);
  });

  it('refuses to guess between two sites', () => {
    const p = proposeNoticeRecord('doc-1', notice({ accountId: '9999999' }), context());
    expect(p.match).toBeNull();
  });

  it('flags the wrong year instead of hiding it', () => {
    const p = proposeNoticeRecord('doc-1', notice({ taxYear: 2026 }), context());
    expect(p.match?.basis).toBe('account');
    const year = p.checks.find((c) => c.check === 'tax-year');
    expect(year?.ok).toBe(false);
    expect(year?.detail).toContain('2026');
  });

  it('flags an owner who is not the client', () => {
    const p = proposeNoticeRecord(
      'doc-1',
      notice({ ownerName: 'Gulf Coast Fabrication LP' }),
      context(),
    );
    expect(p.checks.find((c) => c.check === 'owner')?.ok).toBe(false);
  });

  it('accepts entity-suffix and case differences in the owner name', () => {
    const p = proposeNoticeRecord(
      'doc-1',
      notice({ ownerName: 'ACME MACHINING, LLC.' }),
      context(),
    );
    expect(p.checks.find((c) => c.check === 'owner')?.ok).toBe(true);
  });

  it('leaves the date null with a check when the scan hid it', () => {
    const p = proposeNoticeRecord('doc-1', notice({ noticeDate: null }), context());
    expect(p.draft.noticedOn).toBeNull();
    expect(p.checks.find((c) => c.check === 'notice-date')?.ok).toBe(false);
  });

  it('tolerates rows extracted before noticeDate existed', () => {
    const stored = notice();
    delete (stored as Record<string, unknown>)['noticeDate'];
    const p = proposeNoticeRecord('doc-1', stored, context());
    expect(p.draft.noticedOn).toBeNull();
  });
});
