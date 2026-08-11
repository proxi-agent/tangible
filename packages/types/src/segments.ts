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
  /**
   * One line, shown under the KPI tile and in every filter tooltip.
   *
   * Written for someone who has never heard of a rendition. The term of art is
   * still here — this is a product about renditions — but it never arrives
   * without the plain-English version standing next to it.
   */
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
    description:
      'Business locations whose equipment is worth more than the exemption, so they owe tax on it this year.',
    caveat:
      'The 2026 exemption jump from $2,500 to $125,000 removes most of the roll. Comparisons across that boundary are not like-for-like.',
    tier: 'market',
  },
  unfiled: {
    key: 'unfiled',
    label: 'Did not file',
    description:
      'Owed tax this year, and the county has no record of their annual equipment declaration — the form called a rendition. That is an automatic 10% penalty.',
    caveat:
      'Absence of a recorded rendition is the CAD’s own flag. Filings can be recorded late or under a different account.',
    tier: 'exposure',
  },
  chronic_nonfiler: {
    key: 'chronic_nonfiler',
    label: 'Chronic non-filers',
    description:
      'Have never filed the declaration in any of the four or more years they have been on the county’s books.',
    caveat: 'The strongest signal in the dataset — the penalty recurs every year automatically.',
    tier: 'target',
  },
  intermittent_nonfiler: {
    key: 'intermittent_nonfiler',
    label: 'Intermittent non-filers',
    description:
      'Skipped the declaration in half or more of the years they have been on the county’s books.',
    caveat: 'Filing behavior is inconsistent, so penalty exposure is real but harder to forecast.',
    tier: 'target',
  },
  filed_late: {
    key: 'filed_late',
    label: 'Filed late',
    description:
      'Filed the declaration, but after the April 15 deadline and with no extension on record. Late still carries the penalty.',
    caveat: 'Late filings still carry the 10% penalty, but the CAD may have granted an extension.',
    tier: 'exposure',
  },
  core_icp: {
    key: 'core_icp',
    // "ICP" is internal vocabulary; the label has to survive being read by
    // someone who has never seen this dataset before.
    label: 'Best-fit targets',
    description:
      'Businesses that never file, run ordinary commercial or industrial property, and have nobody representing them at the county yet.',
    caveat:
      'Excludes dealers (special inventory declarations) and utilities/pipelines (separate valuation process).',
    tier: 'target',
  },
  frozen_value: {
    key: 'frozen_value',
    label: 'Frozen value',
    description:
      'The county’s valuation has not moved a dollar in any year on record — even though equipment wears out and should be losing value.',
    caveat:
      'Three causes: ghost assets, capex exactly offsetting depreciation, or CAD carryforward for a non-filer. A ranking signal, not proof for any one account.',
    tier: 'signal',
  },
  never_declines: {
    key: 'never_declines',
    label: 'Never declines',
    description: 'The valuation moves from year to year, but has never once gone down.',
    caveat: 'Weaker than frozen value — genuine growth produces the same pattern.',
    tier: 'signal',
  },
  agent_represented: {
    key: 'agent_represented',
    label: 'Agent represented',
    description:
      'A tax firm is already registered with the county to act for this business.',
    caveat: 'Already served by an incumbent, so treat as a competitive account rather than a lead.',
    tier: 'signal',
  },
};

export const SEGMENT_LIST: readonly SegmentDefinition[] = SEGMENT_KEYS.map((k) => SEGMENTS[k]);
