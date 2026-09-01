import 'server-only';
import { eq } from 'drizzle-orm';
import { appraisalDistrictName, realize } from '@tangible/filing';
import type { RecoveryClaim, RecoveryOutcome } from '@tangible/filing';
import { learnAcceptance, learnSignalLifts } from '@tangible/savings';
import type {
  AcceptanceEvidence,
  AcceptanceObservation,
  SignalLift,
  SignalOutcome,
} from '@tangible/savings';
import type { AcceptanceBoard, DetectionSignal } from '@tangible/types';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * The firm's own outcome record, read as training data.
 *
 * This is the only file that turns recorded settlements into the numbers the
 * report multiplies by, and it has one rule it must never break: a row reaches
 * the learner only if `realize()` says it is learnable. The filter is not
 * re-implemented here — it is imported — because the two ways a row becomes
 * unusable are subtle and neither is visible in the columns. A pro-rata split
 * makes every position look half-accepted; a withdrawal looks like a loss and
 * is not one. Either would train the model toward a lie, and the code that
 * knows which is which is the code that produced the split.
 *
 * It reads across the whole practice rather than one engagement. That is the
 * asset: no single client has enough closed positions to learn anything, and
 * the hundredth client benefits from the ninety-nine before it. Nothing
 * client-identifying crosses the boundary — what comes out is a finding key, a
 * district and a fraction.
 */

/**
 * Every closed, learnable position in the practice.
 *
 * One query, and it will stay one query for a long time: this table grows by a
 * few rows per settled account per year, so a practice with a hundred clients
 * and five seasons behind it is still in the low thousands. When that stops
 * being true the fix is a materialised rate per (finding, district) refreshed
 * on settlement, not a narrower read — a rate learned from a sample of the
 * firm's own history would be a strange thing to have built.
 */
export async function acceptanceObservations(): Promise<AcceptanceObservation[]> {
  return (await closedPositions()).map(({ observation }) => observation);
}

/**
 * The same closed positions, read one level finer.
 *
 * Only the ones whose claim froze the evidence it went out on. A claim written
 * before that column existed contributes to the rate for its finding and to
 * nothing here, which is the correct asymmetry: its outcome is real, and what
 * the district was answering is not on file.
 */
export async function signalOutcomes(): Promise<SignalOutcome[]> {
  const out: SignalOutcome[] = [];
  for (const { observation, signals } of await closedPositions()) {
    if (signals === null || signals.length === 0) continue;
    out.push({ findingKey: observation.findingKey, signals, share: observation.share });
  }
  return out;
}

export interface ClosedPosition {
  observation: AcceptanceObservation;
  /** Null where the claim predates the frozen-signals column. Never `[]` for it. */
  signals: DetectionSignal[] | null;
  /**
   * When the firm wrote this outcome down, which is not when the district
   * resolved it.
   *
   * The distinction only matters to the digest, and there it is the whole
   * point. `resolved_on` is the date on the district's letter; a settlement
   * reached in January and recorded in August became *knowledge* in August,
   * and a digest that dated it to January would report a rate crossing its bar
   * seven months before anything in this system could have known. What the
   * digest asks is "what did the engine learn this week", and learning happens
   * when the row lands.
   */
  recordedAt: Date;
}

/**
 * Every closed, learnable position, each carrying the moment it was recorded.
 *
 * Exported for the digest, which reads the whole list once and partitions it
 * in memory rather than asking the database twice. Two queries would let a
 * settlement recorded between them make the before and after disagree about
 * rows neither window should contain — the same argument `acceptanceBoard`
 * makes below for reading both its layers off one read.
 */
export async function closedPositions(): Promise<ClosedPosition[]> {
  const db = requireDb();
  const rows = await db
    .select({
      claim: schema.recoveryClaims,
      outcome: schema.recoveryOutcomes,
      jurisdictionId: schema.engagements.jurisdictionId,
      recordedAt: schema.recoveryOutcomes.recordedAt,
    })
    .from(schema.recoveryOutcomes)
    .innerJoin(schema.recoveryClaims, eq(schema.recoveryClaims.id, schema.recoveryOutcomes.claimId))
    .innerJoin(schema.engagements, eq(schema.engagements.id, schema.recoveryClaims.engagementId))
    .where(eq(schema.recoveryOutcomes.status, 'recorded'));

  const positions: ClosedPosition[] = [];
  for (const row of rows) {
    // A voided claim is a claim the firm says should never have been recorded.
    // Its outcome row may still be sitting there; it is not evidence.
    if (row.claim.status !== 'recorded') continue;
    const realized = realize(asClaim(row.claim), asOutcome(row.outcome));
    if (!realized.learnable || realized.realizedShare === null) continue;
    positions.push({
      observation: {
        findingKey: row.claim.findingKey,
        jurisdictionId: row.jurisdictionId,
        share: realized.realizedShare,
      },
      signals: (row.claim.predictedSignals as DetectionSignal[] | null) ?? null,
      recordedAt: row.recordedAt,
    });
  }
  return positions;
}

/**
 * The lifts to price rows with, and everything measured on the way to them.
 *
 * Not conditioned on a district, unlike the rates. A district's habits are the
 * thing the rate layer already models; what this layer asks is whether a kind
 * of evidence persuades *anybody*, and splitting a few dozen outcomes across
 * counties before asking would answer nothing about any of them. When one
 * county has its own hundred closed positions, that is the moment to ask the
 * question locally — and not before.
 */
export async function learnedSignalLifts(): Promise<{
  lifts: SignalLift[];
  observations: number;
}> {
  const outcomes = await signalOutcomes();
  const learned = learnSignalLifts(outcomes);
  return { lifts: learned.lifts, observations: learned.observations };
}

/**
 * The acceptance rates to use for one district, and the evidence behind them.
 *
 * Returns null-ish rather than throwing when there is nothing to learn from:
 * an empty `rates` map is what every caller wants on day one, and it makes
 * `recoveryModel` keep saying the rates are judgement.
 */
export async function learnedAcceptance(jurisdictionId: string | null): Promise<{
  rates: Record<string, number>;
  evidence: AcceptanceEvidence[];
  observations: number;
}> {
  const learned = learnAcceptance(await acceptanceObservations(), jurisdictionId);
  return { rates: learned.rates, evidence: learned.evidence, observations: learned.observations };
}

/**
 * The learned model, laid out for someone who wants to argue with it.
 *
 * Pooled first and districts under it, because that is the order the shrinkage
 * runs in and the order the answer is built: a district's rate is the pooled
 * rate moved by what that district did. A screen that showed only the local
 * numbers would make eight outcomes look like the whole basis for a rate that
 * is mostly inherited.
 */
export async function acceptanceBoard(): Promise<AcceptanceBoard> {
  // One read for both layers. They are two questions asked of the same closed
  // positions, and asking the database twice would let a settlement recorded
  // between the two make the counts on one screen disagree.
  const positions = await closedPositions();
  const observations = positions.map(({ observation }) => observation);
  const signals = learnSignalLifts(
    positions
      .filter((row) => row.signals !== null && row.signals.length > 0)
      .map((row) => ({
        findingKey: row.observation.findingKey,
        signals: row.signals!,
        share: row.observation.share,
      })),
  );
  const pooled = learnAcceptance(observations, null);

  const ids = [...new Set(observations.map((row) => row.jurisdictionId))].filter(
    (id): id is string => id !== null,
  );
  const districts = ids
    .map((jurisdictionId) => {
      const local = observations.filter((row) => row.jurisdictionId === jurisdictionId);
      return {
        jurisdictionId,
        label: appraisalDistrictName(jurisdictionId) ?? jurisdictionId,
        observations: local.length,
        // Learned from everything, asked about this district — which is the
        // whole point of the two-step shrinkage and the reason this is not
        // simply `learnAcceptance(local, id)`.
        evidence: learnAcceptance(observations, jurisdictionId).evidence.filter(
          (row) => row.localObservations > 0,
        ),
      };
    })
    .sort((a, b) => b.observations - a.observations);

  return {
    observations: observations.length,
    measured: Object.keys(pooled.rates).length,
    pooled: pooled.evidence,
    districts,
    signals: signals.lifts,
    signalObservations: signals.observations,
  };
}

/* -------------------------------------------------------------------------- */
/*  Row shapes                                                                */
/* -------------------------------------------------------------------------- */

function asClaim(row: typeof schema.recoveryClaims.$inferSelect): RecoveryClaim {
  return {
    id: row.id,
    taxYear: row.taxYear,
    locationId: row.locationId,
    accountId: row.accountId,
    assetId: row.assetId,
    findingKey: row.findingKey,
    route: row.route as RecoveryClaim['route'],
    valueClaimed: row.valueClaimed,
    taxClaimed: row.taxClaimed,
    predictedConfidence: row.predictedConfidence,
    predictedAcceptance: row.predictedAcceptance,
  };
}

function asOutcome(row: typeof schema.recoveryOutcomes.$inferSelect): RecoveryOutcome {
  return {
    claimId: row.claimId,
    outcome: row.outcome as RecoveryOutcome['outcome'],
    allocation: row.allocation as RecoveryOutcome['allocation'],
    valueAllowed: row.valueAllowed,
    taxRecovered: row.taxRecovered,
    taxIsDocumented: row.taxIsDocumented,
    resolvedOn: row.resolvedOn,
  };
}
