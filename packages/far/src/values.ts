/**
 * Cell-value parsers for fixed asset registers.
 *
 * Registers write the same fact many ways — "$12,345.67", "(1,200)", "1 200,50",
 * a real date cell, "FY20", "05/00" — and the rule everywhere is the same as the
 * roll loaders': parse what is unambiguous, return null for what is not, and let
 * the caller attach a warning. A guessed value in a tax filing is worse than a
 * visible gap.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Reject dates that do not exist — "2021-06-31", "2023-13-05", Feb 30. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(year, month - 1, day);
  // A rolled-over date (June 31 → July 1) fails this round trip.
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}

/** Local components, not toISOString: SheetJS builds Dates whose local fields match the sheet. */
export function isoDate(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getFullYear();
  if (year < 1900 || year > 2100) return null;
  return `${year}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isoDate(value);
  const s = String(value).trim();
  return s === '' ? null : s;
}

/**
 * Money and quantities, across the grouping conventions registers actually use.
 *
 * The hard case is a lone comma: "12,34" is twelve-and-a-third euros, while
 * "1,234" is twelve hundred dollars. They are distinguished by how many digits
 * follow — a grouping separator is always followed by exactly three. That is a
 * convention, not a proof, so the one genuinely ambiguous shape (a single comma
 * with three digits after it) resolves as US grouping, which is what a Texas
 * filing engagement will see almost every time.
 */
export function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined || value instanceof Date) return null;

  let s = String(value).trim();
  if (s === '') return null;

  // Currency and spacing come off first: "$ (1,200.00)" has to reach the
  // parenthesis test as "(1,200.00)", and a space may itself be the separator
  // in "1 200,50".
  s = s.replace(/[$£€¥]|\s| /g, '');

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  // SAP and several ERP exports write the sign after the number.
  if (/-$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (/^-/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (s === '' || !/^[\d.,]+$/.test(s)) return null;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  let normalized: string;

  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: whichever comes last is the decimal mark.
    const decimal = lastComma > lastDot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    normalized = s.split(grouping).join('').replace(decimal, '.');
  } else if (lastComma >= 0) {
    const digitsAfter = s.length - lastComma - 1;
    const single = s.indexOf(',') === lastComma;
    // Repeated commas are grouping; a single one is decimal unless exactly
    // three digits follow it.
    normalized = single && digitsAfter !== 3 ? s.replace(',', '.') : s.split(',').join('');
  } else if (lastDot >= 0) {
    const single = s.indexOf('.') === lastDot;
    normalized = single ? s : s.split('.').join('');
  } else {
    normalized = s;
  }

  if (normalized === '' || normalized === '.') return null;
  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

export interface DateParse {
  date: string | null;
  year: number | null;
}

const NO_DATE: DateParse = { date: null, year: null };

/**
 * A date-shaped cell, however the register wrote it. A bare 4-digit number or
 * "FY20" yields a year without a date — common in hand-built registers that
 * track only the acquisition year. A date that does not exist on a calendar
 * yields nothing at all, rather than a string Postgres will reject or JavaScript
 * will silently roll forward.
 */
export function dateValue(value: unknown): DateParse {
  if (value === null || value === undefined) return NO_DATE;

  if (value instanceof Date) {
    const date = isoDate(value);
    return date ? { date, year: value.getFullYear() } : NO_DATE;
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 1900 && value <= 2100) {
      return { date: null, year: value };
    }
    // A raw Excel serial without date formatting is indistinguishable from a
    // cost or a count, so it is not guessed at.
    return NO_DATE;
  }

  const s = String(value).trim();
  if (s === '') return NO_DATE;

  // ISO first — unambiguous in order, though not necessarily a real date.
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    if (isRealDate(year, month, day)) {
      return { date: `${year}-${pad(month)}-${pad(day)}`, year };
    }
    return NO_DATE;
  }

  // US-style m/d/y — the format every accounting export uses.
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = Number(us[3]);
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    if (isRealDate(year, month, day)) {
      return { date: `${year}-${pad(month)}-${pad(day)}`, year };
    }
    return NO_DATE;
  }

  // "FY20", "FY 2020", or a bare year.
  const fy = /^fy\s*(\d{2,4})$/i.exec(s);
  if (fy) {
    let year = Number(fy[1]);
    if (year < 100) year += year >= 50 ? 1900 : 2000;
    if (year >= 1900 && year <= 2100) return { date: null, year };
  }
  const bare = /^((?:19|20)\d{2})$/.exec(s);
  if (bare) return { date: null, year: Number(bare[1]) };

  return NO_DATE;
}

/** For columns mapped as year-only. */
export function yearValue(value: unknown): number | null {
  const n = numberValue(value);
  if (n !== null && Number.isInteger(n) && n >= 1900 && n <= 2100) return n;
  return dateValue(value).year;
}
