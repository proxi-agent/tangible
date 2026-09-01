import 'server-only';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { RecoveryClaimRow, RecoveryOutcomeRow } from '@tangible/db';
import {
  proRataSplit,
  realize,
  realizedTotals,
  type RecoveryClaim,
  type RecoveryOutcome,
} from '@tangible/filing';
import type {
  ClaimRoute,
  DetectionSignal,
  ClientRecoveryLine,
  ClientRecoveryStatement,
  EngagementRecovery,
  RecordSettlementRequest,
  RecoveryClaimRecord,
  RecoverySummary,
  SavingsReport,
  VoidClaimRequest,
} from '@tangible/types';
import { currentActor } from '@/lib/actor';
import { lookupRate } from '@/lib/analysis';
import { allRowDecisions } from '@/lib/finding-rows';
import { HttpError, notFound } from '@/lib/http';
import { publishedReport } from '@/lib/runs';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Recovery tracking: what we claimed, and what we got.
 *
 * The season already has a scoreboard, and it answers at the grain a district
 * works at — one account, one year, one settlement. That is the right grain for
 * telling a client how the year went and the wrong grain for every question
 * after it. Which arguments does this county actually concede? Are ghost
 * findings worth what the model says they are? Should the queue rank a
 * misclassification above a freight split? None of those can be read off a
 * number attached to a whole site.
 *
 * So a claim is written per asset, per finding, per year, at the moment the
 * position goes out, carrying what the engine believed at the time — and that
 * prediction is never edited afterwards, because a prediction revised after the
 * result is not a prediction. What comes back from the district lands beside
 * it. The arithmetic that reconciles the two grains lives in `@tangible/filing`
 * where it is testable; this file is storage, seeding and reading.
 */

/** Rows the engine priced, keyed the way a claim is keyed. */
interface PricedRow {
  assetId: string;
  assetTag: string | null;
  description: string | null;
  findingKey: string;
  findingTitle: string;
  valueRemoved: number;
  taxAtRisk: number | null;
  confidence: number | null;
  /** What the row was flagged on. Frozen onto the claim; see the column note. */
  signals: DetectionSignal[];
  acceptance: number | null;
  locationId: string | null;
}

/**
 * Write down the positions a filing took.
 *
 * Seeded from the published analysis rather than from the filing's frozen
 * rendition, because the rendition records what went on the form and a claim
 * records *why* — the finding behind each removal, which the form has no place
 * for. The two agree by construction: both are built from the accepted
 * dispositions, and a row the reviewer rejected is on neither.
 *
 * Idempotent per filing. Recording an amendment seeds the amendment's claims;
 * running the same filing twice does not double them. It is called after the
 * filing row commits and its failure does not undo the filing — a return that
 * went out went out, and claims can be seeded again.
 */
export async function seedClaimsForFiling(input: {
  engagementId: string;
  filingId: string;
  locationId: string | null;
  accountId: string | null;
  taxYear: number;
  filedOn: string;
}): Promise<number> {
  return seedClaims({
    ...input,
    route: 'rendition',
    authority: null,
    motionId: null,
    claimedOn: input.filedOn,
    existingBy: eq(schema.recoveryClaims.filingId, input.filingId),
  });
}

/**
 * The same, for a 25.25 motion or a Florida refund application.
 *
 * The route matters more here than it does on a rendition. A rendition claims
 * the current year and nothing else; a motion names a closed year and the
 * subsection it is reopened under, and that subsection is what the district
 * will answer. Recording it on the claim is what lets the acceptance model
 * eventually say that this county takes (c) and fights (c-1).
 */
export async function seedClaimsForMotion(input: {
  engagementId: string;
  motionId: string;
  locationId: string | null;
  accountId: string | null;
  taxYear: number;
  route: ClaimRoute;
  authority: string | null;
  filedOn: string;
}): Promise<number> {
  return seedClaims({
    ...input,
    filingId: null,
    claimedOn: input.filedOn,
    existingBy: eq(schema.recoveryClaims.motionId, input.motionId),
  });
}

async function seedClaims(input: {
  engagementId: string;
  locationId: string | null;
  accountId: string | null;
  taxYear: number;
  route: ClaimRoute;
  authority: string | null;
  filingId?: string | null;
  motionId?: string | null;
  claimedOn: string;
  existingBy: ReturnType<typeof eq>;
}): Promise<number> {
  const db = requireDb();
  const already = await db
    .select({ id: schema.recoveryClaims.id })
    .from(schema.recoveryClaims)
    .where(input.existingBy)
    .limit(1);
  if (already.length > 0) return 0;

  const rows = await pricedRows(input.engagementId, input.locationId);
  if (rows.length === 0) return 0;

  const [engagement] = await db
    .select({ clientId: schema.engagements.clientId })
    .from(schema.engagements)
    .where(eq(schema.engagements.id, input.engagementId));
  if (!engagement) notFound('No engagement with that id.');

  const actor = await currentActor();
  const inserted = await db
    .insert(schema.recoveryClaims)
    .values(
      rows.map((row) => ({
        engagementId: input.engagementId,
        clientId: engagement.clientId,
        locationId: input.locationId,
        accountId: input.accountId,
        taxYear: input.taxYear,
        assetId: row.assetId,
        findingKey: row.findingKey,
        route: input.route,
        authority: input.authority,
        valueClaimed: row.valueRemoved,
        taxClaimed: row.taxAtRisk,
        predictedConfidence: row.confidence,
        predictedAcceptance: row.acceptance,
        predictedSignals: row.signals,
        filingId: input.filingId ?? null,
        motionId: input.motionId ?? null,
        claimedOn: input.claimedOn,
        note: row.findingTitle,
        recordedBy: actor,
      })),
    )
    .returning({ id: schema.recoveryClaims.id });
  return inserted.length;
}

/**
 * The priced rows behind the positions this engagement decided to take.
 *
 * Three filters, and each one exists because skipping it would claim something
 * nobody agreed to. The finding has to be accepted — an undecided finding is a
 * question, not a position. The row must not be individually rejected, because
 * a reviewer who struck four assets out of two hundred struck them for a
 * reason. And the row has to carry a priced removal: a finding the schedules
 * could not value is real and unclaimable, and a claim of zero would score as a
 * loss against a model that never predicted anything.
 */
async function pricedRows(engagementId: string, locationId: string | null): Promise<PricedRow[]> {
  const { report } = await publishedReport(engagementId);
  if (!report) return [];

  const db = requireDb();
  const dispositions = await db
    .select()
    .from(schema.findingDispositions)
    .where(
      and(
        eq(schema.findingDispositions.engagementId, engagementId),
        eq(schema.findingDispositions.source, 'savings'),
      ),
    );
  const accepted = new Set(
    dispositions.filter((one) => one.status === 'accepted').map((one) => one.key),
  );
  if (accepted.size === 0) return [];

  const decisions = await allRowDecisions(engagementId);
  const rejected = new Set(
    decisions
      .filter((one) => one.status === 'rejected')
      .map((one) => `${one.findingKey}:${one.assetId}`),
  );

  const out: PricedRow[] = [];
  for (const finding of (report as SavingsReport).findings) {
    if (!accepted.has(finding.key)) continue;
    for (const row of finding.rows) {
      if (rejected.has(`${finding.key}:${row.assetId}`)) continue;
      if (row.valueRemoved === null || row.valueRemoved <= 0) continue;
      // A claim is filed against one account. Rows placed at another site
      // belong to that site's return, and rows placed nowhere belong to
      // whichever return the situs question eventually answers for — neither
      // is claimed here.
      if (locationId !== null && row.locationId !== locationId) continue;
      out.push({
        assetId: row.assetId,
        assetTag: row.assetTag,
        description: row.description,
        findingKey: finding.key,
        findingTitle: finding.title,
        valueRemoved: row.valueRemoved,
        taxAtRisk: row.taxAtRisk,
        confidence: row.confidence.score,
        signals: row.confidence.signals,
        acceptance: row.recovery?.probabilityAccepted ?? null,
        locationId: row.locationId,
      });
    }
  }
  return out;
}

/**
 * Everything claimed on this engagement, with what came back.
 *
 * One read for the firm screen, the portal and the export, because three
 * assemblies of the same numbers is three chances for them to disagree in front
 * of a client.
 */
export async function engagementRecovery(engagementId: string): Promise<EngagementRecovery> {
  const db = requireDb();
  const claims = await db
    .select()
    .from(schema.recoveryClaims)
    .where(
      and(
        eq(schema.recoveryClaims.engagementId, engagementId),
        eq(schema.recoveryClaims.status, 'recorded'),
      ),
    )
    .orderBy(asc(schema.recoveryClaims.taxYear), desc(schema.recoveryClaims.valueClaimed));
  if (claims.length === 0) return empty(engagementId);

  const outcomes = await standingOutcomes(claims.map((claim) => claim.id));
  const rate = await blendedRate(engagementId);
  const decorated = claims.map((row) => decorate(row, outcomes.get(row.id) ?? null));

  const byYear = [...new Set(claims.map((claim) => claim.taxYear))]
    .sort((a, b) => a - b)
    .map((taxYear) => ({
      taxYear,
      summary: summarize(
        decorated.filter((one) => one.claim.taxYear === taxYear),
        rate,
      ),
    }));

  const summary = summarize(decorated, rate);
  return {
    engagementId,
    summary,
    byYear,
    claims: decorated.map((one) => one.record),
    caveats: caveatsFor(decorated, rate),
  };
}

/**
 * The client's own copy.
 *
 * Built from `engagementRecovery` rather than beside it, so the two can never
 * disagree — a portal that computed its own totals would eventually print a
 * different number from the one in the firm's letter, and the client would be
 * right to trust neither.
 *
 * Grouped to the argument, because that is the grain a district's letter is
 * written at and therefore the grain a client can check. Per-asset shares of a
 * settlement nobody itemized are real arithmetic and false precision at once.
 */
export async function clientRecovery(engagementId: string): Promise<ClientRecoveryStatement> {
  const full = await engagementRecovery(engagementId);
  const strip = ({ learnable: _learnable, ...rest }: RecoverySummary) => rest;

  const groups = new Map<string, ClientRecoveryLine>();
  for (const claim of full.claims) {
    const key = `${claim.taxYear}:${claim.findingKey}`;
    const line = groups.get(key) ?? {
      taxYear: claim.taxYear,
      findingKey: claim.findingKey,
      findingTitle: claim.findingTitle,
      assets: 0,
      valueClaimed: 0,
      valueAllowed: 0,
      allowedWithoutFigure: 0,
      pending: 0,
      standing: '',
    };
    line.assets += 1;
    line.valueClaimed += claim.valueClaimed ?? 0;
    line.valueAllowed += claim.outcome?.valueAllowed ?? 0;
    if (claim.outcome === null) line.pending += 1;
    // Allowed, in whole or in part, with no amount attached. Counted rather
    // than valued, and kept apart from the refusals it would otherwise be
    // indistinguishable from once the amounts are added up.
    if (
      claim.outcome !== null &&
      claim.outcome.valueAllowed === null &&
      (claim.outcome.outcome === 'accepted' || claim.outcome.outcome === 'partial')
    ) {
      line.allowedWithoutFigure += 1;
    }
    groups.set(key, line);
  }

  const lines = [...groups.values()]
    .map((line) => ({ ...line, standing: lineStanding(line) }))
    .sort((a, b) => b.taxYear - a.taxYear || b.valueClaimed - a.valueClaimed);

  return {
    engagementId,
    summary: strip(full.summary),
    byYear: full.byYear.map((year) => ({ taxYear: year.taxYear, summary: strip(year.summary) })),
    lines,
    caveats: full.caveats,
  };
}

/** One sentence per argument, in the words a business would use about it. */
function lineStanding(line: ClientRecoveryLine): string {
  if (line.pending === line.assets) return 'With the district, no answer yet.';
  const settled = line.assets - line.pending;
  const part = line.pending > 0 ? ` ${line.pending} of ${line.assets} still open.` : '';
  const unpriced = line.allowedWithoutFigure;

  // The one case where nothing in the amount column is not a refusal. Said as
  // its own sentence, with a count, because some of the answered items may
  // genuinely have been refused and the sentence must not speak for those.
  if (line.valueAllowed <= 0) {
    if (unpriced > 0) {
      return `The appraiser said this landed on ${unpriced} of the ${settled} answered, without naming a figure, so no amount is shown against it.${part}`;
    }
    return `Not allowed on ${settled === 1 ? 'the item' : 'the items'} answered so far.${part}`;
  }

  const also =
    unpriced > 0
      ? ` On ${unpriced} more the appraiser said the argument landed without naming a figure, so nothing is added to the amount for ${unpriced === 1 ? 'it' : 'those'}.`
      : '';
  if (line.valueAllowed >= line.valueClaimed) return `Allowed in full.${also}${part}`;
  const share = Math.round((line.valueAllowed / line.valueClaimed) * 100);
  return `Allowed in part — ${share}% of what was asked.${also}${part}`;
}

/**
 * Write down what the district did.
 *
 * The two shapes this accepts are not two conveniences — they are two different
 * strengths of evidence, and the row records which one it was. Naming what each
 * position got is a fact about that argument. Giving one settlement figure is a
 * fact about the account and an assumption about every position under it, so it
 * is stored as `pro-rata` and excluded from anything that learns.
 *
 * Recording again supersedes rather than edits, the same rule as a resolution:
 * what the client was first told stays recoverable.
 */
export async function recordSettlement(
  engagementId: string,
  body: RecordSettlementRequest,
): Promise<EngagementRecovery> {
  const db = requireDb();
  const open = await db
    .select()
    .from(schema.recoveryClaims)
    .where(
      and(
        eq(schema.recoveryClaims.engagementId, engagementId),
        eq(schema.recoveryClaims.taxYear, body.taxYear),
        eq(schema.recoveryClaims.status, 'recorded'),
      ),
    );
  const scoped = open.filter(
    (claim) => body.locationId === null || claim.locationId === body.locationId,
  );
  if (scoped.length === 0) {
    throw new HttpError(
      409,
      'Nothing was claimed for that site and year, so there is no position for this settlement to land on.',
    );
  }

  const subjects: RecoveryClaim[] = scoped.map(toClaim);
  let written: RecoveryOutcome[];
  let allocationNote = body.note;

  if (body.perClaim !== null) {
    const known = new Set(scoped.map((claim) => claim.id));
    const stray = body.perClaim.find((one) => !known.has(one.claimId));
    if (stray) notFound('One of those claims is not open on this engagement and year.');
    written = body.perClaim.map((one) => ({
      claimId: one.claimId,
      outcome: one.outcome,
      // Per row, from what the caller could actually fill in. A figure is the
      // district's own arithmetic and the row is `itemized`; no figure is an
      // appraiser naming the argument without pricing it, which is `stated` —
      // and the difference is not cosmetic. Both are learnable, only one
      // reports an amount, and writing `itemized` over a blank would put a
      // number nobody stated into the client's total.
      allocation: one.valueAllowed === null ? ('stated' as const) : ('itemized' as const),
      valueAllowed: one.valueAllowed,
      taxRecovered: one.taxRecovered,
      taxIsDocumented: one.taxRecovered !== null,
      resolvedOn: body.resolvedOn,
    }));
  } else {
    const split = proRataSplit(subjects, body.settledValueRemoved ?? 0, body.resolvedOn);
    written = split.outcomes;
    if (split.unattributed > 0) {
      // Said on the row rather than swallowed. A district that took off more
      // than was ever claimed moved for a reason of its own, and a firm reading
      // this later needs to know the excess was not attributed to anything.
      const excess = Math.round(split.unattributed).toLocaleString('en-US');
      allocationNote = `${allocationNote ? `${allocationNote} ` : ''}$${excess} of the settlement exceeded everything claimed and was not attributed to any position.`;
    }
  }

  const actor = await currentActor();
  await db.transaction(async (tx) => {
    const ids = written.map((one) => one.claimId);
    await tx
      .update(schema.recoveryOutcomes)
      .set({ status: 'superseded' })
      .where(
        and(
          inArray(schema.recoveryOutcomes.claimId, ids),
          eq(schema.recoveryOutcomes.status, 'recorded'),
        ),
      );
    await tx.insert(schema.recoveryOutcomes).values(
      written.map((one) => ({
        claimId: one.claimId,
        engagementId,
        outcome: one.outcome,
        allocation: one.allocation,
        valueAllowed: one.valueAllowed,
        taxRecovered: one.taxRecovered ?? perClaimTax(body, one),
        taxIsDocumented: one.taxIsDocumented,
        resolutionId: body.resolutionId,
        resolvedOn: one.resolvedOn,
        status: 'recorded',
        note: allocationNote,
        recordedBy: actor,
      })),
    );
  });

  return engagementRecovery(engagementId);
}

/**
 * A documented refund, spread the same way the value was.
 *
 * Only ever reached on a pro-rata settlement where a single cheque figure was
 * given. It rides the same proportion as the value because it *is* the same
 * settlement seen in dollars, and it stays flagged `taxIsDocumented` false on
 * every row for the same reason the value split is: the total is documented,
 * the per-claim share is arithmetic.
 */
function perClaimTax(body: RecordSettlementRequest, outcome: RecoveryOutcome): number | null {
  if (body.taxRecovered === null || body.settledValueRemoved === null) return null;
  if (body.settledValueRemoved <= 0) return null;
  const share = (outcome.valueAllowed ?? 0) / body.settledValueRemoved;
  return body.taxRecovered * share;
}

/**
 * Carry a protest resolution down to the claims underneath it.
 *
 * This is the join the doc asks for: firm-side outcome tracking already exists
 * at the site-and-year grain, and this is how it reaches the asset. The
 * district gave one number; every position under that account shares in it in
 * proportion to what it asked for, and every resulting row says `pro-rata` so
 * that nothing downstream mistakes the split for the district's opinion.
 *
 * Two silences are deliberate. A resolution with no final value settles
 * nothing, so nothing is written. And a *dismissed or withdrawn protest is not
 * a rejection of the claims* — a district that accepted half the rendition on
 * the way in and then dismissed the protest has agreed with those positions,
 * not refused them. Marking them rejected here would teach the acceptance model
 * the opposite of what happened, so they stay open until somebody records what
 * actually became of them.
 */
export async function settleFromResolution(input: {
  engagementId: string;
  resolutionId: string;
  locationId: string | null;
  taxYear: number;
  noticedValue: number | null;
  finalValue: number | null;
  resolvedOn: string;
  orderReference: string | null;
}): Promise<void> {
  if (input.finalValue === null || input.noticedValue === null) return;
  const removed = input.noticedValue - input.finalValue;
  if (removed <= 0) return;

  await recordSettlement(input.engagementId, {
    locationId: input.locationId,
    taxYear: input.taxYear,
    resolvedOn: input.resolvedOn,
    resolutionId: input.resolutionId,
    settledValueRemoved: removed,
    taxRecovered: null,
    perClaim: null,
    note: input.orderReference
      ? `From the district's determination ${input.orderReference}.`
      : "From the district's determination on this account.",
  });
}

/** Take back a claim recorded in error. Void, never delete: it was reported. */
export async function voidClaim(claimId: string, body: VoidClaimRequest): Promise<void> {
  const db = requireDb();
  const [existing] = await db
    .select()
    .from(schema.recoveryClaims)
    .where(eq(schema.recoveryClaims.id, claimId));
  if (!existing) notFound('No claim with that id.');
  if (existing.status === 'void') throw new HttpError(409, 'That claim is already void.');

  const actor = await currentActor();
  await db
    .update(schema.recoveryClaims)
    .set({ status: 'void', voidReason: body.reason, voidedBy: actor, voidedAt: new Date() })
    .where(eq(schema.recoveryClaims.id, claimId));
}

async function standingOutcomes(
  claimIds: readonly string[],
): Promise<Map<string, RecoveryOutcomeRow>> {
  if (claimIds.length === 0) return new Map();
  const rows = await requireDb()
    .select()
    .from(schema.recoveryOutcomes)
    .where(
      and(
        inArray(schema.recoveryOutcomes.claimId, [...claimIds]),
        eq(schema.recoveryOutcomes.status, 'recorded'),
      ),
    );
  return new Map(rows.map((row) => [row.claimId, row]));
}

function toClaim(row: RecoveryClaimRow): RecoveryClaim {
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

function decorate(
  row: RecoveryClaimRow,
  outcomeRow: RecoveryOutcomeRow | null,
): { claim: RecoveryClaim; record: RecoveryClaimRecord; realized: ReturnType<typeof realize> } {
  const claim = toClaim(row);
  const outcome: RecoveryOutcome | null = outcomeRow
    ? {
        claimId: outcomeRow.claimId,
        outcome: outcomeRow.outcome as RecoveryOutcome['outcome'],
        allocation: outcomeRow.allocation as RecoveryOutcome['allocation'],
        valueAllowed: outcomeRow.valueAllowed,
        taxRecovered: outcomeRow.taxRecovered,
        taxIsDocumented: outcomeRow.taxIsDocumented,
        resolvedOn: outcomeRow.resolvedOn,
      }
    : null;
  const realized = realize(claim, outcome);
  return {
    claim,
    realized,
    record: {
      id: row.id,
      taxYear: row.taxYear,
      locationId: row.locationId,
      locationLabel: null,
      accountId: row.accountId,
      assetId: row.assetId,
      assetTag: null,
      assetDescription: null,
      findingKey: row.findingKey,
      findingTitle: row.note ?? row.findingKey,
      route: row.route as ClaimRoute,
      authority: row.authority,
      valueClaimed: row.valueClaimed,
      taxClaimed: row.taxClaimed,
      predictedConfidence: row.predictedConfidence,
      predictedAcceptance: row.predictedAcceptance,
      claimedOn: row.claimedOn,
      status: 'recorded',
      outcome: outcome === null ? null : { ...outcome, note: outcomeRow?.note ?? null },
      realizedShare: realized.realizedShare,
      learnable: realized.learnable,
      notLearnable: realized.notLearnable,
      standing: realized.standing,
    },
  };
}

function summarize(
  rows: readonly { realized: ReturnType<typeof realize> }[],
  rate: number | null,
): RecoverySummary {
  return realizedTotals(
    rows.map((one) => one.realized),
    rate,
  );
}

/**
 * The lines that have to sit under any total assembled from mixed evidence.
 *
 * Written from the rows rather than pinned, so a season where every outcome was
 * itemized says nothing about pro-rata splits and a season with no rate on file
 * does not print a silent estimate of zero.
 */
function caveatsFor(
  rows: readonly { realized: ReturnType<typeof realize> }[],
  rate: number | null,
): string[] {
  const out: string[] = [];
  const proRata = rows.filter((one) => one.realized.outcome?.allocation === 'pro-rata').length;
  if (proRata > 0) {
    out.push(
      `${proRata} of these positions were settled as part of an account the district did not itemize. Their individual amounts are that settlement split in proportion to what each asked for, not what the district said about each one.`,
    );
  }
  const stated = rows.filter(
    (one) =>
      one.realized.outcome?.allocation === 'stated' && one.realized.outcome.valueAllowed === null,
  ).length;
  if (stated > 0) {
    out.push(
      `On ${stated} of them the appraiser said which arguments landed without pricing them. They count toward what this district accepts and contribute nothing to the value allowed, because no figure was ever stated for them.`,
    );
  }
  const undocumented = rows.filter(
    (one) => one.realized.outcome !== null && !one.realized.outcome.taxIsDocumented,
  ).length;
  if (undocumented > 0 && rate !== null) {
    out.push(
      `Tax on ${undocumented} of them is estimated at the rate on file rather than read off a refund or a corrected bill. The documented figure is reported separately and the two are never added.`,
    );
  }
  if (rate === null) {
    out.push(
      'No blended tax rate is on file for this engagement, so value removed is reported without a tax estimate beside it.',
    );
  }
  const pending = rows.filter((one) => one.realized.outcome === null).length;
  if (pending > 0) {
    out.push(
      `${pending} positions are still open with the district and count as nothing either way.`,
    );
  }
  return out;
}

/**
 * The rate the tax estimate uses, or nothing.
 *
 * Deliberately not `lookupRate`'s fallback here. That function's job is to keep
 * an analysis running, and a state-level blend is a reasonable stand-in for
 * pricing a finding. This one prints a recovery number next to real refunds, so
 * an engagement with no jurisdiction set gets no estimate at all rather than a
 * plausible one nobody chose.
 */
async function blendedRate(engagementId: string): Promise<number | null> {
  const [row] = await requireDb()
    .select({ jurisdictionId: schema.engagements.jurisdictionId })
    .from(schema.engagements)
    .where(eq(schema.engagements.id, engagementId));
  if (!row?.jurisdictionId) return null;
  return lookupRate(row.jurisdictionId);
}

function empty(engagementId: string): EngagementRecovery {
  return {
    engagementId,
    summary: {
      claims: 0,
      settled: 0,
      pending: 0,
      valueClaimed: 0,
      valueAllowed: 0,
      taxDocumented: 0,
      taxEstimated: null,
      learnable: 0,
    },
    byYear: [],
    claims: [],
    caveats: [],
  };
}
