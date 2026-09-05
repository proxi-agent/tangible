import 'server-only';
import { siteOutcome, type OutcomeMotion } from '@tangible/filing';
import type {
  CorrectionMotion,
  EngagementResult,
  SeasonReturn,
  SiteOutcome,
} from '@tangible/types';
import { exemptionFor } from '@tangible/savings';
import { DEFAULT_BLENDED_TAX_RATE } from '@tangible/types';
import { clientMotions } from '@/lib/motions';
import { filingSeason } from '@/lib/season';
import { fetchEngagement } from '@/lib/workspace';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * What the engagement's year came to, assembled from records already kept.
 *
 * Deliberately a read over the season rather than its own query. The season
 * board already holds the standing filing and the active notice per site, and
 * the notice carries its resolution — building the result from anything else
 * would mean two screens that can disagree about what went out and what came
 * back. The one thing the season does not carry is 25.25 motions, which are
 * read client-wide here for the same reason they are everywhere: a motion is
 * the one route back into a year that has ended, so leaving it out reports a
 * corrected roll at its uncorrected number.
 */
export async function engagementResult(engagementId: string): Promise<EngagementResult> {
  const { engagement } = await fetchEngagement(engagementId);
  const [season, motions, rates] = await Promise.all([
    filingSeason(engagementId),
    clientMotions(engagement.clientId),
    jurisdictionRates(),
  ]);

  const sites = seasonOutcomes(engagement.taxYear, season.returns, motions, rates);

  return summed(engagement.taxYear, sites);
}

/**
 * Every jurisdiction's blended rate, keyed by id.
 *
 * The whole table, because it is a handful of rows and both the engagement
 * and the practice roll-up want the same map. The blend is the same rate the
 * savings proposal dollarized with — the promise and the answer must convert
 * value to dollars the same way, or the difference between them reads as a
 * result when it is only arithmetic.
 */
export async function jurisdictionRates(): Promise<Map<string, number>> {
  const rows = await requireDb()
    .select({ id: schema.jurisdictions.id, rate: schema.jurisdictions.blendedTaxRate })
    .from(schema.jurisdictions);
  return new Map(rows.map((row) => [row.id, row.rate]));
}

/**
 * One season's returns, mapped to outcomes.
 *
 * Exported because the practice board needs exactly this mapping over the
 * seasons it has already built — renditions are expensive, and a second
 * definition of "what a site's outcome is" would eventually disagree with
 * this one.
 */
export function seasonOutcomes(
  taxYear: number,
  returns: readonly SeasonReturn[],
  motions: CorrectionMotion[],
  rates: ReadonlyMap<string, number>,
): SiteOutcome[] {
  return returns.map((entry) =>
    siteOutcome({
      // The proposal's lookupRate falls back to the default blend when the
      // jurisdictions table has no row; the answer must convert the same way
      // the promise did, so the same fallback applies here. Only a return
      // with no jurisdiction at all gets no estimate.
      blendedTaxRate:
        entry.jurisdictionId !== null
          ? (rates.get(entry.jurisdictionId) ?? DEFAULT_BLENDED_TAX_RATE)
          : null,
      // The same exemption the proposal took off the corrected position, so the
      // two estimates are differences of tax bills computed the same way.
      exemptionAmount: exemptionFor(entry.jurisdictionId, taxYear),
      locationId: entry.locationId,
      label: entry.label,
      accountId: entry.accountId,
      renderedCost: entry.filing?.totalHistoricalCost ?? null,
      filedOn: entry.filing?.filedOn ?? null,
      notice: entry.notice
        ? {
            noticedOn: entry.notice.noticedOn,
            appraisedValue: entry.notice.appraisedValue,
            protestFiledOn: entry.notice.protestFiledOn,
            protestOpen: entry.notice.protest.open,
            protestDeadline: entry.notice.protest.deadline,
          }
        : null,
      resolution:
        entry.notice?.resolution && entry.notice.resolution.status === 'recorded'
          ? {
              stage: entry.notice.resolution.stage,
              resolvedOn: entry.notice.resolution.resolvedOn,
              finalValue: entry.notice.resolution.finalValue,
              appealOpen: entry.notice.resolution.standing.appealOpen,
              appealDeadline: entry.notice.resolution.standing.appealDeadline,
            }
          : null,
      motion: rollChange(motions, taxYear, entry),
    }),
  );
}

/**
 * The motion that moved this site's roll for the engagement's year, if any.
 *
 * Only an ended motion that determined a value moved anything: an agreed
 * correction or a board determination with a corrected value on it. A live
 * motion is an argument, a withdrawal moved nothing, and a forfeiture under
 * 25.26 determines nothing about value — it costs the client (c-1) and leaves
 * the roll exactly where it was.
 */
function rollChange(
  motions: CorrectionMotion[],
  taxYear: number,
  entry: SeasonReturn,
): OutcomeMotion | null {
  const moved = motions.find(
    (motion) =>
      motion.status === 'recorded' &&
      motion.subjectTaxYear === taxYear &&
      (motion.outcome === 'agreed' || motion.outcome === 'determined') &&
      motion.correctedValue !== null &&
      (motion.accountId !== null
        ? motion.accountId === entry.accountId
        : motion.locationId === entry.locationId),
  );
  if (!moved) return null;
  return { correctedValue: moved.correctedValue as number, outcomeOn: moved.outcomeOn as string };
}

/**
 * The totals, summed only over rows where the figure exists.
 *
 * The counts travel with the sums because a total over three of five sites
 * presented as the engagement's number is the kind of figure that gets
 * repeated to a client and then corrected. `reduction` is stricter still: it
 * only adds rows where the noticed and the standing value are both known,
 * because "what the season took off" is a difference and half a difference is
 * not a smaller difference, it is a different number.
 */
function summed(taxYear: number, sites: SiteOutcome[]): EngagementResult {
  const rendered = sites.filter((site) => site.renderedCost !== null);
  const noticed = sites.filter((site) => site.noticedValue !== null);
  const standing = sites.filter((site) => site.standingValue !== null);
  const reduced = sites.filter((site) => site.reduction !== null);
  const estimated = sites.filter((site) => site.estimatedTaxReduction !== null);
  const settled = sites.filter((site) => site.final).length;

  const sum = (rows: SiteOutcome[], pick: (site: SiteOutcome) => number | null) =>
    rows.length === 0 ? null : rows.reduce((total, site) => total + (pick(site) as number), 0);

  return {
    taxYear,
    sites,
    settledCount: settled,
    siteCount: sites.length,
    renderedTotal: sum(rendered, (site) => site.renderedCost),
    renderedCount: rendered.length,
    noticedTotal: sum(noticed, (site) => site.noticedValue),
    noticedCount: noticed.length,
    standingTotal: sum(standing, (site) => site.standingValue),
    standingCount: standing.length,
    reductionTotal: sum(reduced, (site) => site.reduction),
    reductionCount: reduced.length,
    estimatedTaxTotal: sum(estimated, (site) => site.estimatedTaxReduction),
    estimatedTaxCount: estimated.length,
    standing: headline(taxYear, sites, settled),
  };
}

function headline(taxYear: number, sites: SiteOutcome[], settled: number): string {
  if (sites.length === 0) return `Nothing has gone out for ${taxYear} yet.`;
  const reduced = sites.filter((site) => (site.reduction ?? 0) > 0);
  const saved = reduced.reduce((total, site) => total + (site.reduction as number), 0);
  const head =
    settled === sites.length
      ? `${taxYear} is finished at every site.`
      : `${settled} of ${sites.length} sites ${settled === 1 ? 'has' : 'have'} finished ${taxYear}; the rest are still moving.`;
  if (saved <= 0) return head;
  // Dollarized only over the winning rows that have a rate, and said as an
  // estimate — the blend flattens per-unit rates, and the bill is the bill.
  const estimated = reduced
    .filter((site) => site.estimatedTaxReduction !== null)
    .reduce((total, site) => total + (site.estimatedTaxReduction as number), 0);
  const dollars =
    estimated > 0
      ? ` — roughly $${Math.round(estimated).toLocaleString('en-US')} of tax at the blended rates on file, an estimate to check against the bill`
      : ' — assessed value, not tax dollars';
  return (
    `${head} The season has taken $${Math.round(saved).toLocaleString('en-US')} of appraised ` +
    `value off the roll so far${dollars}.`
  );
}
