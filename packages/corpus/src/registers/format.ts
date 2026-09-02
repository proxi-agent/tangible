import type { CorpusAsset } from '../types.js';

/** The ways a register prints the same figure, one helper each. */

export function usd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function grouped(value: number): string {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function plain(value: number): string {
  return value.toFixed(2);
}

/** Accounting's negative: parenthesised, never signed. */
export function credit(value: number): string {
  return `(${grouped(Math.abs(value))})`;
}

export function slashDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${Number(month)}/${Number(day)}/${year}`;
}

/** The two-digit year a twenty-year-old system still prints. */
export function shortDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${month}/${day}/${year!.slice(2)}`;
}

export function monthName(iso: string): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const [year, month, day] = iso.split('-');
  return `${Number(day)}-${months[Number(month) - 1]}-${year}`;
}

export function year(iso: string): number {
  return Number(iso.slice(0, 4));
}

export function acquiredIn(assets: readonly CorpusAsset[], from: number): CorpusAsset[] {
  return assets.filter((asset) => year(asset.acquired) >= from);
}
