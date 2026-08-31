import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import type {
  EngagementResult,
  FeeLine,
  FeeMeasure,
  FeeQuote,
  FeeStatement,
  FeeStatementStatus,
  FeeTerms,
  FeeView,
  IssueFeeStatementInput,
  SaveFeeTermsInput,
  SettleFeeStatementInput,
  SiteOutcome,
} from '@tangible/types';
import { FEE_BASES } from '@tangible/types';
import { HttpError } from '@/lib/http';
import { engagementResult } from '@/lib/result';
import { requireDb, schema } from '@/lib/workspace-db';

/**
 * Getting paid for the season.
 *
 * The engagement already computes what the year came to — value taken off the
 * roll, per site, dollarized at the jurisdiction's blended rate. Until now that
 * number went to the client in a letter and to nobody in a bill, and a practice
 * whose only billing path is somebody remembering in May is a practice that
 * bills late and short.
 *
 * The design is one rule and its consequences: **a bill is not an estimate.**
 * `EngagementResult` says of its own tax figure that it is an estimate by
 * construction and is "always presented as one, never as the bill" — the
 * blended rate flattens per-unit rates, and a fee is a thing somebody owes.
 *
 * So a contingency statement can be issued two ways and the difference is on
 * its face. Either the firm reads the client's actual tax bills and types what
 * was really saved, and the statement rests on a *stated* figure; or it bills a
 * share of the estimate and every line says which rate produced it. There is no
 * third path where an estimate is quietly billed as though somebody checked.
 *
 * The rest follows the shape the filed rendition record already set. A quote is
 * derived on read and moves as the season moves. A statement freezes — its
 * terms, its measure and its total are written down at the moment it goes out
 * and never recomputed, because the client is holding a piece of paper and a
 * disposition edited in June must not change what it says.
 */

const DEFAULT_MEASURE = (taxYear: number): FeeMeasure => ({
  basis: 'fixed',
  taxYear,
  sites: [],
  returnsFiled: 0,
  reductionTotal: null,
  savingCents: null,
  savingSource: 'none',
  excluded: [],
});

/** Dollars to whole cents, rounded once, at the only place it happens. */
function cents(dollars: number): number {
  return Math.round(dollars * 100);
}

export async function feeTerms(engagementId: string): Promise<FeeTerms | null> {
  const db = requireDb();
  const [row] = await db
    .select()
    .from(schema.engagementFees)
    .where(eq(schema.engagementFees.engagementId, engagementId))
    .limit(1);
  if (!row) return null;
  return shapeTerms(row);
}

function shapeTerms(row: typeof schema.engagementFees.$inferSelect): FeeTerms {
  const basis = FEE_BASES.find((candidate) => candidate === row.basis) ?? 'fixed';
  return {
    basis,
    fixedCents: row.fixedCents,
    perReturnCents: row.perReturnCents,
    contingencyRate: row.contingencyRate,
    minimumCents: row.minimumCents,
    agreedOn: row.agreedOn,
    notes: row.notes,
  };
}

/**
 * Record what was agreed, or change it.
 *
 * One row per engagement, so this is an upsert rather than an insert. Terms are
 * editable up to the moment a statement is issued and irrelevant afterwards:
 * the statement froze its own copy, and editing here changes the next bill, not
 * the one the client is holding.
 */
export async function saveFeeTerms(
  engagementId: string,
  input: SaveFeeTermsInput,
): Promise<FeeTerms> {
  const db = requireDb();
  const values = {
    engagementId,
    basis: input.basis,
    fixedCents: input.fixedCents ?? null,
    perReturnCents: input.perReturnCents ?? null,
    contingencyRate: input.contingencyRate ?? null,
    minimumCents: input.minimumCents ?? null,
    agreedOn: input.agreedOn ?? null,
    notes: input.notes ?? null,
  };
  const [row] = await db
    .insert(schema.engagementFees)
    .values(values)
    .onConflictDoUpdate({
      target: schema.engagementFees.engagementId,
      set: { ...values, updatedAt: new Date() },
    })
    .returning();
  if (!row) throw new HttpError(500, 'The fee terms could not be written.');
  return shapeTerms(row);
}

/**
 * What this season would bill today, and everything standing in the way.
 *
 * Blockers are sentences rather than codes, and a blocked quote still shows its
 * lines — the arithmetic it *would* do — because "we cannot bill yet" is only
 * useful next to "and here is what it would come to".
 */
export async function feeQuote(engagementId: string): Promise<FeeQuote> {
  const [terms, result] = await Promise.all([
    feeTerms(engagementId),
    engagementResult(engagementId),
  ]);
  return quoteFrom(terms, result, null);
}

function quoteFrom(
  terms: FeeTerms | null,
  result: EngagementResult,
  statedSavingCents: number | null,
): FeeQuote {
  const blockers: string[] = [];
  const lines: FeeLine[] = [];

  if (terms === null) {
    return {
      terms: null,
      lines,
      totalCents: 0,
      measure: DEFAULT_MEASURE(result.taxYear),
      blockers: [
        'No fee terms are recorded for this engagement. Set the basis and the amount from the ' +
          'engagement letter before a statement can be issued.',
      ],
      estimated: false,
    };
  }

  if (terms.agreedOn === null) {
    /**
     * A warning rather than a refusal. The date is evidence of agreement and
     * the firm may genuinely not have it to hand, but a bill sent under terms
     * nobody dated is a bill with nothing behind it in a dispute.
     */
    blockers.push(
      'The fee terms carry no agreed date. Record the day the client accepted them — a ' +
        'statement rests on the engagement letter, and an undated term is one nobody agreed to.',
    );
  }

  const measure = measureOf(terms, result, statedSavingCents);
  let total = 0;
  let estimated = false;

  if (terms.basis === 'fixed') {
    if (terms.fixedCents === null) {
      blockers.push('The basis is a fixed fee and no amount is recorded.');
    } else {
      total = terms.fixedCents;
      lines.push({
        label: `${result.taxYear} engagement`,
        detail: 'Fixed fee for the season, as agreed.',
        amountCents: terms.fixedCents,
      });
    }
  }

  if (terms.basis === 'per-return') {
    if (terms.perReturnCents === null) {
      blockers.push('The basis is per return and no per-return amount is recorded.');
    } else if (measure.returnsFiled === 0) {
      /**
       * Not an amount of zero. A per-return engagement with nothing filed has
       * not finished its work, and a $0 statement is a bill that says the
       * season produced nothing rather than that it is not over.
       */
      blockers.push(
        'No return has been recorded as filed, so there is nothing to bill per return yet.',
      );
    } else {
      total = terms.perReturnCents * measure.returnsFiled;
      lines.push({
        label: `${measure.returnsFiled} return${measure.returnsFiled === 1 ? '' : 's'} filed`,
        detail: `${money(terms.perReturnCents)} each, for the ${result.taxYear} season.`,
        amountCents: total,
      });
    }
  }

  if (terms.basis === 'contingency') {
    if (terms.contingencyRate === null) {
      blockers.push('The basis is a contingency and no share is recorded.');
    } else {
      /**
       * The season has to be over. A contingency billed while a protest is
       * live bills a reduction the ARB can still take back, and the correction
       * is a credit note to a client who already paid.
       */
      const moving = result.sites.filter((site) => !site.final);
      if (moving.length > 0) {
        blockers.push(
          `${moving.length} of ${result.sites.length} site${result.sites.length === 1 ? '' : 's'} ` +
            'have not finished: a value that can still move is not a saving that can be billed. ' +
            `Waiting on ${moving
              .slice(0, 3)
              .map((site) => site.label)
              .join(', ')}${moving.length > 3 ? ' and others' : ''}.`,
        );
      }

      if (measure.savingCents === null) {
        blockers.push(
          'Nothing measurable was saved on the record yet, so a share of it cannot be computed.',
        );
      } else {
        const share = Math.round(measure.savingCents * terms.contingencyRate);
        estimated = measure.savingSource === 'estimated';
        lines.push({
          label: `${(terms.contingencyRate * 100).toFixed(0)}% of the ${result.taxYear} saving`,
          detail:
            measure.savingSource === 'stated'
              ? `${money(measure.savingCents)} saved, as measured from the tax bills.`
              : `${money(measure.savingCents)} estimated at each jurisdiction's blended rate. ` +
                'An estimate, not a figure read off a bill.',
          amountCents: share,
        });
        total = share;

        /**
         * The floor is its own line rather than a silently larger share. A
         * client comparing the percentage against the saving should find the
         * arithmetic, and then find why the answer is nevertheless the minimum.
         */
        if (terms.minimumCents !== null && total < terms.minimumCents) {
          lines.push({
            label: 'Engagement minimum',
            detail: `The agreed floor of ${money(terms.minimumCents)} applies where the share is less.`,
            amountCents: terms.minimumCents - total,
          });
          total = terms.minimumCents;
        }
      }
    }
  }

  return { terms, lines, totalCents: total, measure, blockers, estimated };
}

/**
 * What the fee is applied to, and what was left out of it.
 *
 * The exclusions are the part worth writing down. A total over three of five
 * sites, presented as the engagement's number, is the kind of figure that gets
 * repeated to a client and then corrected — so every site that did not
 * contribute says why beside it.
 */
function measureOf(
  terms: FeeTerms,
  result: EngagementResult,
  statedSavingCents: number | null,
): FeeMeasure {
  const excluded: FeeMeasure['excluded'] = [];

  for (const site of result.sites) {
    const because = whyExcluded(site);
    if (because !== null) excluded.push({ label: site.label, because });
  }

  const estimatedDollars = result.sites.reduce(
    (sum, site) => sum + (site.estimatedTaxReduction ?? 0),
    0,
  );
  const anyEstimate = result.sites.some((site) => site.estimatedTaxReduction !== null);

  const savingCents =
    statedSavingCents !== null ? statedSavingCents : anyEstimate ? cents(estimatedDollars) : null;

  return {
    basis: terms.basis,
    taxYear: result.taxYear,
    sites: result.sites.map((site) => ({
      locationId: site.locationId,
      label: site.label,
      accountId: site.accountId,
      noticedValue: site.noticedValue,
      standingValue: site.standingValue,
      reduction: site.reduction,
      blendedTaxRate: site.blendedTaxRate,
      estimatedTaxReduction: site.estimatedTaxReduction,
      settledVia: site.settledVia,
      filedOn: site.filedOn,
    })),
    returnsFiled: result.sites.filter((site) => site.filedOn !== null).length,
    reductionTotal: result.reductionTotal,
    savingCents,
    savingSource:
      savingCents === null ? 'none' : statedSavingCents !== null ? 'stated' : 'estimated',
    excluded,
  };
}

/** Why one site contributed nothing, in the words the statement will carry. */
function whyExcluded(site: SiteOutcome): string | null {
  if (site.estimatedTaxReduction !== null) return null;
  if (site.reduction === null) {
    if (site.noticedValue === null)
      return 'No notice with a value on it, so there is nothing to compare against.';
    if (site.standingValue === null)
      return 'The year has not settled, so no standing value stands against the notice.';
    return 'No reduction could be computed for this site.';
  }
  return 'No blended tax rate is on file for this jurisdiction, so its reduction cannot be dollarized.';
}

function money(amountCents: number): string {
  return `$${(amountCents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ── Statements ─────────────────────────────────────────────────────────────
 *
 * Everything above derives. Everything below is written down once.
 */

/**
 * Issue the bill.
 *
 * Refuses on any blocker, in the same voice the Comptroller forms refuse in: a
 * statement that went out over a live protest, or under terms nobody agreed, is
 * not fixed by editing the row afterwards — it is fixed by a credit note to a
 * client who has already read it.
 */
export async function issueFeeStatement(
  engagementId: string,
  input: IssueFeeStatementInput,
  actor: string | null,
): Promise<FeeStatement> {
  const [terms, result] = await Promise.all([
    feeTerms(engagementId),
    engagementResult(engagementId),
  ]);
  const quote = quoteFrom(terms, result, input.statedSavingCents ?? null);

  if (quote.blockers.length > 0 || quote.terms === null) {
    throw new HttpError(
      409,
      `This engagement cannot be billed yet. ${quote.blockers[0] ?? 'No fee terms are recorded.'}`,
    );
  }
  if (quote.totalCents <= 0) {
    throw new HttpError(409, 'The fee comes to nothing, so there is no statement to issue.');
  }

  const db = requireDb();
  const [row] = await db
    .insert(schema.feeStatements)
    .values({
      engagementId,
      number: await nextNumber(result.taxYear),
      issuedBy: actor,
      basis: quote.terms.basis,
      lines: quote.lines,
      totalCents: quote.totalCents,
      terms: quote.terms,
      measure: quote.measure,
    })
    .returning();
  if (!row) throw new HttpError(500, 'The statement could not be written.');
  return shapeStatement(row);
}

/**
 * The next reference, scoped to the tax year.
 *
 * Counted off the existing rows rather than a sequence, because a gap in the
 * numbering is a question an accountant asks and a void statement already
 * leaves one. `PX-2026-0004` reads as what it is.
 */
async function nextNumber(taxYear: number): Promise<string> {
  const db = requireDb();
  const prefix = `PX-${taxYear}-`;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.feeStatements)
    .where(sql`${schema.feeStatements.number} like ${`${prefix}%`}`);
  return `${prefix}${String((row?.count ?? 0) + 1).padStart(4, '0')}`;
}

/**
 * The two things that happen to a bill after it goes out.
 *
 * It gets paid, or it gets voided. Neither edits what it says: a void keeps the
 * row and its reason, because a statement that vanished is a statement the
 * client can still produce and the firm cannot explain.
 */
export async function settleFeeStatement(
  statementId: string,
  input: SettleFeeStatementInput,
): Promise<FeeStatement> {
  const db = requireDb();
  const [existing] = await db
    .select()
    .from(schema.feeStatements)
    .where(eq(schema.feeStatements.id, statementId))
    .limit(1);
  if (!existing) throw new HttpError(404, 'No statement with that id.');
  if (existing.status !== 'issued') {
    throw new HttpError(409, `This statement is already ${existing.status}.`);
  }

  if (input.action === 'void' && (input.reason ?? '').trim() === '') {
    throw new HttpError(
      409,
      'A voided statement needs a reason, so the gap in the numbering reads.',
    );
  }

  const [row] = await db
    .update(schema.feeStatements)
    .set(
      input.action === 'paid'
        ? { status: 'paid', paidOn: input.paidOn ?? new Date().toISOString().slice(0, 10) }
        : { status: 'void', voidedAt: new Date(), voidReason: input.reason ?? null },
    )
    .where(and(eq(schema.feeStatements.id, statementId), eq(schema.feeStatements.status, 'issued')))
    .returning();
  if (!row) throw new HttpError(409, 'The statement changed while this was being recorded.');
  return shapeStatement(row);
}

function shapeStatement(row: typeof schema.feeStatements.$inferSelect): FeeStatement {
  const basis = FEE_BASES.find((candidate) => candidate === row.basis) ?? 'fixed';
  const status: FeeStatementStatus =
    row.status === 'paid' ? 'paid' : row.status === 'void' ? 'void' : 'issued';
  return {
    id: row.id,
    number: row.number,
    issuedAt: row.issuedAt.toISOString(),
    issuedBy: row.issuedBy,
    basis,
    /**
     * Read back as they were written, not re-parsed against today's schema. A
     * statement is the frozen thing; if the shape ever changes, an old row is
     * still exactly what the client was sent.
     */
    lines: row.lines as FeeLine[],
    totalCents: row.totalCents,
    terms: row.terms as FeeTerms,
    measure: row.measure as FeeMeasure,
    status,
    paidOn: row.paidOn,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

/** The billing panel: the agreement, what it would come to, what has gone out. */
export async function feeView(engagementId: string): Promise<FeeView> {
  const db = requireDb();
  const [quote, rows] = await Promise.all([
    feeQuote(engagementId),
    db
      .select()
      .from(schema.feeStatements)
      .where(eq(schema.feeStatements.engagementId, engagementId))
      .orderBy(desc(schema.feeStatements.issuedAt)),
  ]);

  const statements = rows.map(shapeStatement);
  return {
    quote,
    statements,
    outstandingCents: statements
      .filter((statement) => statement.status === 'issued')
      .reduce((sum, statement) => sum + statement.totalCents, 0),
  };
}
