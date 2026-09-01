import 'server-only';
import { AUTO_ACCEPT_CONFIDENCE, reviewBundleVocabulary } from '@tangible/classification';
import type { SettledDescription } from '@tangible/classification';
import { autoAcceptReport, diffEngineFacts, scoreLabels } from '@tangible/eval';
import { learnAcceptance, learnSignalLifts, ruleFor } from '@tangible/savings';
import type { ClassificationLabel, EngineDigestView, EngineFact, EvalLabel } from '@tangible/types';
import { closedPositions, type ClosedPosition } from '@/lib/acceptance';
import { datedDescriptions, type DatedDescription } from '@/lib/bundle-vocabulary';
import { datedClassificationLabels, harvestLabels } from '@/lib/quality';

/**
 * The engine, read twice, and the difference said out loud.
 *
 * This is the edge of the digest: the part that knows what an
 * `AcceptanceEvidence` is, what a `SignalLift` is, what a bundle proposal is,
 * and reduces all four vocabularies to the one shape `diffEngineFacts` can
 * compare. The comparison itself is in `@tangible/eval` and knows none of that.
 *
 * ## Everything is read once and partitioned in memory
 *
 * Four queries, not eight. Each learner's corpus comes back with a date on
 * every row, and the earlier reading is the same rows filtered by that date.
 * The alternative — two `where`-clauses per corpus — would let a settlement
 * recorded between the two reads land in the "after" and not the "before",
 * which reports a crossing that did not happen in the window it claims. It is
 * the same argument `acceptanceBoard` makes for reading both its layers off one
 * query, and it matters more here, because a difference is the whole output.
 *
 * These reads are unbounded on purpose and stay small for the reason
 * `acceptance.ts` gives: the firm's own closed positions grow by a few rows per
 * settled account per year.
 *
 * ## What the digest does not do
 *
 * It does not apply anything, propose a code change, adjust a threshold, or
 * write a rule. Two of the four learners it reads *do* apply themselves once
 * their bar is cleared — that is the acceptance layer's existing design and the
 * reason a crossing is worth an interruption — and the other two emit source
 * for a person to commit. The digest changes neither behaviour. It is the part
 * that says a thing happened, which is what was missing.
 */

/** The default window. A week, matched to the cron beside it in `vercel.json`. */
export const DIGEST_DAYS = 7;

/**
 * One reading of every corpus, each row carrying when it arrived.
 *
 * `harvestLabels` is the exception that needs no new column: an `EvalLabel`
 * already carries `decidedAt`, because a label whose date you cannot state is
 * not much of a label.
 */
interface Corpora {
  positions: ClosedPosition[];
  descriptions: DatedDescription[];
  classification: { label: ClassificationLabel; reviewedAt: Date }[];
  labels: EvalLabel[];
}

async function readCorpora(): Promise<Corpora> {
  const [positions, descriptions, classification, labels] = await Promise.all([
    closedPositions(),
    datedDescriptions(),
    datedClassificationLabels(),
    harvestLabels(),
  ]);
  return { positions, descriptions, classification, labels };
}

/** The corpora as they stood at an instant, by dropping what arrived after it. */
function asOf(corpora: Corpora, cutoff: Date): Corpora {
  return {
    positions: corpora.positions.filter((row) => row.recordedAt <= cutoff),
    descriptions: corpora.descriptions.filter((row) => row.createdAt <= cutoff),
    classification: corpora.classification.filter((row) => row.reviewedAt <= cutoff),
    labels: corpora.labels.filter((row) => new Date(row.decidedAt) <= cutoff),
  };
}

/** The oldest thing in the record. Null when there is nothing in it at all. */
function earliest(corpora: Corpora): Date | null {
  const stamps = [
    ...corpora.positions.map((row) => row.recordedAt.getTime()),
    ...corpora.descriptions.map((row) => row.createdAt.getTime()),
    ...corpora.classification.map((row) => row.reviewedAt.getTime()),
    ...corpora.labels.map((row) => new Date(row.decidedAt).getTime()),
  ];
  return stamps.length === 0 ? null : new Date(Math.min(...stamps));
}

/**
 * Every fact the engine holds, given one reading of the corpora.
 *
 * The same function produces both sides of the diff. That is not a convenience
 * — it is the only way the comparison means anything. If the earlier state were
 * assembled by a second, similar function, a difference between the two
 * functions would be indistinguishable from a difference in the data, and the
 * digest would report the firm's learning when it was reporting its own bug.
 */
function factsFrom(corpora: Corpora): EngineFact[] {
  const facts: EngineFact[] = [];

  /* ── What districts allow ────────────────────────────────────────────────
   *
   * Pooled, not per district. `measured` is a property of the whole corpus for
   * a finding — a district's own rate has no separate bar to cross — so a fact
   * per (finding, district) would multiply the list by the county count and
   * every row in it would cross on the same day.
   */
  const observations = corpora.positions.map(({ observation }) => observation);
  for (const row of learnAcceptance(observations, null).evidence) {
    facts.push({
      id: `acceptance:${row.findingKey}`,
      kind: 'acceptance',
      subject: `${titleOf(row.findingKey)} — the rate districts allow`,
      inForce: row.measured,
      value: row.rate,
      observations: row.observations,
      basis: row.basis,
      href: '/quality',
    });
  }

  /* ── Which evidence persuades ────────────────────────────────────────────── */
  const signals = learnSignalLifts(
    corpora.positions
      .filter((row) => row.signals !== null && row.signals.length > 0)
      .map((row) => ({
        findingKey: row.observation.findingKey,
        signals: row.signals!,
        share: row.observation.share,
      })),
  );
  for (const row of signals.lifts) {
    facts.push({
      id: `signal:${row.findingKey}:${row.code}`,
      kind: 'signal',
      subject: `${row.label}, on ${titleOf(row.findingKey)}`,
      inForce: row.published,
      value: row.lift,
      /**
       * Both arms. `MIN_ARM` is a floor on each side and the lift is a
       * comparison between them, so the evidence behind this fact is what the
       * comparison was drawn from — not the larger arm, which would make a
       * lopsided pair look better founded than it is.
       */
      observations: row.withCount + row.withoutCount,
      basis: row.basis,
      href: '/quality',
    });
  }

  /* ── What the register calls things ─────────────────────────────────────── */
  const vocabulary = reviewBundleVocabulary(
    corpora.descriptions.map((row): SettledDescription => row.settled),
  );
  for (const row of vocabulary.proposals) {
    facts.push({
      id: `bundle-term:${row.exclusionKey}:${row.phrase}`,
      kind: 'bundle-term',
      subject: `“${row.phrase}” as ${row.label}`,
      /**
       * True, and it does not mean the advisor has the phrase. It means the
       * record is asserting that it should — which is exactly the fact worth
       * being told, because the only thing standing between the assertion and
       * the advisor is somebody pasting a line into `bundles.ts`.
       */
      inForce: true,
      value: row.precision,
      observations: row.mentions,
      basis: row.basis,
      href: '/quality',
    });
  }
  for (const row of vocabulary.challenges) {
    facts.push({
      id: `bundle-challenge:${row.exclusionKey}:${row.phrase}`,
      kind: 'bundle-challenge',
      subject: `“${row.phrase}”, which the advisor treats as ${row.label}`,
      inForce: true,
      value: row.precision,
      observations: row.mentions,
      basis: row.basis,
      href: '/quality',
    });
  }

  /* ── Whether the detectors are right ─────────────────────────────────────
   *
   * The firm's own decisions only. `scoreLabels` is handed the same filtered
   * set `qualityView` gives it, because "the controller did not want to make
   * this argument" and "the detector was wrong" are different facts and the
   * digest would otherwise announce a precision that averaged them.
   */
  const firm = corpora.labels.filter((label) => label.decidedByAudience !== 'client');
  const report = scoreLabels(firm, new Date(0).toISOString());
  for (const row of report.byFinding) {
    facts.push({
      id: `precision:${row.findingKey}`,
      kind: 'precision',
      subject: `Precision on ${titleOf(row.findingKey)}`,
      /** Null precision is `MIN_JUDGED` unmet: the number exists and is unsayable. */
      inForce: row.precision !== null,
      value: row.precision,
      observations: row.judged,
      basis:
        row.precision === null
          ? `${row.judged} judged. Under the minimum sample, so no rate is stated.`
          : `${row.correct} of ${row.judged} judged rows held up.`,
      href: '/quality',
    });
  }

  /* ── Whether the classifier is right ─────────────────────────────────────── */
  const auto = autoAcceptReport(
    corpora.classification.map((row) => row.label),
    AUTO_ACCEPT_CONFIDENCE,
  );
  facts.push({
    id: 'classifier:agreement',
    kind: 'classifier',
    subject: 'The classifier’s agreement with reviewers',
    inForce: auto.agreement !== null,
    value: auto.agreement,
    observations: auto.labels,
    basis:
      auto.agreement === null
        ? `${auto.labels} model-sourced reviews. Under the minimum sample.`
        : `${auto.labels} model-sourced reviews, at a live bar of ${AUTO_ACCEPT_CONFIDENCE}.`,
    href: '/quality',
  });

  return facts;
}

function titleOf(findingKey: string): string {
  return ruleFor(findingKey)?.title ?? findingKey;
}

/**
 * What changed in the last `days`.
 *
 * `now` is a parameter so a caller can ask about a window that has already
 * closed — which is the recovery when a scheduled run did not happen, and the
 * reason the window is not a constant anywhere in this feature.
 */
export async function engineDigest(
  days = DIGEST_DAYS,
  now = new Date(),
): Promise<EngineDigestView> {
  const corpora = await readCorpora();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const first = earliest(corpora);

  return {
    digest: diffEngineFacts(factsFrom(asOf(corpora, since)), factsFrom(corpora), {
      since: since.toISOString(),
      until: now.toISOString(),
    }),
    days,
    /**
     * Whether the earlier reading is a reading rather than an absence. With no
     * record older than the window, every fact is `appeared` and the screen has
     * to say why — otherwise a firm's first month reads as the busiest week the
     * engine has ever had.
     */
    reachesBack: first !== null && first < since,
  };
}
