import type {
  ExtractedNotice,
  NoticeDraft,
  NoticeMatch,
  NoticeProposalCheck,
  NoticeRecordProposal,
} from '@tangible/types';

/**
 * Turn a notice the extraction read into a record somebody can confirm.
 *
 * In season the districts mail paper: a notice of appraised value per account,
 * April into May, and every one of them starts the clocks the moment it is
 * dated. The extraction already reads the scan; this module does the other
 * half — says which site the notice belongs to, drafts the record, and lists
 * what it checked getting there.
 *
 * Deliberately not a model call. The join key is the account number, and the
 * district prints it precisely so that matching is arithmetic, not judgment.
 * Where the arithmetic runs out (no account readable, more than one site) the
 * proposal says so instead of guessing, and the reviewer types the site the
 * way they always could. Nothing here writes: the draft goes through the same
 * recordNotice path a hand-typed notice takes, behind the same confirm.
 */

export interface NoticeSiteCandidate {
  locationId: string;
  label: string;
  accountId: string | null;
}

export interface NoticeProposalContext {
  /** The engagement's tax year — the year the record will be filed under. */
  taxYear: number;
  /** The client on the engagement, for the owner-name check. */
  clientName: string | null;
  /** The sites owing a return on this engagement, with their roll accounts. */
  sites: NoticeSiteCandidate[];
}

/** Account numbers as the roll sees them: digits and letters only, case and leading zeros ignored. */
function normalizeAccount(id: string): string {
  return id
    .replace(/[^0-9a-z]/gi, '')
    .replace(/^0+/, '')
    .toUpperCase();
}

/** Names as a comparison sees them: case, punctuation and entity suffixes ignored. */
function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\b(LLC|LP|LLP|INC|CORP|CO|LTD|COMPANY|INCORPORATED|CORPORATION)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

/**
 * A printed date into ISO, or null where it will not parse.
 *
 * Notices print dates the way each district's mail system does — "04/15/2026",
 * "April 15, 2026", "2026-04-15". Anything this cannot read stays null and
 * becomes a check, never a guess: a wrong date starts a wrong clock, and the
 * reviewer fixing a blank beats the reviewer not noticing a fabrication.
 */
export function parsePrintedDate(printed: string): string | null {
  const text = printed.trim();

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return isoOrNull(+m[1]!, +m[2]!, +m[3]!);

  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (m) return isoOrNull(+m[3]!, +m[1]!, +m[2]!);

  m = /^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/.exec(text);
  if (m) {
    const upper = m[1]!.toUpperCase();
    const month = MONTHS.findIndex((name) => name === upper || name.slice(0, 3) === upper);
    if (month >= 0) return isoOrNull(+m[3]!, month + 1, +m[2]!);
  }

  return null;
}

function isoOrNull(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1990 || year > 2100) return null;
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Round-trip through UTC catches the residue: February 30 parses above and dies here.
  const date = new Date(`${iso}T00:00:00Z`);
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
    ? iso
    : null;
}

/**
 * Propose the record. Pure: same notice, same sites, same proposal.
 *
 * The match ladder is short on purpose. The account number is the district's
 * own join key and wins outright; a one-site engagement leaves an unmatched
 * notice exactly one place to belong, proposed with that assumption named; and
 * everything else is honestly no match, because recording a notice against the
 * wrong site starts a real clock on the wrong property.
 */
export function proposeNoticeRecord(
  documentId: string,
  extracted: ExtractedNotice,
  context: NoticeProposalContext,
): Omit<NoticeRecordProposal, 'alreadyRecorded'> {
  const checks: NoticeProposalCheck[] = [];

  // --- the site -----------------------------------------------------------
  const noticeAccount = extracted.accountId ? normalizeAccount(extracted.accountId) : null;
  let match: NoticeMatch | null = null;

  if (noticeAccount) {
    const hits = context.sites.filter(
      (site) => site.accountId !== null && normalizeAccount(site.accountId) === noticeAccount,
    );
    if (hits.length === 1) {
      const hit = hits[0]!;
      match = {
        locationId: hit.locationId,
        label: hit.label,
        accountId: hit.accountId,
        basis: 'account',
      };
      checks.push({
        check: 'account',
        ok: true,
        detail: `Account ${extracted.accountId} on the notice matches ${hit.label}.`,
      });
    } else if (hits.length > 1) {
      checks.push({
        check: 'account',
        ok: false,
        detail:
          `Account ${extracted.accountId} matches ${hits.length} sites (${hits.map((h) => h.label).join(', ')}) — ` +
          'two sites sharing a roll account is a data problem worth fixing before recording.',
      });
    } else {
      checks.push({
        check: 'account',
        ok: false,
        detail:
          `Account ${extracted.accountId} on the notice matches no site on this engagement. ` +
          'Either the site is missing its account number, or this notice belongs to another taxpayer.',
      });
    }
  } else {
    checks.push({
      check: 'account',
      ok: false,
      detail: 'No account number could be read off the notice.',
    });
  }

  if (match === null && context.sites.length === 1) {
    const only = context.sites[0]!;
    match = {
      locationId: only.locationId,
      label: only.label,
      accountId: only.accountId,
      basis: 'only-site',
    };
    checks.push({
      check: 'site',
      ok: true,
      detail: `${only.label} is the only site owing a return, so the notice is proposed there — an assumption, not a match.`,
    });
  }

  // --- the year -----------------------------------------------------------
  if (extracted.taxYear === null) {
    checks.push({
      check: 'tax-year',
      ok: false,
      detail: 'The notice does not state a tax year the extraction could read.',
    });
  } else if (extracted.taxYear !== context.taxYear) {
    checks.push({
      check: 'tax-year',
      ok: false,
      detail:
        `The notice is for tax year ${extracted.taxYear}; this engagement files ${context.taxYear}. ` +
        'Record it on the engagement for its own year.',
    });
  } else {
    checks.push({
      check: 'tax-year',
      ok: true,
      detail: `Tax year ${extracted.taxYear}, same as the engagement.`,
    });
  }

  // --- the owner ----------------------------------------------------------
  if (extracted.ownerName && context.clientName) {
    const a = normalizeName(extracted.ownerName);
    const b = normalizeName(context.clientName);
    const same = a === b || (a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a)));
    checks.push({
      check: 'owner',
      ok: same,
      detail: same
        ? `Owner "${extracted.ownerName}" reads as ${context.clientName}.`
        : `The notice names "${extracted.ownerName}", not ${context.clientName} — worth a look before recording.`,
    });
  }

  // --- the dates ----------------------------------------------------------
  const noticedOn =
    extracted.noticeDate !== null && extracted.noticeDate !== undefined
      ? parsePrintedDate(extracted.noticeDate)
      : null;
  if (noticedOn === null) {
    checks.push({
      check: 'notice-date',
      ok: false,
      detail: extracted.noticeDate
        ? `The notice date reads "${extracted.noticeDate}" and would not parse — type it from the document.`
        : 'No notice date could be read. The date is what starts the 41.44 clock; type it from the document.',
    });
  }

  const printedDeadline = extracted.protestDeadline
    ? parsePrintedDate(extracted.protestDeadline)
    : null;
  if (extracted.protestDeadline && printedDeadline === null) {
    checks.push({
      check: 'printed-deadline',
      ok: false,
      detail: `The printed protest deadline reads "${extracted.protestDeadline}" and would not parse.`,
    });
  }

  const draft: NoticeDraft = {
    noticedOn,
    printedDeadline,
    districtName: extracted.districtName ?? null,
    appraisedValue: extracted.appraisedValue ?? null,
    assessedValue: extracted.assessedValue ?? null,
    priorYearValue: extracted.priorYearValue ?? null,
    renditionPenaltyApplied: extracted.renditionPenaltyApplied ?? null,
  };

  return { documentId, match, draft, checks };
}
