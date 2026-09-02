import {
  MESSY_REGISTER_FACTS,
  MESSY_REGISTER_MAPPING,
  MESSY_REGISTER_SHEETS,
  messyRegisterXlsx,
} from '@tangible/far/fixtures';
import type { CorpusEntry } from '../types.js';

/**
 * The register the product was built against, taking its place in the set.
 *
 * It is not rebuilt here. It lives in `@tangible/far/fixtures` next to the
 * normalizer tests that pin every one of its 322 rows, and duplicating it would
 * create a second Meridian that drifts from the first. What this adds is
 * membership: the corpus is the whole of the mail, and a set that quietly
 * omitted the one file everything was rehearsed on would be measuring the new
 * files against a baseline it does not contain.
 *
 * Everything hard about it is hard on purpose — bands as category, subtotal
 * rows that must not become assets, a grand total that says "see attached", a
 * duplicate tag, a zero-cost row, a non-breaking space inside a number, dates
 * that read "Various", and a description hand-wrapped across two rows.
 */
export function sageDetailEntry(): CorpusEntry {
  const assetCount = MESSY_REGISTER_FACTS.assetsPerBand.reduce((sum, n) => sum + n, 0);
  return {
    id: 'meridian-sage-detail',
    filename: 'Meridian_FA_Detail_FY2026.xlsx',
    kind: 'register',
    format: 'xlsx',
    businessId: 'meridian',
    source: 'Sage Fixed Assets — Depreciation detail, exported to Excel',
    jurisdictions: ['TX — Harris', 'TX — Fort Bend'],
    premise:
      'The register the pipeline was rehearsed on: a real Sage detail export with a title block, category bands, subtotals, and eight distinct kinds of mess in the rows.',
    traps: [
      'Category is carried by band labels between the rows, not by a column.',
      'Subtotal rows sit inside the data and must not become assets.',
      'The grand total reads "see attached", so the footing check has nothing to foot against.',
      'One tag is carried by two rows, one cost is zero, and one cost holds a non-breaking space.',
      'Two sheets — additions and notes — restate or discuss rows that are already on the detail sheet.',
    ],
    expectation: {
      autopilot: 'clears',
      because:
        'Every one of these traps is one the normalizer was built against, and the checks pass over all 322 rows — which is the claim the rest of the corpus is measured against, so it had better be true here.',
    },
    mapping: MESSY_REGISTER_MAPPING,
    truth: {
      assetCount,
      // The grand total is prose, so there is no printed figure to hold this to.
      totalCost: null,
      includedSheets: [MESSY_REGISTER_SHEETS.detail],
    },
    build: () => messyRegisterXlsx(),
  };
}
