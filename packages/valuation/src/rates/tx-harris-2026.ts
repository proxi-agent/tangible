import type { RateTable } from './types.js';

/**
 * Harris County, tax year 2026 — registered, and deliberately empty.
 *
 * The 2026 archive carries a rate column for 2026 and it is zero for all 1,091
 * units, because Texas taxing units adopt the year's rate in the late summer
 * and autumn (Tex. Tax Code 26.05) and the archive was pulled before that. The
 * column beside it holds 2025's adopted rates, which is the trap: reading it as
 * 2026's would price the year against last year's rates. Harris County's own
 * rate fell from 0.385290 in 2024 to 0.380960 in 2025, and a rate that
 * is too high overstates the client's overpayment — the one direction this
 * product must never err in.
 *
 * So the year exists in the registry with no rates and a reason. `accountRate`
 * declines to price against it and says why, and the report says the rates are
 * not adopted rather than printing a number from a different year. When the
 * 2027 archive lands, its prior-year column is 2026's adopted rate and this
 * file is replaced by a generated table like the 2025 one.
 */
export const TX_HARRIS_RATES_2026: RateTable = {
  provenance: {
    ruleId: 'rates:tx-harris:2026',
    title: 'Harris County adopted tax rates, tax year 2026 — not yet adopted',
    citation:
      'Tex. Tax Code 26.05 (a taxing unit’s governing body adopts its tax rate for the year, ordinarily after the certified appraisal roll is delivered). No 2026 rate appears in the HCAD archive as of the date below.',
    source: {
      title: 'HCAD CAMA personal-property archive, tax year 2026',
      url: 'https://download.hcad.org/data/CAMA/2026/PP_files.zip',
      pages: 't_jur_tax_dist_exempt_value_rate.txt',
    },
    effectiveFrom: '2026-01-01',
    effectiveTo: '2026-12-31',
    jurisdictions: ['tx-harris'],
    taxYears: [2026],
    authoredBy: 'kajmeri',
    authoredAt: '2026-08-28',
    approvedBy: null,
    approvedAt: null,
    notes:
      'Placeholder for an unadopted year. Nothing is approvable here until the rates exist; the entry is the refusal, not the data.',
  },
  jurisdictionId: 'tx-harris',
  jurisdictionName: 'Harris County, TX',
  taxYear: 2026,
  status: 'awaiting-adoption',
  assessmentRatio: 1,
  source: {
    title: 'HCAD CAMA personal-property archive, tax year 2026',
    url: 'https://download.hcad.org/data/CAMA/2026/PP_files.zip',
    pages: 't_jur_tax_dist_exempt_value_rate.txt',
  },
  units: {},
  awaiting: {
    reason:
      'No 2026 rate is adopted yet. All 1,091 units carry a zero current-year rate in the archive; the populated column beside it is 2025’s.',
    expected:
      'Rates are adopted through the late summer and autumn of the tax year. Re-pull the archive after adoption, or take the rates from each unit’s own rate notice.',
  },
};
