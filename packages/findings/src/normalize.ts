import type { ComparisonCell, RegisterComparison } from '@tangible/filing';
import type {
  FindingEffect,
  FindingEvidence,
  FindingKind,
  FindingSetHeadline,
  FindingSource,
  SavingsReport,
} from '@tangible/types';

/**
 * Turning what an engine produced into what gets committed.
 *
 * Both analyses already emit findings; neither emits them in the same shape,
 * because each answers a different question and says so in its own vocabulary.
 * This is the one place that reconciles them, and it is pure — no database, no
 * clock, no ids minted — for the same reason the engines are: what a stored
 * finding claims has to be decidable from its inputs alone.
 */

export interface NormalizedFinding {
  key: string;
  ordinal: number;
  title: string;
  kind: FindingKind;
  effect: FindingEffect;
  cost: number;
  value: number | null;
  assetCount: number;
  summary: string;
  basis: string;
  assumption: string | null;
  evidence: FindingEvidence[];
  cells: ComparisonCell[];
}

export interface NormalizedSet {
  source: FindingSource;
  taxYear: number;
  headline: FindingSetHeadline;
  findingCount: number;
  savingCount: number;
  exposureCount: number;
  totalCost: number;
  /** Null only when nothing in the set could be priced at all. */
  totalValue: number | null;
  findings: NormalizedFinding[];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Every savings finding is a reduction.
 *
 * That is not an assumption about the numbers, it is what the report is: a list
 * of things that come off the rendition. A screening finding is a reduction
 * whose size nobody knows yet, which is a statement about the amount and not
 * about the direction — so it is still `saving`, and its null value is what
 * says the amount is unsettled. Only the comparison can produce `exposure`,
 * because only the comparison has a filed return to be under.
 */
export function fromSavingsReport(report: SavingsReport): NormalizedSet {
  const findings: NormalizedFinding[] = report.findings.map((finding, ordinal) => ({
    key: finding.key,
    ordinal,
    title: finding.title,
    kind: finding.kind,
    effect: 'saving' as const,
    cost: round(finding.originalCost),
    value: finding.valueRemoved === null ? null : round(finding.valueRemoved),
    assetCount: finding.assetCount,
    summary: finding.summary,
    basis: finding.basis,
    assumption: finding.assumption,
    evidence: finding.evidence,
    cells: [],
  }));

  return {
    source: 'savings',
    taxYear: report.taxYear,
    headline: savingsHeadline(report),
    ...totals(findings),
    // The engine's own figure rather than a re-sum of the rows above: it is
    // defined as measured and modeled only, and re-deriving it here would be a
    // second place for that rule to live and eventually disagree.
    totalValue: round(report.totalValueRemoved),
    findings,
  };
}

/**
 * A savings report ends in an annual number; it just cannot always produce one.
 * Without a linked account there is no assessed position, so there is no
 * "before" and no saving can be claimed against nothing — the report already
 * models that as a null, and the caveat is what stops the null reading as zero.
 */
function savingsHeadline(report: SavingsReport): FindingSetHeadline {
  const unreviewed = report.coverage.needsReviewCount + report.coverage.unclassifiedCount;
  return {
    label: 'Estimated annual saving',
    value: report.estimatedAnnualSaving,
    caveat:
      report.estimatedAnnualSaving === null
        ? 'No account is linked to this engagement, so there is no assessed position to measure against.'
        : unreviewed > 0
          ? `${unreviewed} ${unreviewed === 1 ? 'asset is' : 'assets are'} still unreviewed and contribute${
              unreviewed === 1 ? 's' : ''
            } nothing to this figure.`
          : null,
  };
}

export function fromRegisterComparison(comparison: RegisterComparison): NormalizedSet {
  const findings: NormalizedFinding[] = comparison.findings.map((finding, ordinal) => ({
    key: finding.key,
    ordinal,
    title: finding.title,
    kind: finding.kind,
    effect: finding.effect,
    cost: round(finding.cost),
    value: finding.value === null ? null : round(finding.value),
    assetCount: finding.assets.length,
    summary: finding.summary,
    basis: finding.basis,
    assumption: finding.assumption,
    evidence: finding.assets,
    cells: finding.cells,
  }));

  return {
    source: 'register-comparison',
    taxYear: comparison.taxYear,
    headline: comparisonHeadline(comparison),
    ...totals(findings),
    findings,
  };
}

function comparisonHeadline(comparison: RegisterComparison): FindingSetHeadline {
  const unpriced = comparison.unpricedRegisterCost + comparison.unpricedReportedCost;
  return {
    label: 'Value difference against the return',
    value: comparison.valueDifference,
    caveat:
      comparison.valueDifference === null
        ? 'No published schedule was loaded for this year, so nothing here could be priced.'
        : unpriced > 0
          ? `${Math.round(unpriced).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} of compared cost could not be priced, so this is a floor rather than a figure.`
          : null,
  };
}

/**
 * `totalValue` sums what could be priced rather than collapsing to null the
 * moment one finding could not be. A single unpriceable finding taking the
 * whole column with it is the exact bug the comparison engine was already
 * caught by once; the caveat on the headline is where the shortfall is said.
 */
function totals(
  findings: NormalizedFinding[],
): Pick<NormalizedSet, 'findingCount' | 'savingCount' | 'exposureCount' | 'totalCost' | 'totalValue'> {
  const priced = findings.filter((finding) => finding.value !== null);
  return {
    findingCount: findings.length,
    savingCount: findings.filter((finding) => finding.effect === 'saving').length,
    exposureCount: findings.filter((finding) => finding.effect === 'exposure').length,
    totalCost: round(findings.reduce((sum, finding) => sum + finding.cost, 0)),
    totalValue: priced.length === 0 ? null : round(priced.reduce((sum, f) => sum + (f.value ?? 0), 0)),
  };
}
