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
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** The same date without its year, for a second mention in one sentence. */
export function dayShort(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  });
}
