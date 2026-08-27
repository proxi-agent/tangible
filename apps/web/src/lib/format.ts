const compactCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const fullCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const integer = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * $18.7M — for headline figures and axis ticks, where precision would be noise.
 * Below $10K there is no noise to strip and compact notation only adds a
 * spurious decimal ("$813.4"), so those render exact.
 */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 10_000) return fullCurrency.format(value);
  return compactCurrency.format(value);
}

/** $18,712,430 — for tables and tooltips, where the exact number is the point. */
export function moneyExact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return fullCurrency.format(value);
}

export function count(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return integer.format(value);
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return n === 1 ? singular : pluralForm;
}

/**
 * A statutory date as a person reads it: "April 15, 2027".
 *
 * UTC on both sides on purpose. A deadline is a date, not an instant, and
 * rendering `2027-04-15` through the browser's own zone shows April 14 to
 * everybody west of Greenwich — a day early, on the one kind of number where
 * being a day out is the whole problem.
 */
export function day(iso: string): string {
  return format(iso, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** The same date without its year, for a second mention in one sentence. */
export function dayShort(iso: string): string {
  return format(iso, { month: 'short', day: 'numeric' });
}

/**
 * Both date formatters, with the two inputs that would otherwise print
 * nonsense handled once.
 *
 * `new Date('2027-04-15T12:00:00ZT00:00:00Z')` — what appending the suffix to a
 * value that is already a full timestamp produces — is an Invalid Date, and
 * `toLocaleDateString` renders that as the literal string "Invalid Date" in the
 * middle of a sentence about a deadline. A date column read straight from
 * Postgres is `YYYY-MM-DD`, but a *timestamp* column is not, and the two are
 * one refactor apart. Take the leading date off whatever arrives, and if there
 * is no date in it at all, show the raw value rather than a lie: an id or an
 * empty string in the interface is obviously wrong, where "Invalid Date" looks
 * like the record is broken.
 */
function format(iso: string, options: Intl.DateTimeFormatOptions): string {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(iso ?? '')?.[0];
  if (!date) return iso ?? '';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString('en-US', { timeZone: 'UTC', ...options });
}
