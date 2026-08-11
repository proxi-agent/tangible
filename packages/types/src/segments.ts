import { z } from 'zod';

/**
 * Segments are the analytical vocabulary of the product. Each one is a named,
 * defensible slice of the public roll that the Harris County work identified as
 * meaningful. They are defined once here and consumed by the SQL layer (which
 * supplies a predicate per key), the API, and the UI.
 */
export const SEGMENT_KEYS = [
  'taxable',
  'unfiled',
  'chronic_nonfiler',
  'intermittent_nonfiler',
  'filed_late',
  'core_icp',
  'frozen_value',
  'never_declines',
  'agent_represented',
] as const;

export const SegmentKeySchema = z.enum(SEGMENT_KEYS);
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export interface SegmentDefinition {
  key: SegmentKey;
  label: string;
  /** One line, shown under the KPI tile. */
  description: string;
  /**
   * Why this slice is trustworthy — or where it is not. Surfaced in the UI so a
   * number is never shown without the caveat that qualifies it.
   */
  caveat: string | null;
  /** Roughly how far down the funnel this sits; drives ordering in the UI. */
  tier: 'market' | 'exposure' | 'target' | 'signal';
}

export const SEGMENTS: Readonly<Record<SegmentKey, SegmentDefinition>> = {
  taxable: {
    key: 'taxable',
    label: 'Taxable accounts',
    description: 'Accounts at or above the per-location BPP exemption for the tax year.',
    caveat:
      'The 2026 exemption jump from $2,500 to $125,000 removes most of the roll. Comparisons across that boundary are not like-for-like.',
    tier: 'market',
  },
  unfiled: {
    key: 'unfiled',
    label: 'Did not file',
    description: 'Taxable accounts with no rendition recorded in the latest tax year.',
    caveat:
      'Absence of a recorded rendition is the CAD’s own flag. Filings can be recorded late or under a different account.',
    tier: 'exposure',
  },
  chronic_nonfiler: {
    key: 'chronic_nonfiler',
    label: 'Chronic non-filers',
    description: 'Never filed a rendition in any year they have been on the roll (4+ years).',
    caveat: 'The strongest signal in the dataset — the penalty recurs every year automatically.',
    tier: 'target',
  },
  intermittent_nonfiler: {
    key: 'intermittent_nonfiler',
    label: 'Intermittent non-filers',
    description: 'Skipped the rendition in half or more of their years on the roll.',
    caveat: 'Filing behavior is inconsistent, so penalty exposure is real but harder to forecast.',
    tier: 'target',
  },
  filed_late: {
    key: 'filed_late',
    label: 'Filed late',
    description: 'Filed a rendition after the April 15 deadline without a recorded extension.',
    caveat: 'Late filings still carry the 10% penalty, but the CAD may have granted an extension.',
    tier: 'exposure',
  },
  core_icp: {
    key: 'core_icp',
    label: 'Core ICP',
    description:
      'Chronic non-filers on ordinary commercial/industrial property with no tax agent on record.',
    caveat:
      'Excludes dealers (special inventory declarations) and utilities/pipelines (separate valuation process).',
    tier: 'target',
  },
  frozen_value: {
    key: 'frozen_value',
    label: 'Frozen value',
    description: 'Assessed value identical in every year observed, despite equipment depreciating.',
    caveat:
      'Three causes: ghost assets, capex exactly offsetting depreciation, or CAD carryforward for a non-filer. A ranking signal, not proof for any one account.',
    tier: 'signal',
  },
  never_declines: {
    key: 'never_declines',
    label: 'Never declines',
    description: 'Value changes year to year but never decreases.',
    caveat: 'Weaker than frozen value — genuine growth produces the same pattern.',
    tier: 'signal',
  },
  agent_represented: {
    key: 'agent_represented',
    label: 'Agent represented',
    description: 'A tax agent is already on record for the account.',
    caveat: 'Already served by an incumbent, so treat as a competitive account rather than a lead.',
    tier: 'signal',
  },
};

export const SEGMENT_LIST: readonly SegmentDefinition[] = SEGMENT_KEYS.map((k) => SEGMENTS[k]);
