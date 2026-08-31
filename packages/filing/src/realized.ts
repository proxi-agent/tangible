/**
 * What a season actually recovered, per claim, per asset, per year.
 *
 * The engagement scoreboard answers this at the site-and-year grain, because
 * that is the grain a district works at: one account, one year, one settlement.
 * That is the right answer to "how did the season go" and the wrong answer to
 * every question worth asking next. Which arguments does this district concede?
 * Are ghost findings worth what the model says? Should the queue rank a
 * misclassification above a freight split? None of those can be answered from a
 * number attached to a whole site.
 *
 * So this file does one thing: it takes a settlement the district stated once
 * and distributes it across the positions that were taken to them, keeping the
 * distinction between what was observed and what was assumed at every step.
 *
 * The assumption is real and it is worth naming plainly. A pro-rata split is not
 * evidence about any individual claim. It is arithmetic that preserves the
 * total, which is all it is good for — reporting to the client. Everything that
 * learns from outcomes is required to ignore it, and `learnable` is how it says
 * so rather than leaving each consumer to remember.
 */

export type ClaimRoute =
  'rendition' | 'protest' | '25.25-c' | '25.25-c-1' | '25.25-d' | 'fl-refund' | 'fl-vab';

export type ClaimOutcome = 'accepted' | 'partial' | 'rejected' | 'withdrawn';
export type Allocation = 'itemized' | 'stated' | 'pro-rata';

export interface RecoveryClaim {
  id: string;
  taxYear: number;
  locationId: string | null;
  accountId: string | null;
  assetId: string | null;
  findingKey: string;
  route: ClaimRoute;
  valueClaimed: number | null;
  taxClaimed: number | null;
  predictedConfidence: number | null;
  predictedAcceptance: number | null;
}

export interface RecoveryOutcome {
  claimId: string;
  outcome: ClaimOutcome;
  allocation: Allocation;
  valueAllowed: number | null;
  taxRecovered: number | null;
  taxIsDocumented: boolean;
  resolvedOn: string;
}

/** One claim and how it ended, which is the unit everything downstream reads. */
export interface RealizedRecovery {
  claim: RecoveryClaim;
  outcome: RecoveryOutcome | null;
  /**
   * Share of what was claimed that the district allowed. Null while pending,
   * and null where the claim asked for nothing measurable.
   */
  realizedShare: number | null;
  /**
   * Whether this row may be used to learn an acceptance rate.
   *
   * False for a pro-rata allocation, false for a withdrawal — a position the
   * firm pulled says nothing about whether a district would have taken it — and
   * false while pending. Three different reasons, one flag, and the reasons are
   * kept in `notLearnable` so a screen can say which.
   */
  learnable: boolean;
  notLearnable: string | null;
  /** The row in prose, for the client-facing line. */
  standing: string;
}

/**
 * Split one settlement across the claims that produced it.
 *
 * Called with the claims taken to one district for one account and one year,
 * and the single value the district agreed to take off. Returns an outcome per
 * claim, every one of them marked `pro-rata`, because that is what this is.
 *
 * Two properties are load-bearing and both are tested. The parts sum to the
 * whole, so no client is ever told a number that does not reconcile to the
 * district's. And a settlement larger than everything claimed does not inflate
 * the claims past what they asked for — it means the district moved for reasons
 * of its own, and the excess is returned as `unattributed` rather than being
 * spread over positions that never asked for it.
 */
export function proRataSplit(
  claims: readonly RecoveryClaim[],
  settledValueRemoved: number,
  resolvedOn: string,
): { outcomes: RecoveryOutcome[]; unattributed: number } {
  const eligible = claims.filter((claim) => (claim.valueClaimed ?? 0) > 0);
  const asked = eligible.reduce((total, claim) => total + (claim.valueClaimed ?? 0), 0);
  if (asked <= 0 || settledValueRemoved <= 0) {
    return {
      outcomes: claims.map((claim) => ({
        claimId: claim.id,
        outcome: 'rejected' as const,
        allocation: 'pro-rata' as const,
        valueAllowed: 0,
        taxRecovered: null,
        taxIsDocumented: false,
        resolvedOn,
      })),
      unattributed: Math.max(0, settledValueRemoved),
    };
  }

  const attributable = Math.min(settledValueRemoved, asked);
  const factor = attributable / asked;

  // Distributed by largest remainder so the parts sum exactly to the whole. A
  // penny of rounding drift is invisible on one row and is exactly the kind of
  // thing that makes a client's own spreadsheet disagree with the report.
  const exact = eligible.map((claim) => (claim.valueClaimed ?? 0) * factor);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = Math.round(attributable) - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac);
  const allowed = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    allowed[index] = (allowed[index] ?? 0) + 1;
    remainder -= 1;
  }

  const byId = new Map<string, number>();
  eligible.forEach((claim, index) => byId.set(claim.id, allowed[index] ?? 0));

  return {
    outcomes: claims.map((claim) => {
      const value = byId.get(claim.id) ?? 0;
      const askedFor = claim.valueClaimed ?? 0;
      return {
        claimId: claim.id,
        outcome:
          value <= 0
            ? ('rejected' as const)
            : value >= askedFor
              ? ('accepted' as const)
              : ('partial' as const),
        allocation: 'pro-rata' as const,
        valueAllowed: value,
        taxRecovered: null,
        taxIsDocumented: false,
        resolvedOn,
      };
    }),
    unattributed: Math.max(0, settledValueRemoved - attributable),
  };
}

/**
 * A claim and its outcome, read together.
 *
 * The prose branch matters more than the arithmetic here. "Rejected" and
 * "pulled before it was heard" look identical in a count and mean opposite
 * things to a firm deciding whether to bring the same argument next year.
 */
export function realize(claim: RecoveryClaim, outcome: RecoveryOutcome | null): RealizedRecovery {
  if (outcome === null) {
    return {
      claim,
      outcome: null,
      realizedShare: null,
      learnable: false,
      notLearnable: 'Nothing has come back from the district on this position yet.',
      standing: 'Taken to the district and still open.',
    };
  }

  const realizedShare = shareOf(claim, outcome);

  const notLearnable =
    outcome.outcome === 'withdrawn'
      ? 'Withdrawn before the district ruled, so it says nothing about whether the argument would have been accepted.'
      : outcome.allocation === 'pro-rata'
        ? 'The district settled the account as a whole and did not say which positions it allowed. This row is the settlement split in proportion to what each claim asked for — an arithmetic convenience, not an observation about this argument.'
        : null;

  return {
    claim,
    outcome,
    realizedShare,
    learnable: notLearnable === null,
    notLearnable,
    standing: standingFor(claim, outcome, realizedShare),
  };
}

/**
 * The share of what was asked that the district allowed.
 *
 * Money first, wherever money was stated — that is the observation, and nothing
 * beats it.
 *
 * Where no amount was stated, a zero would be a lie in the exact direction that
 * costs the most. An appraiser who names the arguments that landed without ever
 * itemising the money has given the acceptance model its strongest possible
 * evidence, and reading the missing figure as "allowed nothing" would score an
 * accepted position at 0% and teach the model the opposite of what happened.
 * So a valueless outcome takes its share from the label instead.
 *
 * Only where the label is unambiguous. `partial` is not: "they allowed some of
 * it" with no figure is a real fact about acceptance and no fact at all about
 * how much. A null share is how such a row says the amount is unknown — the
 * learner drops it for want of a number, which is right, while the row still
 * reports and still reads.
 */
function shareOf(claim: RecoveryClaim, outcome: RecoveryOutcome): number | null {
  const asked = claim.valueClaimed ?? 0;
  if (outcome.valueAllowed !== null) {
    return asked > 0 ? Math.min(1, outcome.valueAllowed / asked) : null;
  }
  switch (outcome.outcome) {
    case 'accepted':
      return 1;
    case 'rejected':
      return 0;
    default:
      return null;
  }
}

function standingFor(claim: RecoveryClaim, outcome: RecoveryOutcome, share: number | null): string {
  const via =
    outcome.allocation === 'itemized'
      ? 'The district itemized what it allowed'
      : outcome.allocation === 'stated'
        ? 'The appraiser said which arguments landed'
        : 'The account settled as a whole and this is its share';
  switch (outcome.outcome) {
    case 'accepted':
      return `Allowed in full. ${via}.`;
    case 'partial':
      return `Allowed in part${share === null ? '' : ` — ${Math.round(share * 100)}% of what was asked`}. ${via}.`;
    case 'rejected':
      return `Not allowed. ${via}.`;
    case 'withdrawn':
      return 'Withdrawn before the district ruled.';
  }
}

/**
 * What a client is owed the plain answer to: how much of what we said we would
 * get, we got.
 *
 * Documented tax is reported apart from modelled tax throughout, and the two
 * are never added. A refund cheque and a rate multiplication are different
 * kinds of number, and a total that mixed them would be the single most
 * misleading figure this product could print.
 */
export interface RealizedTotals {
  claims: number;
  settled: number;
  pending: number;
  valueClaimed: number;
  valueAllowed: number;
  /** Tax actually documented — cheques, refunds, corrected bills. */
  taxDocumented: number;
  /** Tax implied by the value allowed at the rate on file. An estimate. */
  taxEstimated: number | null;
  /** Of the settled claims, how many can teach the model anything. */
  learnable: number;
}

export function realizedTotals(
  rows: readonly RealizedRecovery[],
  blendedTaxRate: number | null,
): RealizedTotals {
  const settled = rows.filter((row) => row.outcome !== null);
  const valueAllowed = settled.reduce((total, row) => total + (row.outcome?.valueAllowed ?? 0), 0);
  return {
    claims: rows.length,
    settled: settled.length,
    pending: rows.length - settled.length,
    valueClaimed: rows.reduce((total, row) => total + (row.claim.valueClaimed ?? 0), 0),
    valueAllowed,
    taxDocumented: settled.reduce(
      (total, row) => total + (row.outcome?.taxIsDocumented ? (row.outcome.taxRecovered ?? 0) : 0),
      0,
    ),
    taxEstimated: blendedTaxRate === null ? null : valueAllowed * blendedTaxRate,
    learnable: rows.filter((row) => row.learnable).length,
  };
}
