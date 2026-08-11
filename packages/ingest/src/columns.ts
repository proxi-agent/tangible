import type { ColumnLayout } from '@tangible/types';

/**
 * Canonical fields we try to recover from a source file. Only `accountId` and a
 * value column are required; everything else sharpens the analysis when present
 * and degrades to NULL when absent.
 */
export const CANONICAL_FIELDS = [
  'accountId',
  'ownerName',
  'siteAddress',
  'siteCity',
  'siteZip',
  'mailAddress',
  'mailCity',
  'mailState',
  'mailZip',
  'stateClass',
  'businessCode',
  'marketValue',
  'appraisedValue',
  'assessedValue',
  'renditionFiled',
  'renditionLate',
  'renditionPenalty',
  'agentName',
  'isExempt',
] as const;

export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

export const REQUIRED_FIELDS: readonly CanonicalField[] = ['accountId'];

/**
 * Header aliases seen across Texas CAD exports, most specific first. Matching is
 * case-insensitive with spaces normalized to underscores.
 */
export const HEADER_ALIASES: Readonly<Record<CanonicalField, readonly string[]>> = {
  accountId: ['acct', 'account', 'acct_num', 'account_num', 'account_number', 'prop_id', 'pid'],
  ownerName: ['owner_name', 'name', 'owner', 'name_1', 'py_owner_name', 'mailto'],
  siteAddress: ['site_addr', 'site_address', 'situs_addr', 'situs_address', 'location_address'],
  siteCity: ['site_city', 'situs_city', 'location_city', 'city'],
  siteZip: ['site_zip', 'situs_zip', 'location_zip', 'zip'],
  mailAddress: ['mail_addr', 'mail_address', 'mailing_address', 'addr_line1'],
  mailCity: ['mail_city', 'mailing_city'],
  mailState: ['mail_state', 'mailing_state', 'state'],
  mailZip: ['mail_zip', 'mailing_zip'],
  stateClass: ['state_class', 'state_cd', 'sc', 'state_class_code', 'ptype', 'property_type'],
  businessCode: ['sic', 'sic_code', 'naics', 'naics_code', 'business_code', 'bus_type'],
  marketValue: ['tot_mkt_val', 'total_market_value', 'market_val', 'market_value', 'mkt_val'],
  appraisedValue: [
    'tot_appr_val',
    'total_appraised_value',
    'appr_val',
    'appraised_val',
    'appraised_value',
  ],
  assessedValue: ['assessed_val', 'tot_assessed_val', 'assessed_value', 'asd_val', 'taxable_val'],
  renditionFiled: ['rendition_filed', 'rendered', 'rendition', 'rend_flag', 'filed'],
  renditionLate: ['rendition_late', 'late_filed', 'late_rendition', 'late_flag'],
  renditionPenalty: ['rendition_penalty', 'penalty', 'pen_amt', 'rend_penalty'],
  agentName: ['agent_name', 'agent', 'agent_id', 'tax_agent'],
  isExempt: ['exempt', 'is_exempt', 'exemption', 'total_exempt'],
};

export function normalizeHeader(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

/**
 * Resolve canonical fields against a file's actual columns.
 *
 * A pinned layout is exhaustive: when one is supplied, alias matching is
 * disabled entirely and a field absent from the layout resolves to nothing.
 *
 * This matters more than it looks. Tarrant's roll has a column called `City`
 * holding the *taxing unit* code — 000, 026, 030. With alias fallback active it
 * satisfied the `siteCity` alias list and silently populated 20,000 accounts
 * with a situs city of "000". Pinning a layout is a statement that the author
 * has read this file; anything they left out is genuinely not in it, and
 * guessing from a column name is how a plausible-looking wrong value gets in.
 */
export function resolveColumns(
  columns: readonly string[],
  layout?: ColumnLayout,
): Partial<Record<CanonicalField, string>> {
  const resolved: Partial<Record<CanonicalField, string>> = {};
  const normalized = columns.map(normalizeHeader);
  const pinned = layout !== undefined && Object.keys(layout).length > 0;

  for (const field of CANONICAL_FIELDS) {
    if (layout && field in layout) {
      const ref = layout[field];
      const column =
        typeof ref === 'number'
          ? columns[ref]
          : columns[normalized.indexOf(normalizeHeader(String(ref)))];
      if (column) resolved[field] = column;
      continue;
    }

    if (pinned) continue;

    for (const alias of HEADER_ALIASES[field]) {
      const index = normalized.indexOf(alias);
      if (index !== -1) {
        const column = columns[index];
        if (column) {
          resolved[field] = column;
          break;
        }
      }
    }
  }

  return resolved;
}

export function missingRequired(
  resolved: Partial<Record<CanonicalField, string>>,
): CanonicalField[] {
  const missing = REQUIRED_FIELDS.filter((f) => !resolved[f]);
  // At least one value column is needed for any analysis to mean anything.
  if (!resolved.assessedValue && !resolved.appraisedValue && !resolved.marketValue) {
    missing.push('assessedValue');
  }
  return missing;
}
